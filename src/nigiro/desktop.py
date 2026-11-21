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
from nigiro.batch_figure import overlay_figures
from nigiro.builtin_plugins import linear_fit_view
from nigiro.figure_style import AxisStyle, FigureStyle
from nigiro.plotting import draw_fit, draw_plot
from nigiro.plugin_registry import PluginRegistry, plugin_step
from nigiro.project import (
    AddFigureLayers, Correction, FigureAppearance, FigureColor, FigureRecord, ItemEdit, LinearFit, OverlayFigure, Plot, PluginStep, Project,
    ResidualFigure, Source, Worksheet,
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
    residual: dict | None = None


class Workspace:
    def __init__(self) -> None:
        self.project = Project()
        self.path: Path | None = None
        self.dirty = False
        folder = os.environ.get("NIGIRO_PLUGIN_DIR")
        self.plugins = PluginRegistry(Path(folder) if folder else None)
        self.results: dict[int, Execution] = {}
        self.combined: dict[int, Execution] = {}
        self.sources: dict[str, SourceTable] = {}
        self.figure_id: int | None = None
        self.source_id: str | None = None
        self.row_offset = 0
        self.render_version = 0
        self.figure_tokens: dict[int, str] = {}

    def set_project(self, project: Project, path: Path | None) -> None:
        project.validate()
        self.render(project, fallback=project.saved_sources)
        self.project = project
        self.figure_id = project.last_figure_id
        self.source_id = None
        self.path = path
        self.dirty = path is None and project.source is not None

    def execute(self, project: Project, record: FigureRecord, sources: dict[str, SourceTable]) -> Execution:
        step = plugin_step(record.recipe)
        worksheet = self.input_worksheet(project, step.source_id, sources)
        plugin = self.plugins.resolve(step)
        figure = self.plugins.execute(step, worksheet)
        legacy = figure.pop("legacy", None) if plugin.checksum is None else None
        tables = output_tables(figure, plugin.manifest["menu"] == "analysis")
        figure.pop("sources", None)
        figure["recipe"] = asdict(step)
        figure["definition"] = plugin.definition
        figure["source"] = plugin.source
        if record.part == "fit":
            return Execution(
                {**linear_fit_view(figure, "fit"), "part": "fit"},
                legacy, tables, residual={**linear_fit_view(figure, "residual"), "part": "residual"},
            )
        return Execution(figure, legacy, tables)

    @staticmethod
    def input_worksheet(project: Project, source_id: str | None, sources: dict[str, SourceTable]) -> Worksheet:
        if source_id in project.raw_sources:
            return project.working_worksheets[source_id]
        if source_id not in sources:
            raise ValueError("The input source is unavailable.")
        table = sources[source_id]
        return Worksheet(table.columns, table.rows)

    def render(
        self, project: Project, *, changed: set[int] | None = None,
        fallback: dict[str, SourceTable] | None = None, destinations: set[int] | None = None,
    ) -> None:
        results = {}
        sources = {}
        refreshed = set()
        for figure_id, record in project.figures.items():
            strict = changed is not None and figure_id in changed
            if record.overlay:
                continue
            if record.fit_id is not None:
                fit = results[record.fit_id]
                results[figure_id] = Execution(fit.residual, None, {}, fit.error)
                continue
            step = plugin_step(record.recipe)
            upstream = source_origin(step.source_id) if step.source_id is not None else None
            if changed is None or strict or upstream in refreshed:
                try:
                    result = self.execute(project, record, sources)
                except ValueError as exc:
                    if strict:
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
        combined = {}
        names = self.figure_names(project)
        for figure_id, record in project.figures.items():
            if not (record.overlay or record.layers):
                continue
            try:
                members = record.members(figure_id)
                inputs = [results[key] for key in members]
                if any(result.figure is None for result in inputs):
                    raise ValueError(next(result.error or "A figure layer is unavailable." for result in inputs if result.figure is None))
                labels = [self.source_name(project, result.figure["recipe"]["source_id"], sources, names) for result in inputs]
                figure = overlay_figures([result.figure for result in inputs], labels, preserve_first=record.overlay is None)
                combined[figure_id] = Execution(figure, None, {})
            except (ValueError, KeyError, TypeError) as exc:
                message = f"Could not combine the figures. {exc}"
                if (changed is not None and figure_id in changed) or (destinations is not None and figure_id in destinations):
                    raise ValueError(message) from exc
                combined[figure_id] = Execution(None, None, {}, message)
        self.render_version += 1
        self.figure_tokens = {
            key: self.figure_tokens[key] if self.results.get(key) is result and key in self.figure_tokens
            else f"{self.render_version}:{key}"
            for key, result in {**results, **combined}.items()
        }
        self.results = results
        self.combined = combined
        self.sources = sources
        if self.source_id not in project.raw_sources and self.source_id not in sources:
            self.source_id = None

    def figure_names(self, project: Project) -> dict[int, str]:
        names = {}
        counts: dict[str, int] = {}
        for figure_id, entry in project.figures.items():
            if entry.overlay:
                names[figure_id] = f"{names[entry.overlay.figure_ids[0]]} · Overlay"
            elif entry.fit_id is not None:
                names[figure_id] = f"Residuals · {names[entry.fit_id]}"
            else:
                step = plugin_step(entry.recipe)
                plugin = self.plugins.plugins.get(step.pin)
                label = plugin.manifest["name"] if plugin else step.plugin_id
                number = counts.get(step.plugin_id, 0) + 1
                counts[step.plugin_id] = number
                names[figure_id] = f"{label} {number}"
            names[figure_id] = project.item_names.get(("figure", figure_id), names[figure_id])
        return names

    def source_name(
        self, project: Project, key: str | None, sources: dict[str, SourceTable], names: dict[int, str]
    ) -> str:
        if key in project.raw_sources:
            default = project.raw_sources[key].name
            if key is not None:
                ordinal = 0
                for raw_id, source in project.raw_sources.items():
                    ordinal += source.name == default
                    if raw_id == key:
                        break
                if ordinal > 1:
                    default = f"{default} ({ordinal})"
        else:
            default = f"{names[source_origin(key)]} · {sources[key].name}"
        return project.item_names.get(("source", key), default)

    def input_table(self, project: Project, key: str | None) -> SourceTable | None:
        if key is None:
            return None
        if key in project.raw_sources:
            worksheet = project.working_worksheets[key]
            return SourceTable(project.raw_sources[key].name, worksheet.columns, worksheet.rows)
        return self.sources.get(key)

    def snapshot(self, *, paged: bool = False, known_figures: dict | None = None) -> dict:
        project = self.project
        state = {"plugins": self.plugins.catalog()}
        record = project.figures.get(self.figure_id)
        result = self.combined.get(self.figure_id) or self.results.get(self.figure_id)
        legacy = result.legacy if result else None
        figure_error = result.error if result else None
        recipe = record.recipe if record else None
        names = self.figure_names(project)
        selected_table = self.input_table(project, self.source_id)
        raw = project.raw_sources.get(self.source_id)
        figure_input = self.input_table(project, getattr(recipe, "source_id", None))
        figure = result.figure if result else None
        token = self.figure_tokens.get(self.figure_id) if figure else None
        figure_cached = paged and token is not None and (known_figures or {}).get(str(self.figure_id)) == token
        if figure_cached:
            figure = None
        if figure and (record.overlay or record.layers):
            inputs = []
            for key in (() if paged else record.members(self.figure_id)):
                member = self.results[key].figure
                source_id = member["recipe"]["source_id"]
                table = self.input_table(project, source_id)
                inputs.append({
                    "plugin": {**member["recipe"], "source": member["source"], "part": member.get("part")},
                    "input": asdict(table) if table else None,
                    "label": self.source_name(project, source_id, self.sources, names),
                })
            figure = {**figure, "overlay_inputs": inputs, "preserve_first": record.overlay is None}
            figure_input = None
        rows = selected_table.rows if selected_table else project.worksheet.rows
        total = len(rows)
        offset = min(self.row_offset, max(0, ((total - 1) // 100) * 100)) if paged else 0
        end = offset + 100 if paged else total
        original = raw.worksheet.rows if raw else None
        available = {**project.raw_sources, **self.sources}
        state["project"] = {
            "source_name": project.source.name if project.source else None,
            "file_name": self.path.name if self.path else None,
            "dirty": self.dirty,
            "columns": project.worksheet.columns,
            "rows": rows[offset:end] if paged else project.worksheet.rows,
            "original_rows": (original[offset:end] if original is not None else ()) if paged else (project.source.worksheet.rows if project.source else ()),
            "operations": [operation_record(op) for op in project.operations],
            "figures": [{"id": key, "name": names[key], **({"token": self.figure_tokens.get(key)} if paged else {})}
                        for key in project.visible_figures],
            "figure_id": self.figure_id,
            "figure_input": {"name": figure_input.name, "columns": figure_input.columns, "rows": () if paged else figure_input.rows} if figure_input else None,
            "sources": [
                {"id": key, "name": self.source_name(project, key, self.sources, names), "columns": table.worksheet.columns
                 if isinstance(table, Source) else table.columns}
                for key, table in available.items() if not project.item_deleted("source", key)
            ],
            "source_id": self.source_id,
            "source_table": {"name": selected_table.name, "columns": selected_table.columns, "rows": selected_table.rows[offset:end] if paged else selected_table.rows} if selected_table else None,
            "source_original_rows": (original[offset:end] if paged else original) if original is not None and self.source_id is not None else None,
            "row_offset": offset,
            "row_count": total,
            "figure_token": token,
            "figure_cached": figure_cached,
            "figure": figure,
            "figure_error": figure_error,
            "fit": legacy if not paged and isinstance(recipe, LinearFit) else None,
            "fit_error": figure_error if isinstance(recipe, LinearFit) else None,
            "plot": {**operation_record(recipe), **legacy} if not paged and isinstance(recipe, Plot) and legacy is not None else None,
            "plot_error": figure_error if isinstance(recipe, Plot) else None,
            "colors": record.colors if record else project.colors,
            "figure_style": asdict(record.style if record else FigureStyle()),
            "default_figure_style": asdict(
                FigureStyle(y=AxisStyle(zero_line=True)) if record and record.part == "residual" else FigureStyle()
            ),
            "versions": {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
        }
        return state

    def dispatch(self, request: dict) -> dict:
        if request["action"] in ("new", "open", "select_source"):
            self.row_offset = 0
        match request["action"]:
            case "worksheet_page":
                offset = request["offset"]
                if type(offset) is not int or offset < 0:
                    raise ValueError("Choose a valid worksheet page.")
                self.row_offset = (offset // 100) * 100
            case "state":
                pass
            case "new":
                self.set_project(Project(), None)
            case "sample":
                self.import_sources((Source("Sample data.csv", SAMPLE),))
            case "import_data" | "import_csv" | "add_sources":
                paths = (Path(value) for value in (request["paths"] if "paths" in request else [request["path"]]))
                self.import_sources(tuple(Source(path.name, path.read_bytes()) for path in paths))
            case "open":
                path = Path(request["path"])
                self.set_project(load_project(path), path)
            case "install_plugin":
                self.plugins.install(Path(request["path"]))
                if any(result.error for result in self.results.values()):
                    self.render(self.project, fallback=self.sources)
            case "export_rendered":
                from nigiro.figure_export import write_figure

                fonts = Path(__file__).with_name("fonts")
                write_figure(Path(request["path"]), request["svg"], request["scale"], fonts)
                return {}
            case _:
                self.apply(request)
        return self.snapshot(paged=request.get("_paged", False), known_figures=request.get("_known_figures"))

    def import_sources(self, additions: tuple[Source, ...]) -> None:
        if not additions:
            raise ValueError("Choose at least one CSV file.")
        project = self.project
        updated = replace(project, additional_sources=(*project.additional_sources, *additions)) if project.source else replace(
            project, source=additions[0], additional_sources=additions[1:]
        )
        updated.validate()
        self.project = updated
        self.dirty = True

    def apply(self, request: dict) -> None:
        project = self.project

        match request["action"]:
            case "select_source":
                source_id = request["source_id"]
                if (source_id not in self.sources and source_id not in project.raw_sources) or project.item_deleted("source", source_id):
                    raise ValueError("Select an available source.")
                self.source_id = source_id
            case "select_figure":
                figure_id = request["figure_id"]
                if type(figure_id) is not int or figure_id not in project.visible_figures:
                    raise ValueError("Select an available figure.")
                self.figure_id = figure_id
            case "edit_item":
                item = request["item"]
                operation = ItemEdit(item["kind"], item["id"], request["name"])
                key = (operation.target, operation.item_id)
                if operation.target == "figure" and operation.item_id not in project.visible_figures:
                    raise ValueError("Select an available figure.")
                if operation.target == "source" and operation.item_id is not None and (
                    (operation.item_id not in self.sources and operation.item_id not in project.raw_sources)
                    or project.item_deleted(*key)
                ):
                    raise ValueError("Select an available source.")
                if key in project.item_edits and project.item_edits[key] == operation.name:
                    return
                updated = project.apply(operation)
                self.render(updated, changed=set())
                self.project = updated
                if self.figure_id not in updated.visible_figures:
                    self.figure_id = updated.last_figure_id
                if updated.item_deleted("source", self.source_id):
                    self.source_id = None
                self.dirty = True
            case "correct":
                if self.source_id not in project.raw_sources:
                    raise ValueError("Select the imported source to correct its worksheet.")
                operation = Correction(request["row"], request["column"], request["value"], self.source_id)
                updated = project.apply(operation)
                if project.working_worksheets[self.source_id].rows[operation.row][operation.column] != operation.value:
                    self.render(updated, fallback=self.sources)
                    self.project = updated
                    self.dirty = True
            case "run_batch":
                self.run_batch(project, request)
            case "execute_plugin":
                self.run_batch(project, {**request, "steps": [request]})
            case "run_plugin" | "fit" | "plot":
                figure_id = len(project.operations)
                selection = figure_id
                if request["action"] == "run_plugin":
                    target = request.get("figure_id")
                    source_id = self.source_id
                    if target is not None:
                        if type(target) is not int or target not in project.visible_figures:
                            raise ValueError("Select an available figure.")
                        selection = target
                        entry = project.figures[target]
                        if entry.overlay or entry.layers:
                            raise ValueError("Use a new command to add data to a combined figure.")
                        if entry.fit_id is not None:
                            target = entry.fit_id
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
                if isinstance(recipe, PluginStep) and recipe.figure_id is None and recipe.pin == ("nigiro.linear_fit", "1", None):
                    updated = updated.apply(ResidualFigure(figure_id))
                self.render(updated, changed={figure_id}, fallback=self.sources)
                self.figure_id = selection
                self.project = updated
                self.dirty = True
            case "color" | "figure_style":
                figure_id = request.get("figure_id", self.figure_id)
                if type(figure_id) is not int or figure_id not in project.visible_figures:
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

    def run_batch(self, project: Project, request: dict) -> None:
        output, steps = request["output"], request["steps"]
        if output not in ("overlay", "separate") or not isinstance(steps, list) or not steps:
            raise ValueError("Choose batch commands and an output mode.")
        operations = list(project.operations)
        changed = set()
        destinations = set()
        for step in steps:
            runs = step["runs"]
            if not isinstance(runs, list) or not runs:
                raise ValueError("Select at least one source.")
            ids, residuals, seen, targets = [], [], set(), set()
            for run in runs:
                source_id = run["source_id"]
                if source_id in seen or project.item_deleted("source", source_id):
                    raise ValueError("Select different available sources.")
                self.input_worksheet(project, source_id, self.sources)
                seen.add(source_id)
                recipe = PluginStep(step["plugin_id"], step["version"], step["checksum"], run["options"], source_id=source_id)
                figure_id = len(operations)
                operations.append(recipe)
                changed.add(figure_id)
                ids.append(figure_id)
                if recipe.pin == ("nigiro.linear_fit", "1", None):
                    residuals.append(len(operations))
                    operations.append(ResidualFigure(figure_id))
                destination = run.get("target_id") if output == "separate" else None
                if destination is not None:
                    self.validate_destination(project, destination)
                    if destination in targets:
                        raise ValueError("Choose a different figure for each source, or overlay the sources.")
                    targets.add(destination)
                    operations.append(AddFigureLayers(destination, (figure_id,)))
                    destinations.add(destination)
                selection = figure_id if destination is None else destination
            if output == "overlay":
                destination = step.get("target_id")
                if destination is not None:
                    self.validate_destination(project, destination)
                    operations.append(AddFigureLayers(destination, ids))
                    destinations.add(destination)
                    selection = destination
                elif len(ids) > 1:
                    selection = len(operations)
                    changed.add(selection)
                    operations.append(OverlayFigure(ids))
                if len(residuals) > 1:
                    changed.add(len(operations))
                    operations.append(OverlayFigure(residuals, fit_id=selection if destination is None else None))
        updated = replace(project, operations=tuple(operations))
        updated.validate()
        self.render(updated, changed=changed, fallback=self.sources, destinations=destinations)
        self.project = updated
        self.figure_id = selection
        self.dirty = True

    def validate_destination(self, project: Project, figure_id: int) -> None:
        if type(figure_id) is not int or figure_id not in project.visible_figures:
            raise ValueError("Choose an existing figure that can be drawn.")
        result = self.combined.get(figure_id) or self.results.get(figure_id)
        if result is None or result.figure is None:
            raise ValueError("Choose an existing figure that can be drawn.")

    def export(self, path: Path) -> None:
        if path.suffix.lower() not in (".svg", ".pdf"):
            raise ValueError("Choose a file name with the .svg or .pdf extension.")
        project = self.project
        execution = self.combined.get(self.figure_id) or self.results.get(self.figure_id)
        if execution is None or execution.legacy is None:
            raise ValueError("Create a figure before you export it.")
        record = project.figures[self.figure_id]
        step = plugin_step(record.recipe)
        legacy = execution.legacy
        columns = self.input_worksheet(project, step.source_id, self.sources).columns
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
