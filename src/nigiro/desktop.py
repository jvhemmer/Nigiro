"""Workspace commands for the desktop app, sent as JSON lines over standard I/O."""

from __future__ import annotations

import csv
import json
import sys
from dataclasses import asdict
from pathlib import Path

import matplotlib
import numpy
import scipy
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from nigiro.analysis import FitResult, PlotResult, run_linear_fit, run_plot
from nigiro.figure_style import FigureStyle
from nigiro.plotting import draw_fit, draw_plot
from nigiro.project import Correction, FigureColor, LinearFit, Plot, Project, Source
from nigiro.storage import load_project, operation_record, save_project


SAMPLE = b"""Time (s),Signal
0,1
1,2.9
2,5.3
3,6.5
4,8.9
5,10.2
6,13.4
7,14.5
"""


class Workspace:
    def __init__(self) -> None:
        self.project: Project | None = None
        self.path: Path | None = None
        self.dirty = False
        self.fit: FitResult | None = None
        self.plot: PlotResult | None = None
        self.figure_error: str | None = None

    def set_project(self, project: Project, path: Path | None) -> None:
        project.validate()
        try:
            self.render(project)
        except ValueError as exc:
            self.fit = self.plot = None
            self.figure_error = str(exc)
        self.project = project
        self.path = path
        self.dirty = path is None

    def render(self, project: Project) -> None:
        recipe = project.figure
        fit = plot = None
        if isinstance(recipe, LinearFit):
            fit = run_linear_fit(project.worksheet, recipe)
        elif isinstance(recipe, Plot):
            plot = run_plot(project.worksheet, recipe)
        self.fit = fit
        self.plot = plot
        self.figure_error = None

    def snapshot(self) -> dict:
        project = self.project
        if project is None:
            return {"project": None}

        fit = self.fit
        result = None
        if fit is not None:
            result = {
                "slope": fit.slope,
                "intercept": fit.intercept,
                "r_squared": fit.r_squared,
                "omitted_rows": fit.omitted_rows,
                "x": fit.x.tolist(),
                "y": fit.y.tolist(),
                "fitted": fit.fitted.tolist(),
                "residuals": fit.residuals.tolist(),
            }

        return {"project": {
            "source_name": project.source.name,
            "file_name": self.path.name if self.path else None,
            "dirty": self.dirty,
            "columns": project.worksheet.columns,
            "rows": project.worksheet.rows,
            "original_rows": project.source.worksheet.rows,
            "operations": [operation_record(op) for op in project.operations],
            "fit": result,
            "fit_error": self.figure_error if isinstance(project.figure, LinearFit) else None,
            "plot": {
                **operation_record(project.figure),
                "x_values": self.plot.x,
                "y_values": self.plot.y,
                "omitted_rows": self.plot.omitted_rows,
            } if self.plot else None,
            "plot_error": self.figure_error if isinstance(project.figure, Plot) else None,
            "colors": project.colors,
            "figure_style": asdict(project.figure_style),
            "default_figure_style": asdict(FigureStyle()),
            "versions": {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
        }}

    def dispatch(self, request: dict) -> dict:
        match request["action"]:
            case "state":
                pass
            case "sample":
                self.set_project(Project(Source("Sample data.csv", SAMPLE)), None)
            case "import_csv":
                path = Path(request["path"])
                self.set_project(Project(Source(path.name, path.read_bytes())), None)
            case "open":
                path = Path(request["path"])
                self.set_project(load_project(path), path)
            case "export_rendered":
                from nigiro.figure_export import write_figure

                fonts = Path(__file__).with_name("fonts")
                write_figure(Path(request["path"]), request["svg"], request["scale"], fonts)
                return {}
            case _:
                self.apply(request)
        return self.snapshot()

    def apply(self, request: dict) -> None:
        project = self.project
        if project is None:
            raise ValueError("Open a project or import a CSV first.")

        match request["action"]:
            case "correct":
                operation = Correction(request["row"], request["column"], request["value"])
                updated = project.apply(operation)
                if project.worksheet.rows[operation.row][operation.column] != operation.value:
                    self.set_project(updated, self.path)
                    self.dirty = True
            case "fit" | "plot":
                if request["action"] == "fit":
                    recipe = LinearFit(request["x"], request["y"])
                else:
                    recipe = Plot(request["plot_type"], request["x"], request["y"])
                updated = project.apply(recipe)
                self.render(updated)
                self.project = updated
                self.dirty = True
            case "color":
                operation = FigureColor(request["element"], request["color"])
                if project.colors[operation.element] != operation.color:
                    self.project = project.apply(operation)
                    self.dirty = True
            case "figure_style":
                if project.figure is None:
                    raise ValueError("Create a figure first.")
                style = FigureStyle(**request["style"])
                if style != project.figure_style:
                    self.project = project.apply(style)
                    self.dirty = True
            case "save":
                path = Path(request["path"]) if "path" in request else self.path
                if path is None or path.suffix.lower() != ".nigiro":
                    raise ValueError("Choose a file name with the .nigiro extension.")
                save_project(path, project)
                self.path = path
                self.dirty = False
            case "export":
                self.export(Path(request["path"]))
            case _:
                raise ValueError("Unknown workspace command.")

    def export(self, path: Path) -> None:
        if path.suffix.lower() not in (".svg", ".pdf"):
            raise ValueError("Choose a file name with the .svg or .pdf extension.")
        project = self.project
        if project is None or (self.fit is None and self.plot is None):
            raise ValueError("Create a figure before you export it.")
        recipe = project.figure
        columns = project.worksheet.columns
        figure = Figure(figsize=(8, 5.5), layout="constrained")
        FigureCanvasAgg(figure)
        x_label, y_label = columns[recipe.x], columns[recipe.y]
        if self.plot is not None:
            draw_plot(figure, recipe.plot_type, self.plot, x_label, y_label, project.colors["observations"])
        else:
            draw_fit(figure, self.fit, x_label, y_label, project.colors)
        figure.savefig(path, format=path.suffix[1:].lower())


def main() -> None:
    matplotlib.use("Agg")
    sys.stdin.reconfigure(encoding="utf-8")
    worker = Workspace()
    for line in sys.stdin:
        try:
            request = json.loads(line)
            reply = {"state": worker.dispatch(request)}
        except (OSError, ValueError, TypeError, KeyError, csv.Error) as exc:
            reply = {"error": str(exc)}
        print(json.dumps(reply, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
