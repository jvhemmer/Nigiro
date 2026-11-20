"""Workspace commands for the desktop app, sent as JSON lines over standard I/O."""

from __future__ import annotations

import csv
import json
import os
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import matplotlib
import numpy
import scipy
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from nigiro.analysis import FitResult, PlotResult
from nigiro.figure_style import FigureStyle
from nigiro.plotting import draw_fit, draw_plot
from nigiro.plugin_registry import PluginRegistry, plugin_step
from nigiro.project import (
    Correction, FigureAppearance, FigureColor, FigureRecord, LinearFit, Plot, PluginStep, Project, Source, Worksheet,
)
from nigiro.source_tables import SourceTable, output_tables, source_origin
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


@dataclass(frozen=True)
class Execution:
    figure: dict | None
    legacy: dict | None
    tables: dict[str, SourceTable]
    error: str | None = None


class Workspace:
    def __init__(self) -> None:
        self.project: Project | None = None
        self.path: Path | None = None
        self.dirty = False
        folder = os.environ.get("NIGIRO_PLUGIN_DIR")
        self.plugins = PluginRegistry(Path(folder) if folder else None)
        self.results: dict[int, Execution] = {}
        self.sources: dict[str, SourceTable] = {}
        self.figure_id: int | None = None
        self.source_id: str | None = None

    def set_project(self, project: Project, path: Path | None) -> None:
        project.validate()
        self.render(project, fallback=project.saved_sources)
        self.project = project
        self.figure_id = next(reversed(project.figures), None)
        self.source_id = None
        self.path = path
        self.dirty = path is None

    def execute(self, project: Project, record: FigureRecord, sources: dict[str, SourceTable]) -> Execution:
        step = plugin_step(record.recipe)
        worksheet = project.worksheet
        if step.source_id is not None:
            table = sources.get(step.source_id)
            if table is None:
                raise ValueError("The input source is unavailable.")
            worksheet = Worksheet(table.columns, table.rows)
        plugin = self.plugins.resolve(step)
        figure = self.plugins.execute(step, worksheet)
        legacy = figure.pop("legacy", None) if plugin.checksum is None else None
        tables = output_tables(figure, plugin.manifest["menu"] == "analysis")
        figure.pop("sources", None)
        figure["recipe"] = asdict(step)
        figure["definition"] = plugin.definition
        figure["source"] = plugin.source
        return Execution(figure, legacy, tables)

    def render(self, project: Project, *, changed: int | None = None, fallback: dict[str, SourceTable] | None = None) -> None:
        results = {}
        sources = {}
        refreshed = set()
        for figure_id, record in project.figures.items():
            step = plugin_step(record.recipe)
            upstream = source_origin(step.source_id) if step.source_id is not None else None
            if changed is None or figure_id == changed or upstream in refreshed:
                try:
                    result = self.execute(project, record, sources)
                except ValueError as exc:
                    if figure_id == changed:
                        raise
                    saved = {
                        key.split(":", 1)[1]: table for key, table in (fallback or {}).items()
                        if source_origin(key) == figure_id
                    }
                    result = Execution(None, None, saved, str(exc))
                refreshed.add(figure_id)
            else:
                result = self.results[figure_id]
            results[figure_id] = result
            sources.update({f"{figure_id}:{key}": table for key, table in result.tables.items()})
        self.results = results
        self.sources = sources
        if self.source_id not in sources:
            self.source_id = None

    def snapshot(self) -> dict:
        project = self.project
        state = {"plugins": self.plugins.catalog(), "project": None}
        if project is None:
            return state

        record = project.figures.get(self.figure_id)
        result = self.results.get(self.figure_id)
        legacy = result.legacy if result else None
        figure_error = result.error if result else None
        recipe = record.recipe if record else None
        figures = []
        names = {}
        for number, (figure_id, entry) in enumerate(project.figures.items(), start=1):
            step = plugin_step(entry.recipe)
            plugin = self.plugins.plugins.get(step.pin)
            label = plugin.manifest["name"] if plugin else step.plugin_id
            names[figure_id] = f"{label} {number}"
            figures.append({"id": figure_id, "name": names[figure_id]})
        selected_table = self.sources.get(self.source_id)
        figure_input = self.sources.get(getattr(recipe, "source_id", None))
        state["project"] = {
            "source_name": project.source.name,
            "file_name": self.path.name if self.path else None,
            "dirty": self.dirty,
            "columns": project.worksheet.columns,
            "rows": project.worksheet.rows,
            "original_rows": project.source.worksheet.rows,
            "operations": [operation_record(op) for op in project.operations],
            "figures": figures,
            "figure_id": self.figure_id,
            "figure_input": asdict(figure_input) if figure_input else None,
            "sources": [{"id": None, "name": project.source.name}] + [
                {"id": key, "name": f"{names[source_origin(key)]} · {table.name}"}
                for key, table in self.sources.items()
            ],
            "source_id": self.source_id,
            "source_table": asdict(selected_table) if selected_table else None,
            "figure": result.figure if result else None,
            "figure_error": figure_error,
            "fit": legacy if isinstance(recipe, LinearFit) else None,
            "fit_error": figure_error if isinstance(recipe, LinearFit) else None,
            "plot": {**operation_record(recipe), **legacy} if isinstance(recipe, Plot) and legacy is not None else None,
            "plot_error": figure_error if isinstance(recipe, Plot) else None,
            "colors": record.colors if record else project.colors,
            "figure_style": asdict(record.style if record else FigureStyle()),
            "default_figure_style": asdict(FigureStyle()),
            "versions": {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
        }
        return state

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
            case "install_plugin":
                self.plugins.install(Path(request["path"]))
                if self.project is not None and any(result.error for result in self.results.values()):
                    self.render(self.project, fallback=self.sources)
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
            case "select_source":
                source_id = request["source_id"]
                if source_id is not None and source_id not in self.sources:
                    raise ValueError("Select an available source.")
                self.source_id = source_id
            case "select_figure":
                figure_id = request["figure_id"]
                if type(figure_id) is not int or figure_id not in project.figures:
                    raise ValueError("Select an available figure.")
                self.figure_id = figure_id
            case "correct":
                if self.source_id is not None:
                    raise ValueError("Select the imported source to correct its worksheet.")
                operation = Correction(request["row"], request["column"], request["value"])
                updated = project.apply(operation)
                if project.worksheet.rows[operation.row][operation.column] != operation.value:
                    self.render(updated)
                    self.project = updated
                    self.dirty = True
            case "run_plugin" | "fit" | "plot":
                figure_id = len(project.operations)
                if request["action"] == "run_plugin":
                    target = request.get("figure_id")
                    source_id = self.source_id
                    if target is not None:
                        if type(target) is not int or target not in project.figures:
                            raise ValueError("Select an available figure.")
                        previous = plugin_step(project.figures[target].recipe)
                        source_id = previous.source_id
                        figure_id = target
                    recipe = PluginStep(
                        request["plugin_id"], request["version"], request["checksum"], request["options"],
                        source_id=source_id, figure_id=target,
                    )
                    if target is not None and recipe.pin != previous.pin:
                        raise ValueError("Use the original plugin to change its options.")
                elif request["action"] == "fit":
                    recipe = LinearFit(request["x"], request["y"])
                else:
                    recipe = Plot(request["plot_type"], request["x"], request["y"])
                updated = project.apply(recipe)
                self.render(updated, changed=figure_id)
                self.figure_id = figure_id
                self.project = updated
                self.dirty = True
            case "color" | "figure_style":
                figure_id = request.get("figure_id", self.figure_id)
                if type(figure_id) is not int or figure_id not in project.figures:
                    raise ValueError("Select a figure first.")
                record = project.figures[figure_id]
                if request["action"] == "color":
                    operation = FigureColor(request["element"], request["color"], figure_id)
                    if record.colors[operation.element] == operation.color:
                        return
                else:
                    style = FigureStyle(**request["style"])
                    if style == record.style:
                        return
                    operation = FigureAppearance(figure_id, style)
                self.project = project.apply(operation)
                self.dirty = True
            case "save":
                path = Path(request["path"]) if "path" in request else self.path
                if path is None or path.suffix.lower() != ".nigiro":
                    raise ValueError("Choose a file name with the .nigiro extension.")
                save_project(path, replace(project, saved_sources=self.sources))
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
        execution = self.results.get(self.figure_id)
        if project is None or execution is None or execution.legacy is None:
            raise ValueError("Create a figure before you export it.")
        record = project.figures[self.figure_id]
        step = plugin_step(record.recipe)
        legacy = execution.legacy
        columns = self.sources[step.source_id].columns if step.source_id else project.worksheet.columns
        figure = Figure(figsize=(8, 5.5), layout="constrained")
        FigureCanvasAgg(figure)
        x_label, y_label = columns[step.options["x"]], columns[step.options["y"]]
        if step.plugin_id == "nigiro.linear_fit":
            result = FitResult(**{
                key: numpy.asarray(value) if isinstance(value, list) else value
                for key, value in legacy.items()
            })
            draw_fit(figure, result, x_label, y_label, record.colors)
        else:
            result = PlotResult(legacy["x_values"], legacy["y_values"], legacy["omitted_rows"])
            draw_plot(figure, step.plugin_id.split(".", 1)[1], result, x_label, y_label, record.colors["observations"])
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
