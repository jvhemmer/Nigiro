"""Workspace commands for the desktop app, sent as JSON lines over standard I/O."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import matplotlib
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from nigiro.analysis import FitResult, run_linear_fit
from nigiro.plotting import draw_fit
from nigiro.project import Correction, FigureColor, LinearFit, Project, Source
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
        self.fit_error: str | None = None

    def set_project(self, project: Project, path: Path | None) -> None:
        project.validate()
        result = None
        error = None
        if project.fit is not None:
            try:
                result = run_linear_fit(project.worksheet, project.fit)
            except ValueError as exc:
                error = str(exc)
        self.fit = result
        self.fit_error = error
        self.project = project
        self.path = path
        self.dirty = path is None

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
            "fit_error": self.fit_error,
            "colors": project.colors,
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
            case "fit":
                recipe = LinearFit(request["x"], request["y"])
                updated = project.apply(recipe)
                self.fit = run_linear_fit(updated.worksheet, recipe)
                self.project = updated
                self.fit_error = None
                self.dirty = True
            case "color":
                operation = FigureColor(request["element"], request["color"])
                if project.colors[operation.element] != operation.color:
                    self.project = project.apply(operation)
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
        if project is None or project.fit is None or self.fit is None:
            raise ValueError("Run a linear fit before you export the figure.")
        columns = project.worksheet.columns
        figure = Figure(figsize=(8, 5.5), layout="constrained")
        FigureCanvasAgg(figure)
        draw_fit(figure, self.fit, columns[project.fit.x], columns[project.fit.y], project.colors)
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
