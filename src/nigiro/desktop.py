"""Workspace commands for the desktop app, sent as JSON lines over standard I/O."""

from __future__ import annotations

import csv
import json
import os
import sys
from collections import Counter
from copy import copy
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from uuid import uuid4

import matplotlib
import numpy
import scipy
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from nigiro.analysis import FitResult, PlotResult
from nigiro.batch_figure import overlay_figures, single_xy_figure
from nigiro.builtin_plugins import linear_fit_view
from nigiro.column_formula import ARRAY_FORMULA_PLUGIN, COLUMN_FORMULA_PLUGIN, REFERENCE_FORMULA_PLUGINS, parse_formula
from nigiro.figure_style import AxisStyle, FigureStyle
from nigiro.plotting import draw_fit, draw_plot
from nigiro.plugin_registry import PluginRegistry, plugin_step
from nigiro.project import (
    AddFigureLayers, Correction, FigureAppearance, FigureColor, FigureRecord, ItemEdit, LinearFit, OverlayFigure, Plot, PluginStep, Project,
    ResidualFigure, ScaleColumn, Source, TraceAppearance, Worksheet, normalize_comment, valid_plugin_option,
)
from nigiro.source_tables import FIT_PLUGINS, SourceTable, output_tables, source_origin
from nigiro.system_fonts import SystemFonts
from nigiro.text_import import PREVIEW_BYTES, TextImport, guess_import, import_preview
from nigiro.settings import Appearance, Settings
from nigiro.storage import load_project_session, operation_record, save_project
from nigiro.workflow import Step, Workflow, map_references
from nigiro.workflow_file import command_group_ids, read_workflow, register_workflow, validate_workflow, workflow_catalog, write_workflow
from nigiro.workspace_file import ProjectCollection


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
    dependencies: dict[str, str] | None = None


class Workspace:
    plugin_dialog_actions = ("execute_plugin", "run_plugin", "apply_formula")

    def __init__(self) -> None:
        self.project = Project()
        self.workflow = Workflow(self.project)
        self.fonts = SystemFonts()
        self.path: Path | None = None
        self.collection: ProjectCollection | None = None
        self.dirty = False
        folder = os.environ.get("NIGIRO_PLUGIN_DIR")
        settings_path = os.environ.get("NIGIRO_SETTINGS_PATH")
        config = Path(folder).parent if folder else Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "nigiro"
        self.settings = Settings(Path(settings_path) if settings_path else config / "settings.json")
        self.workflow_directory = self.settings.path.parent / "workflows"
        self.saved_workflows = workflow_catalog(self.workflow_directory)
        self.plugins = PluginRegistry(Path(folder) if folder else None)
        self.results: dict[int, Execution] = {}
        self.combined: dict[int, Execution] = {}
        self.sources: dict[str, SourceTable] = {}
        self.figure_id: int | None = None
        self.source_id: str | None = None
        self.row_offset = 0
        self.render_version = 0
        self.figure_tokens: dict[int, str] = {}
        self.plugin_edit_prefix: tuple[int, Workspace] | None = None

    def set_project(self, project: Project, path: Path | None) -> None:
        project.validate()
        self.render(project, fallback=project.saved_sources)
        self.project = project
        self.workflow = Workflow(project)
        self.figure_id = project.last_figure_id
        self.source_id = None
        self.row_offset = 0
        self.path = path
        self.dirty = path is None and project.source is not None

    def open_project(self, path: Path) -> None:
        project, workflow = load_project_session(path)
        self.set_project(project, path)
        self.workflow = workflow
        imported = project.last_import_path
        self.remember_paths(
            import_path=imported if imported and Path(imported).parent.is_dir() else None,
            project_path=str(path),
        )

    def open_workspace(self, path: Path) -> None:
        collection = ProjectCollection.open(path)
        candidates = tuple(dict.fromkeys(project for project in (collection.active, *collection.projects) if project is not None))
        for project in candidates:
            try:
                self.open_project(project)
            except (OSError, ValueError, csv.Error):
                continue
            collection = collection.select(project)
            break
        else:
            self.set_project(Project(), None)
        self.collection = collection
        self.remember_paths(workspace_path=str(path))

    def execute(self, project: Project, record: FigureRecord, sources: dict[str, SourceTable]) -> Execution:
        step = plugin_step(record.recipe)
        worksheet = (project.plugin_input(step, sources) if isinstance(record.recipe, PluginStep)
                     else project.recipe_input(step.source_id, record.recipe, sources))
        plugin = self.plugins.resolve(step)
        figure, dependencies = self.plugins.execute(step, worksheet, project.recipe_references(step, sources))
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
        return Execution(figure, legacy, tables, dependencies=dependencies or None)

    @staticmethod
    def input_worksheet(project: Project, source_id: str | None, sources: dict[str, SourceTable]) -> Worksheet:
        if source_id in project.raw_sources:
            return project.working_worksheets[source_id]
        if source_id not in sources:
            raise ValueError("The input source is unavailable.")
        table = sources[source_id]
        return Worksheet(table.columns, table.rows)

    @staticmethod
    def overlay_inputs(record, figure_id, results, combined):
        inputs = []
        for index, key in enumerate(record.members(figure_id)):
            use_combined = index < record.combined_input_count
            result = combined[key] if use_combined and key in combined else results[key]
            if result.figure is None:
                raise ValueError(result.error or "A figure layer is unavailable.")
            inputs.append(result.figure)
        return inputs

    def overlay_labels(self, project, figure_id, sources, names):
        record = project.figures[figure_id]
        return [
            names[key] if index < record.combined_input_count else self.source_name(
                project, plugin_step(project.figures[key].recipe).source_id, sources, names,
            )
            for index, key in enumerate(record.members(figure_id))
        ]

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
            inputs = (step.source_id, *(reference.source_id for reference in step.references.values()))
            upstream = {source_origin(source_id) for source_id in inputs if source_id is not None}
            if changed is None or strict or not upstream.isdisjoint(refreshed):
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
                inputs = self.overlay_inputs(record, figure_id, results, combined)
                labels = self.overlay_labels(project, figure_id, sources, names)
                figure = overlay_figures(inputs, labels, preserve_first=record.overlay is None,
                                         single_axes=bool(record.combined_input_count))
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
            if entry.combined_input_count:
                number = counts.get("overlay", 0) + 1
                counts["overlay"] = number
                names[figure_id] = f"Overlay {number}"
            elif entry.overlay:
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
            origin = source_origin(key)
            recipe = project.figures[origin].recipe
            default = sources[key].name if isinstance(recipe, PluginStep) and recipe.plugin_id == ARRAY_FORMULA_PLUGIN else (
                f"{names[origin]} · {sources[key].name}"
            )
        return project.item_names.get(("source", key), default)

    def input_table(self, project: Project, key: str | None) -> SourceTable | None:
        if key is None:
            return None
        if key in project.raw_sources:
            worksheet = project.working_worksheets[key]
            return SourceTable(project.raw_sources[key].name, worksheet.columns, worksheet.rows)
        return self.sources.get(key)

    def source_details(self, project: Project) -> dict:
        details = {}
        for key, source in project.raw_sources.items():
            if source.scalar_value is not None:
                details[key] = f"= {source.scalar_value}"
        for step in self.workflow.steps:
            if step.request["action"] != "add_array" or "values" not in step.request:
                continue
            output = f"{step.id}/source/0"
            if output in self.workflow.bindings:
                key = self.workflow.bindings[output]
                if key in project.raw_sources:
                    rows = project.raw_sources[key].worksheet.rows
                    preview = ", ".join(row[0] for row in rows[:16])
                    details[key] = f"= [{preview}{', …' if len(rows) > 16 else ''}]"
        for key in self.sources:
            recipe = project.figures[source_origin(key)].recipe
            if isinstance(recipe, PluginStep) and recipe.plugin_id == ARRAY_FORMULA_PLUGIN:
                details[key] = f"= {recipe.options['expression']}"
        return details

    def array_producers(self) -> dict:
        producers = {}
        for step in self.workflow.steps:
            if step.request["action"] != "add_array":
                continue
            formula = "expression" in step.request
            output = f"{step.id}/{'figure' if formula else 'source'}/0"
            if output in self.workflow.bindings:
                key = self.workflow.bindings[output]
                producers[f"{key}:calculated" if formula else key] = step.id
        return producers

    def workflow_source_runs(self) -> dict[str | None, str]:
        bindings = self.workflow.bindings
        runs = {}
        for step in self.workflow.steps:
            if step.request["action"] != "invoke_workflow":
                continue
            slots = self.workflow_output_slots(step.request)
            for port in step.request["definition"]["outputs"]:
                output = f"{step.id}/source/{slots[self.workflow_output_key(port)]}"
                if port["kind"] == "source" and output in bindings:
                    runs[bindings[output]] = step.request["name"]
        return runs

    @staticmethod
    def source_comment(project: Project, key: str | None, source: Source | SourceTable) -> str | None:
        if isinstance(source, Source):
            return source.comment
        recipe = project.figures[source_origin(key)].recipe
        return recipe.comment if isinstance(recipe, PluginStep) else None

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
            members = self.overlay_inputs(record, self.figure_id, self.results, self.combined)
            labels = self.overlay_labels(project, self.figure_id, self.sources, names)
            inputs = []
            for member, label in zip(members, labels, strict=True):
                if paged:
                    inputs.append({"label": label})
                    continue
                source_id = member["recipe"]["source_id"]
                table = self.input_table(project, source_id)
                inputs.append({
                    "plugin": {**member["recipe"], "source": member["source"], "part": member.get("part")},
                    "input": asdict(table) if table else None,
                    "label": label,
                })
            figure = {**figure, "overlay_inputs": inputs, "preserve_first": record.overlay is None}
            figure_input = None
        rows = selected_table.rows if selected_table else project.worksheet.rows
        total = len(rows)
        offset = min(self.row_offset, max(0, ((total - 1) // 100) * 100)) if paged else 0
        end = offset + 100 if paged else total
        original = raw.worksheet.rows if raw else None
        available = {**project.raw_sources, **self.sources}
        details = self.source_details(project)
        ordered_sources = self.ordered_sources()
        groups, memberships = self.source_layout(ordered_sources, names)
        short_names = Counter((memberships[key], available[key].name) for key in ordered_sources if memberships[key])
        array_producers = self.array_producers()
        workflow_runs = self.workflow_source_runs()
        state["project"] = {
            "notes": project.notes,
            "workspace": {
                "name": self.collection.path.stem if self.collection.path else "Untitled workspace",
                "path": str(self.collection.path) if self.collection.path else None,
                "dirty": self.collection.dirty,
                "active_project": str(self.path) if self.path in self.collection.projects else None,
                "projects": [{"name": path.stem, "path": str(path)} for path in self.collection.projects],
            } if self.collection else None,
            "recent_workspaces": [{"name": Path(path).stem, "path": path} for path in self.settings.recent_workspaces],
            "source_name": project.source.name if project.source else None,
            "file_name": self.path.name if self.path else None,
            "dirty": self.dirty,
            "run_automatically": self.settings.run_automatically,
            "workflow": self.workflow_snapshot(),
            "saved_workflows": [{"id": key, "name": record["name"], "inputs": record["inputs"], "outputs": record["outputs"]}
                                for key, record in self.saved_workflows.items()],
            "columns": project.worksheet.columns,
            "rows": rows[offset:end] if paged else project.worksheet.rows,
            "original_rows": (original[offset:end] if original is not None else ()) if paged else (project.source.worksheet.rows if project.source else ()),
            "operations": [operation_record(op) for op in project.operations],
            "figures": [{
                "id": key, "name": names[key],
                "overlayable": single_xy_figure((self.combined.get(key) or self.results[key]).figure),
                **({"token": self.figure_tokens.get(key)} if paged else {}),
            } for key in project.visible_figures],
            "figure_id": self.figure_id,
            "figure_input": {"name": figure_input.name, "columns": figure_input.columns, "rows": () if paged else figure_input.rows} if figure_input else None,
            "source_groups": groups,
            "sources": [
                {"id": key, "name": name, "columns": table.worksheet.columns
                 if isinstance(table, Source) else table.columns,
                 "original_path": table.original_path if isinstance(table, Source) else None,
                 "kind": "raw" if isinstance(table, Source) else "derived",
                 "group_id": memberships[key],
                 **({"group_name": name if short_names[memberships[key], table.name] > 1
                     else project.item_names.get(("source", key), table.name)}
                    if memberships[key] is not None and isinstance(table, SourceTable) else {}),
                 **({"scalar": True} if isinstance(table, Source) and table.scalar_value is not None else {}),
                 **({"scalar_formula": table.scalar_formula["expression"]}
                    if isinstance(table, Source) and table.scalar_formula is not None else {}),
                 **({"detail": details[key]} if key in details else {}),
                 **({"array_step": array_producers[key]} if key in array_producers else {}),
                 **({"workflow_run": workflow_runs[key]} if key in workflow_runs else {}),
                 **({"comment": comment} if (comment := self.source_comment(project, key, table)) else {}),
                 "row_count": len(table.worksheet.rows if isinstance(table, Source) else table.rows)}
                for key in ordered_sources for table in (available[key],)
                for name in (self.source_name(project, key, self.sources, names),)
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
            "trace_styles": record.trace_styles if record else {},
            "fit": legacy if not paged and isinstance(recipe, LinearFit) else None,
            "fit_error": figure_error if isinstance(recipe, LinearFit) else None,
            "plot": {**operation_record(recipe), **legacy} if not paged and isinstance(recipe, Plot) and legacy is not None else None,
            "plot_error": figure_error if isinstance(recipe, Plot) else None,
            "colors": record.colors if record else project.colors,
            "figure_style": asdict(record.style if record else FigureStyle()),
            "appearance": asdict(self.settings.appearance),
            "global_figure_style": asdict(self.settings.figure_style),
            "factory_figure_style": asdict(FigureStyle()),
            "default_figure_style": asdict(self.settings.figure_style),

            "versions": {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
        }
        return state

    def ordered_sources(self) -> list[str | None]:
        active = dict.fromkeys(key for key in (*self.project.raw_sources, *self.sources)
                               if not self.project.item_deleted("source", key))
        ordered = {}
        for reference in self.workflow.source_order:
            try:
                key = self.workflow.resolve("source", reference)
            except ValueError:
                continue
            if key in active:
                ordered[key] = None
        return list(ordered | active)

    def source_layout(self, sources, figure_names):
        plan = self.workflow
        commands = {f"step:{step.id}": step.request for step in plan.steps[:plan.completed]}
        producers = {}
        for key in sources:
            origin = source_origin(key) if key is not None else None
            if origin is not None:
                reference = plan.reference("source", key)
                group_id = f"step:{reference['output'].split('/')[0]}" if isinstance(reference, dict) else f"figure:{origin}"
                producers.setdefault(group_id, []).append((key, origin))
        groups = {}
        memberships = {}
        for key, origins in producers.items():
            destination = commands.get(key, {}).get("output_group")
            if destination is None and len(origins) > 1:
                groups[key] = {"name": figure_names[origins[0][1]], "collapsed": False}
                memberships.update((source, key) for source, _ in origins)
            elif destination and destination["mode"] != "ungrouped":
                target = key if destination["mode"] == "new" else destination["id"]
                memberships.update((source, target) for source, _ in origins)
        for key, command in commands.items():
            destination = command.get("output_group")
            if destination and destination["mode"] == "new":
                groups[key] = {"name": destination["name"], "collapsed": False}
        for key, settings in plan.source_groups.items():
            if settings.get("deleted"):
                groups.pop(key, None)
            elif key.startswith("manual:") or key in groups:
                groups[key] = {**groups.get(key, {}), **settings}
        for source in sources:
            key = self.source_membership_key(source)
            group = plan.source_memberships.get(key, memberships.get(source))
            memberships[source] = group if group in groups else None
        return [{"id": key, **value} for key, value in groups.items()], memberships

    def group_sources(self, group_id):
        sources = self.ordered_sources()
        groups, memberships = self.source_layout(sources, self.figure_names(self.project))
        if not any(group["id"] == group_id for group in groups):
            raise ValueError("Choose a source group available before this step.")
        return [source for source in sources if memberships[source] == group_id]

    def source_membership_key(self, source_id):
        return json.dumps(self.workflow.reference("source", source_id), sort_keys=True)

    def change_source_group(self, request):
        groups, _ = self.source_layout(self.ordered_sources(), self.figure_names(self.project))
        mode = request["mode"]
        group_id = request.get("group_id")
        if mode == "create":
            group_id = f"manual:{uuid4().hex}"
        elif not any(group["id"] == group_id for group in groups):
            raise ValueError("Choose an available source group.")
        settings = self.workflow.source_groups.get(group_id, {}).copy()
        if mode in ("create", "rename"):
            name = (request.get("name") or "").strip()
            if not name:
                raise ValueError("Enter a group name.")
            settings.update(name=name)
            settings.setdefault("collapsed", False)
        elif mode == "toggle":
            settings["collapsed"] = not next(group["collapsed"] for group in groups if group["id"] == group_id)
        elif mode == "delete":
            settings = {"deleted": True}
        else:
            raise ValueError("Choose a source group action.")
        self.workflow.source_groups[group_id] = settings
        self.dirty = True

    def move_source(self, source_id: str | None, destination: int, *, placement: dict | None = None) -> None:
        sources = self.ordered_sources()
        if source_id not in sources or type(destination) is not int or not 0 <= destination < len(sources):
            raise ValueError("Choose an available source and position.")
        if placement is not None:
            group_id = placement["group_id"]
            groups, _ = self.source_layout(sources, self.figure_names(self.project))
            if group_id is not None and not any(group["id"] == group_id for group in groups):
                raise ValueError("Choose an available source group.")
            self.workflow.source_memberships[self.source_membership_key(source_id)] = group_id
        sources.remove(source_id)
        sources.insert(destination, source_id)
        self.workflow.source_order = [self.workflow.reference("source", key) for key in sources]
        self.dirty = True

    def step_label(self, request: dict, fallback: str) -> str:
        match request["action"]:
            case "edit_item":
                return "Remove item" if request["name"] is None else "Rename item"
            case "fit":
                return "Analysis: Linear Fit"
            case "add_scalar":
                return f"Add variable {request['name']}"
            case "add_array":
                return f"Add array {request['name']}"
            case "invoke_workflow":
                return f"Workflow: {request['name']}"
            case "apply_formula":
                return "Analysis: Column Formula"
            case "plot":
                return f"Plot: {request['plot_type'].title()}"
            case "overlay_figures":
                return "Plot: Overlay"
            case "inspect_style":
                return "Apply trace appearance"
            case "trace_style":
                return {"fill": "Change area fill", "order": "Change draw order"}.get(
                    request.get("kind"), "Change trace line style",
                )
            case "execute_plugin" | "run_plugin":
                plugin = self.plugins.plugins.get((request["plugin_id"], request["version"], request["checksum"]))
                if plugin:
                    manifest = plugin.manifest
                    return f"{manifest['menu'].title()}: {manifest['name']}"
        return fallback

    @staticmethod
    def editable_step_parameters(command):
        return {key: value for key, value in command.items()
                if key not in ("action", "default_style", "definition", "output_slots")}

    def record_plugin_columns(self, command, *, required=False):
        if command["action"] == "run_batch":
            steps = []
            for step in command["steps"]:
                captured = self.record_plugin_columns({**step, "action": "execute_plugin"}, required=required)
                steps.append({**step, "runs": captured["runs"]})
            return {**command, "steps": steps}
        if command["action"] not in ("execute_plugin", "run_plugin"):
            return command
        plugin = self.plugins.resolve(PluginStep(command["plugin_id"], command["version"], command["checksum"], {}))
        fields = {field["key"]: field["type"] for field in plugin.manifest["fields"] if field["type"] in ("column", "columns")}

        def record(run):
            source_id = run["source_id"]
            references = run.get("references", {})
            inherited = {}
            target = None if run.get("replace_inputs") else self.project.figures.get(run.get("figure_id"))
            if target:
                previous = plugin_step(target.recipe)
                source_id, inherited = previous.source_id, previous.references
            if not required and source_id not in self.project.raw_sources and source_id not in self.sources:
                return run
            table = self.input_worksheet(self.project, source_id, self.sources)
            options = run["options"].copy()
            for key, kind in fields.items():
                if key in options and key not in references and key not in inherited:
                    value = options[key]
                    options[key] = ([table.column_selection(index) for index in value]
                                    if kind == "columns" and isinstance(value, list) else table.column_selection(value))
            result = {**run, "options": options}
            if references:
                result["references"] = {
                    key: {**ref, "column": self.input_worksheet(
                        self.project, ref["source_id"], self.sources,
                    ).column_selection(ref["column"])}
                    for key, ref in references.items()
                }
            return result

        return {**command, "runs": [record(run) for run in command["runs"]]} if command["action"] == "execute_plugin" else record(command)

    def recorded_step_prefix(self, step_id, actions):
        index = next((i for i, step in enumerate(self.workflow.steps) if step.id == step_id), -1)
        if index < 0 or self.workflow.steps[index].request["action"] not in actions:
            raise ValueError("Choose a recorded step of this type.")
        if self.plugin_edit_prefix is not None and self.plugin_edit_prefix[0] == step_id:
            return index, self.plugin_edit_prefix[1]
        local = copy(self)
        local.plugin_edit_prefix = None
        local.project = self.workflow.base
        local.workflow = Workflow(self.workflow.base, steps=self.workflow.steps[:index],
                                  source_order=self.workflow.source_order,
                                  source_groups=self.workflow.source_groups,
                                  source_memberships=self.workflow.source_memberships)
        local.run_workflow(restart=True)
        self.plugin_edit_prefix = step_id, local
        return index, local

    def plugin_step_inputs(self, step_id):
        index, local = self.recorded_step_prefix(step_id, self.plugin_dialog_actions)
        saved = self.workflow.steps[index].request
        pin = (COLUMN_FORMULA_PLUGIN, "1", None) if saved["action"] == "apply_formula" else (
            saved["plugin_id"], saved["version"], saved["checksum"],
        )
        plugin = self.plugins.resolve(PluginStep(*pin, {}))
        missing = False
        available_sources = set(local.ordered_sources())
        available_figures = local.project.visible_figures

        def resolve(kind, value):
            nonlocal missing
            try:
                resolved = local.workflow.resolve(kind, value)
                if resolved in (available_sources if kind == "source" else available_figures):
                    return resolved
            except ValueError:
                pass
            missing = True
            return "unavailable" if kind == "source" else -1

        command = map_references(saved, resolve)
        target = command.get("figure_id")
        if command["action"] == "run_plugin":
            if target in local.project.figures and not command.get("replace_inputs"):
                previous = plugin_step(local.project.figures[target].recipe)
                command.update(source_id=previous.source_id, references=asdict(previous)["references"])
            runs = [{**command, "target_id": None}]
        elif command["action"] == "apply_formula":
            runs = [{"source_id": command["source_id"], "target_id": None,
                     "options": {"column": command["column"], "expression": command["expression"]}}]
        else:
            runs = command["runs"]
        initial = {"output": command.get("output", "overlay"), "target_id": command.get("target_id"),
                   "runs": [{key: run[key] for key in ("source_id", "options", "target_id", "references") if key in run}
                            for run in runs]}
        for key in ("input_group", "output_group"):
            if command.get(key) is not None:
                initial[key] = command[key]
        state = local.snapshot(paged=True, known_figures={str(key): token for key, token in local.figure_tokens.items()})["project"]
        return {"plugin": plugin.definition, "inputs": {key: state[key] for key in ("sources", "figures", "source_id", "source_groups")},
                "submission": initial, "updates_figure": target is not None,
                "warning": local.workflow.error or ("Some recorded inputs are unavailable before this step." if missing else None)}

    def edit_plugin_step(self, request):
        index, local = self.recorded_step_prefix(request["step_id"], self.plugin_dialog_actions)
        plan = self.workflow
        step = plan.steps[index]
        command = step.request
        submission = request["submission"]
        runs = submission["runs"]
        input_group, output_group = submission.get("input_group"), submission.get("output_group")
        if not isinstance(runs, list) or not (runs or input_group) or submission["output"] not in ("overlay", "separate"):
            raise ValueError("Choose plugin inputs and an output.")
        if command["action"] == "apply_formula":
            if len(runs) != 1:
                raise ValueError("Choose the worksheet for the calculated column.")
            source_id = runs[0]["source_id"]
            worksheet = local.input_worksheet(local.project, source_id, local.sources)
            options = runs[0]["options"]
            available = set(local.ordered_sources())
            previous = {}
            for token, reference in command["references"].items():
                try:
                    if local.workflow.resolve("source", reference["source_id"]) in available:
                        previous[token] = reference
                except ValueError:
                    continue
            new = {**command, "source_id": local.workflow.reference("source", source_id),
                   "column": worksheet.column_selection(options["column"]), "expression": options["expression"],
                   "references": local.formula_references(options["expression"], previous, stable=True)}
        elif command["action"] == "run_plugin" and command.get("figure_id") is not None:
            if len(runs) != 1:
                raise ValueError("Choose one set of inputs to update the figure.")
            run = runs[0]
            new = local.record_plugin_columns({**command, "source_id": run["source_id"], "options": run["options"],
                                               "replace_inputs": True, "references": run.get("references", {})}, required=True)
            # The existing target is already stored as a stable workflow reference.
            target = new.pop("figure_id")
            new = map_references(new, local.workflow.reference)
            new["figure_id"] = target
        else:
            new = local.record_plugin_columns({**command, "action": "execute_plugin", "runs": runs,
                                               "output": submission["output"], "target_id": submission.get("target_id"),
                                               "input_group": input_group, "output_group": output_group},
                                              required=True)
            local.plugin_groups(new)
            new = map_references(new, local.workflow.reference)
        plan.steps[index] = replace(step, request=new)
        plan.invalidate(index)
        self.plugin_edit_prefix = None
        self.dirty = True

    def workflow_snapshot(self) -> dict:
        plan = self.workflow
        steps = []
        for index, step in enumerate(plan.steps):
            if index < plan.completed:
                status = "done"
            elif index == plan.completed and plan.error:
                status = "failed"
            else:
                status = "stale" if step.id in plan.executed else "pending"
            action = step.request["action"]
            editors = {}
            if action in ("execute_plugin", "run_plugin"):
                options = ([run["options"] for run in step.request["runs"]] if action == "execute_plugin"
                           else [step.request["options"]])
                if group := step.request.get("input_group"):
                    options = [group["options"]]
                plugin = self.plugins.plugins.get((step.request["plugin_id"], step.request["version"], step.request["checksum"]))
                labels = {field["key"]: field["label"] for field in plugin.manifest["fields"]} if plugin else {}
                if plugin:
                    editors = {field["key"]: field["editor"] for field in plugin.manifest["fields"] if field.get("editor")}
            elif action == "apply_formula":
                options, labels = [{"expression": step.request["expression"]}], {"expression": "Formula"}
            elif action in ("add_array", "add_scalar"):
                literal = "value" if action == "add_scalar" else "values"
                key = "expression" if "expression" in step.request else literal
                options, labels = [{key: step.request[key]}], {key: {"expression": "Formula", "value": "Value", "values": "Values"}[key]}
            elif action == "invoke_workflow":
                options, labels = [], {}
            elif action == "edit_item" and step.request["name"] is not None:
                options, labels = [{"name": step.request["name"]}], {"name": "Name"}
            elif action == "trace_style" and step.request.get("style") is not None:
                options = [step.request["style"]]
                labels = {"color": "Color", "width": "Line width (px)", "dash": "Line style",
                          "opacity": "Fill opacity (0 to 1)", "zorder": "Draw order (Z)"}
            elif action in ("scale_column", "correct", "fit", "plot"):
                keys = {"scale_column": ["factor"], "correct": ["value"], "fit": ["x", "y"], "plot": ["x", "y"]}[action]
                options = [{key: step.request[key] for key in keys}]
                labels = {"factor": "Factor", "value": "Value", "x": "X column (index)", "y": "Y column (index)"}
            else:
                options, labels = [], {}
            steps.append({
                "id": step.id, "label": self.step_label(step.request, step.label), "status": status,
                "options": options, "labels": labels,
                **({"editors": editors} if editors else {}),
                **({"files": [source.original_path or source.name for source in step.sources]} if step.sources else {}),
                **({"parameters": self.editable_step_parameters(step.request)} if action != "import_data" else {}),
                **({"plugin_step": True} if action in self.plugin_dialog_actions else {}),
                **({"formula": True} if action in ("apply_formula", "add_array", "add_scalar") and "expression" in step.request else {}),
                **({"array": True} if action == "add_array" else {}),
                **({"scalar": True} if action == "add_scalar" else {}),
                **({"workflow_outputs": [port["name"] for port in step.request["definition"]["outputs"]]}
                   if action == "invoke_workflow" else {}),
                **({"workflow_inputs": [port["name"] for port in step.request["definition"]["inputs"] if port.get("exposed", True)]}
                   if action == "invoke_workflow" else {}),
            })
        return {"steps": steps, "completed": plan.completed, "error": plan.error, "needs_replay": plan.needs_replay,
                "has_base": plan.base.source is not None}

    def enqueue(self, request: dict, label: str, sources: tuple[Source, ...] = ()) -> None:
        plan = self.workflow
        step_id = max(plan.next_step_id, max((step.id for step in plan.steps), default=0) + 1)
        command = {key: value for key, value in request.items() if not key.startswith("_")}
        if command["action"] in ("execute_plugin", "run_batch", "run_plugin", "fit", "plot"):
            command["default_style"] = asdict(self.settings.figure_style)
        if command["action"] in ("correct", "scale_column", "run_plugin") and "source_id" not in command and "runs" not in command:
            command["source_id"] = self.source_id
        if command["action"] in ("figure_style", "color") and "figure_id" not in command:
            command["figure_id"] = self.figure_id
        command = self.record_plugin_columns(command)
        step = Step(step_id, self.step_label(command, label), map_references(command, plan.reference), sources)
        auto = self.settings.run_automatically and not plan.needs_replay and plan.completed == len(plan.steps)
        plan.steps.append(step)
        plan.next_step_id = step_id + 1
        if auto:
            try:
                self.execute_step(step)
            except (ValueError, KeyError, TypeError, OSError):
                plan.steps.pop()
                raise
        self.dirty = True

    def execute_step(self, step: Step) -> None:
        plan = self.workflow
        request = map_references(step.request, plan.resolve)
        before = self.project
        if request["action"] == "invoke_workflow":
            for slot, kind, value in self.invoke_saved_workflow(request):
                plan.bindings[f"{step.id}/{kind}/{slot}"] = value
        elif step.sources:
            self.import_sources(step.sources, import_path=request.get("import_path"), remember=False)
        else:
            self.apply(request)
        if request["action"] != "invoke_workflow":
            plan.bind(step, before, self.project)
        plan.completed += 1
        plan.executed.add(step.id)

    def save_workflow_definition(self, request: dict) -> None:
        plan = self.workflow
        selected = set(request.get("steps", (step.id for step in plan.steps[:plan.completed])))
        steps = [step for step in plan.steps[:plan.completed] if step.id in selected]
        if len(steps) != len(selected):
            raise ValueError("Choose recorded steps that have finished running.")
        ports = request["inputs"]
        inputs = []
        commands = []
        for step in steps:
            action = step.request["action"]
            command = step.request if action != "import_data" else {"action": "import_data"}
            commands.append({"id": step.id, "label": step.label, "request": command})
            for index, _ in enumerate(step.sources):
                key = f"{step.id}/source/{index}"
                inputs.append({"output": key, "kind": "csv", "name": ports.get(key, "").strip()})
            key = f"{step.id}/source/0"
            if action == "add_scalar" and "value" in step.request and key in ports:
                inputs.append({"output": key, "kind": "number", "name": ports[key].strip(), "default": step.request["value"]})
        outputs = []
        for output in request["outputs"]:
            kind, value = output["kind"], output["id"]
            if (kind == "source" and value not in self.ordered_sources()) or (
                kind == "figure" and value not in self.project.visible_figures
            ):
                raise ValueError("Choose an available source or figure for each output.")
            outputs.append({"kind": kind, "name": output["name"].strip(), "reference": plan.reference(kind, value)})
        group_ids = {group_id for step in steps for group_id in command_group_ids(step.request)}
        groups = {key: settings for key, settings in plan.source_groups.items()
                  if key in group_ids and key.startswith("manual:") and not settings.get("deleted")}
        memberships = {}
        if group_ids:
            for key, group_id in plan.source_memberships.items():
                reference = json.loads(key)
                if isinstance(reference, dict) and int(reference["output"].split("/")[0]) in selected:
                    memberships[key] = group_id
                elif group_id in groups:
                    raise ValueError("Include the steps that produce all members of the workflow's source groups.")
        definition = validate_workflow({
            "version": 1, "name": request["name"].strip(), "steps": commands, "inputs": inputs, "outputs": outputs,
            **({"source_groups": groups} if groups else {}),
            **({"source_memberships": memberships} if memberships else {}),
        })
        write_workflow(Path(request["path"]), definition)
        self.add_saved_workflow(definition)

    def add_saved_workflow(self, definition: dict) -> None:
        key = register_workflow(self.workflow_directory, definition)
        self.saved_workflows[key] = definition

    @staticmethod
    def workflow_output_key(port):
        return json.dumps(port["reference"], sort_keys=True, separators=(",", ":"))

    def workflow_output_slots(self, request):
        return request.get("output_slots", {
            self.workflow_output_key(port): index for index, port in enumerate(request["definition"]["outputs"])
        })

    @staticmethod
    def workflow_input_ports(definition):
        ports = {port["output"]: {**port, "exposed": port.get("exposed", True)} for port in definition["inputs"]}
        for step in definition["steps"]:
            if step["request"]["action"] == "add_scalar" and "value" in step["request"]:
                key = f"{step['id']}/source/0"
                ports.setdefault(key, {"output": key, "kind": "number", "name": step["request"]["name"],
                                       "default": step["request"]["value"], "exposed": False})
        return ports

    def workflow_step_ports(self, step_id):
        index, prefix = self.recorded_step_prefix(step_id, ("invoke_workflow",))
        request = self.workflow.steps[index].request
        definition = request["definition"]
        published = {self.workflow_output_key(port): {**port, "exposed": True} for port in definition["outputs"]}
        options = published.copy()
        warning = prefix.workflow.error
        try:
            resolved = map_references(request, prefix.workflow.resolve)
            local = prefix.run_workflow_definition(resolved)
            names = local.figure_names(local.project)
            candidates = (
                *(("source", key, local.source_name(local.project, key, local.sources, names))
                  for key in local.ordered_sources() if key not in prefix.project.raw_sources and key not in prefix.sources),
                *(("figure", key, names[key]) for key in local.project.visible_figures if key not in prefix.project.figures),
            )
            for kind, key, name in candidates:
                reference = local.workflow.reference(kind, key)
                if isinstance(reference, dict):
                    port = {"kind": kind, "reference": reference, "name": name, "exposed": False}
                    options.setdefault(self.workflow_output_key(port), port)
        except (ValueError, KeyError, TypeError, OSError) as error:
            warning = warning or str(error)
        source_names = prefix.figure_names(prefix.project)
        source_ids = set(prefix.ordered_sources())
        arrays = prefix.array_producers()
        sources = [{
            "id": key, "name": prefix.source_name(prefix.project, key, prefix.sources, source_names),
            "scalar": source.scalar_value is not None,
            "array": key in arrays,
        } for key, source in prefix.project.raw_sources.items() if key in source_ids]
        bindings = {}
        for key, reference in request["references"].items():
            try:
                source_id = prefix.workflow.resolve("source", reference["source_id"])
                if source_id in source_ids:
                    bindings[key] = source_id
            except ValueError:
                continue
        return {"name": request["name"], "inputs": list(self.workflow_input_ports(definition).values()),
                "outputs": list(options.values()), "warning": warning, "sources": sources,
                "bindings": bindings, "numbers": request["numbers"]}

    def edit_workflow_ports(self, request):
        plan = self.workflow
        index = next((i for i, step in enumerate(plan.steps) if step.id == request["step_id"]), -1)
        if index < 0 or plan.steps[index].request["action"] != "invoke_workflow":
            raise ValueError("Choose a recorded workflow run.")
        step = plan.steps[index]
        command = step.request
        definition = command["definition"]
        ports = self.workflow_input_ports(definition)
        if request["inputs"].keys() != ports.keys():
            raise ValueError("Choose the recorded workflow inputs.")
        inputs = [{**port, "exposed": request["inputs"][key]["exposed"], "name": request["inputs"][key]["name"].strip()}
                  for key, port in ports.items()]
        outputs = [{"kind": port["kind"], "reference": port["reference"], "name": port["name"].strip()}
                   for port in request["outputs"]]
        updated = validate_workflow({**definition, "inputs": inputs, "outputs": outputs})
        slots = self.workflow_output_slots(command).copy()
        next_slot = max(slots.values(), default=-1) + 1
        for port in outputs:
            key = self.workflow_output_key(port)
            if key not in slots:
                slots[key] = next_slot
                next_slot += 1
        plan.steps[index] = replace(step, request={**command, "definition": updated, "output_slots": slots})
        plan.invalidate(index)
        self.dirty = True

    def edit_workflow_run(self, request):
        index, prefix = self.recorded_step_prefix(request["step_id"], ("invoke_workflow",))
        plan = self.workflow
        step = plan.steps[index]
        command = step.request
        name = request["name"].strip()
        if not name:
            raise ValueError("Enter a name for the workflow run.")
        references, numbers = command["references"].copy(), command["numbers"].copy()
        for port in command["definition"]["inputs"]:
            if not port.get("exposed", True):
                continue
            key = port["output"]
            if key in request["sources"]:
                source_id = request["sources"][key]
                source = prefix.project.raw_sources.get(source_id)
                if (source is None or (source.scalar_value is not None) != (port["kind"] == "number")
                    or prefix.project.item_deleted("source", source_id)):
                    raise ValueError(f"Choose an available source for {port['name']}.")
                references[key] = {"source_id": prefix.workflow.reference("source", source_id)}
                numbers.pop(key, None)
            elif port["kind"] == "number" and key in request["numbers"]:
                value = request["numbers"][key]
                Source.scalar(port["name"], value)
                numbers[key] = value
                references.pop(key, None)
            else:
                raise ValueError(f"Choose an input for {port['name']}.")
        updated = {**command, "name": name, "references": references, "numbers": numbers}
        plan.steps[index] = replace(step, label=f"Workflow: {name}", request=updated)
        plan.invalidate(index)
        self.dirty = True

    def run_workflow_definition(self, request):
        definition = validate_workflow(request["definition"])
        base = self.project
        local = copy(self)
        steps = [Step(record["id"], record["label"], record["request"]) for record in definition["steps"]]
        local.workflow = Workflow(base, steps=steps, source_groups=definition.get("source_groups", {}),
                                  source_memberships=definition.get("source_memberships", {}))
        inputs = {port["output"]: port for port in definition["inputs"]}
        for step in steps:
            prefix = f"{step.id}/source/"
            if step.request["action"] == "import_data":
                ports = sorted((key for key in inputs if key.startswith(prefix)), key=lambda key: int(key.rsplit("/", 1)[1]))
                sources = []
                for key in ports:
                    source_id = request["references"][key]["source_id"]
                    source = base.raw_sources.get(source_id)
                    if source is None or source.scalar_value is not None or base.item_deleted("source", source_id):
                        raise ValueError(f"Choose an imported source for {inputs[key]['name']}.")
                    sources.append(source)
                step = replace(step, sources=tuple(sources))
            elif step.request["action"] == "add_scalar" and f"{prefix}0" in inputs:
                key = f"{prefix}0"
                if key in request["references"]:
                    source_id = request["references"][key]["source_id"]
                    source = base.raw_sources.get(source_id)
                    if source is None or source.scalar_value is None or base.item_deleted("source", source_id):
                        raise ValueError(f"Choose a variable for {inputs[key]['name']}.")
                    value = source.scalar_value
                else:
                    value = request["numbers"].get(key, inputs[key].get("default", step.request["value"]))
                step = replace(step, request={**step.request, "value": value})
            try:
                local.execute_step(step)
            except (ValueError, KeyError, TypeError, OSError) as error:
                raise ValueError(f"{step.label}. {error}") from error
        return local

    def invoke_saved_workflow(self, request: dict) -> list:
        base = self.project
        local = self.run_workflow_definition(request)
        slots = self.workflow_output_slots(request)
        outputs = []
        edits = []
        for port in request["definition"]["outputs"]:
            kind = port["kind"]
            value = local.workflow.resolve(kind, port["reference"])
            if (kind == "source" and value not in local.ordered_sources()) or (
                kind == "figure" and value not in local.project.visible_figures
            ):
                raise ValueError(f"The workflow did not produce {port['name']}.")
            outputs.append((slots[self.workflow_output_key(port)], kind, value))
            edits.append(ItemEdit(kind, value, f"{request['name']} · {port['name']}"))
        exposed = {(kind, value) for _, kind, value in outputs}
        for value in local.ordered_sources():
            if value is not None and value not in base.raw_sources and value not in self.sources and ("source", value) not in exposed:
                edits.append(ItemEdit("source", value, None))
        for value in local.project.visible_figures.keys() - base.visible_figures.keys():
            if ("figure", value) not in exposed:
                edits.append(ItemEdit("figure", value, None))
        updated = replace(local.project, operations=(*local.project.operations, *edits))
        updated.validate()
        local.render(updated, changed=set())
        self.project = updated
        self.results, self.combined, self.sources = local.results, local.combined, local.sources
        self.render_version, self.figure_tokens = local.render_version, local.figure_tokens
        self.source_id = next((value for _, kind, value in reversed(outputs) if kind == "source"), self.source_id)
        self.figure_id = next((value for _, kind, value in reversed(outputs) if kind == "figure"), self.figure_id)
        self.row_offset = 0
        return outputs

    def run_workflow(self, *, restart: bool = False, limit: int | None = None) -> None:
        plan = self.workflow
        if limit is None:
            limit = len(plan.steps)
        if restart or plan.needs_replay:
            self.render(plan.base, fallback=plan.base.saved_sources)
            self.project = replace(plan.base, notes=self.project.notes)
            self.figure_id = self.project.last_figure_id
            self.source_id = None
            self.row_offset = 0
            plan.bindings.clear()
            plan.completed = 0
            plan.needs_replay = False
        plan.error = None
        while plan.completed < limit:
            step = plan.steps[plan.completed]
            try:
                self.execute_step(step)
            except (ValueError, KeyError, TypeError, OSError) as error:
                plan.error = f"{self.step_label(step.request, step.label)}. {error}"
                break
        self.dirty = True

    def edit_workflow(self, request: dict) -> None:
        plan = self.workflow
        index = next((index for index, step in enumerate(plan.steps) if step.id == request["step_id"]), -1)
        if index < 0:
            raise ValueError("Choose a recorded step.")
        step = plan.steps[index]
        if request["action"] == "delete_step":
            plan.next_step_id = max(plan.next_step_id, step.id + 1)
            plan.steps.pop(index)
            plan.invalidate(index)
            plan.executed.discard(step.id)
        elif request["action"] == "move_step":
            destination = index + request["direction"]
            if not 0 <= destination < len(plan.steps):
                raise ValueError("The step cannot move farther in that direction.")
            plan.steps.pop(index)
            plan.steps.insert(destination, step)
            plan.invalidate(min(index, destination))
        elif request["action"] == "replace_import":
            slot = request["slot"]
            if step.request["action"] != "import_data" or type(slot) is not int or not 0 <= slot < len(step.sources):
                raise ValueError("Choose a file in the import step.")
            source, = request["prepared_sources"]
            sources = list(step.sources)
            sources[slot] = source
            command = {**step.request, "import_path": sources[-1].original_path or source.original_path}
            plan.steps[index] = replace(step, request=command, sources=tuple(sources),
                                        label="Import " + ", ".join(item.name for item in sources))
            plan.invalidate(index)
        else:
            previous = self.workflow_snapshot()["steps"][index]["options"]
            options = request["options"]
            details = request.get("parameters")
            if details is not None:
                if (step.request["action"] == "import_data" or not isinstance(details, dict)
                    or details.keys() != self.editable_step_parameters(step.request).keys()):
                    raise ValueError("Keep all recorded parameter names.")
            elif not previous or not isinstance(options, list) or len(options) != len(previous) or any(
                not isinstance(values, dict) or values.keys() != original.keys()
                or not all(valid_plugin_option(value) for value in values.values())
                for values, original in zip(options, previous)
            ):
                raise ValueError("Enter valid step options.")
            command = step.request.copy()
            action = command["action"]
            if details is not None:
                command.update(map_references(details, lambda kind, value:
                    value if isinstance(value, dict) else plan.reference(kind, value)))
            elif action == "execute_plugin":
                command["runs"] = [{**run, "options": values} for run, values in zip(command["runs"], options)]
                plugin = self.plugins.plugins.get((command["plugin_id"], command["version"], command["checksum"]))
                if plugin and plugin.manifest.get("input_mode") == "joint":
                    for run in command["runs"]:
                        run["references"] = {
                            key: {**binding, "column": run["options"][key]}
                            for key, binding in run["references"].items()
                        }
            elif action == "run_plugin":
                command["options"] = options[0]
            elif action == "trace_style":
                command["style"] = options[0]
            else:
                command.update(options[0])
            if action == "scale_column":
                ScaleColumn(0, command["factor"])
            if action in ("apply_formula", "add_array", "add_scalar") and "expression" in command:
                workspace = self.recorded_step_prefix(step.id, ("add_scalar",))[1] if action == "add_scalar" else self
                command["references"] = workspace.formula_references(
                    command["expression"], command["references"], stable=True,
                )
            if action == "add_array" and "values" in command:
                Source.array(command["name"], command["values"])
            if action == "add_scalar" and "value" in command:
                Source.scalar(command["name"], command["value"])
            if action == "trace_style":
                TraceAppearance(0, 0, command.get("style"), command.get("kind") or "line")
            if action == "edit_item":
                item = command["item"]
                name = command["name"]
                if item["kind"] not in ("source", "figure") or (name is not None and (not isinstance(name, str) or not name.strip())):
                    raise ValueError("Enter an item name.")
                if name is not None:
                    command["name"] = name.strip()
            plan.steps[index] = replace(step, request=command)
            plan.invalidate(index)
        self.dirty = True

    def dispatch(self, request: dict) -> dict:
        if request["action"] not in ("edit_plugin_step", "plugin_step_inputs", "workflow_step_ports", "edit_workflow_run"):
            self.plugin_edit_prefix = None
        if request["action"] in ("new", "open", "select_source"):
            self.row_offset = 0
        match request["action"]:
            case "import_preview":
                path = Path(request["path"])
                try:
                    settings = TextImport(**request["settings"])
                    with path.open("rb") as stream:
                        sample = stream.read(PREVIEW_BYTES + 1)
                        preview = import_preview(sample, settings)
                        if len(sample) > PREVIEW_BYTES and preview["error"] in (
                            "The selected header row is missing.", "The file needs at least one data row.",
                        ):
                            return import_preview(sample + stream.read(), settings, sample=False)
                        return preview
                except (OSError, ValueError, TypeError) as error:
                    return {"columns": (), "rows": (), "raw": (), "error": str(error)}
            case "export_recipe":
                return self.export_recipe()
            case "plugin_step_inputs":
                return self.plugin_step_inputs(request["step_id"])
            case "workflow_step_ports":
                return self.workflow_step_ports(request["step_id"])
            case "system_fonts":
                return {"fonts": self.fonts.families(refresh=request.get("refresh", False)), "styles": self.fonts.styles()}
            case "export_fonts":
                record = self.project.figures.get(self.figure_id)
                if record is None:
                    raise ValueError("Choose a figure to export.")
                style = record.style
                faces = set()
                separate = style.axes_separate if style.axes_separate is not None else style.x != style.y
                for role in ("font", "title", "x_label", "y_label", "x_tick", "y_tick", "legend"):
                    family = getattr(style, f"{role}_family") or style.font_family
                    face = getattr(style, f"{role}_face")
                    bold = getattr(style, f"{role}_bold")
                    italic = getattr(style, f"{role}_italic")
                    if face is None and bold is None and italic is None:
                        face = style.font_face
                    if face is None:
                        bold = style.font_bold if bold is None else bold
                        italic = style.font_italic if italic is None else italic
                        face = f"{700 if bold else 400}:{'italic' if italic else 'normal'}"
                    if role.startswith(("x_", "y_")):
                        side, kind = role.split("_")
                        axis = getattr(style, side) if separate else style.global_axis or style.x
                        family = getattr(axis, f"{kind}_family") or family
                        face = getattr(axis, f"{kind}_face") or face
                    weight, slant = face.split(":")
                    faces.add((family, int(weight), slant))
                return {"fonts": [self.fonts.export(*face) for face in sorted(faces)]}
            case "dialog_directory":
                return {"directory": self.dialog_directory()}
            case "worksheet_page":
                offset = request["offset"]
                if type(offset) is not int or offset < 0:
                    raise ValueError("Choose a valid worksheet page.")
                self.row_offset = (offset // 100) * 100
            case "set_preferences":
                self.settings.save_preferences(FigureStyle(**request["style"]), Appearance(**request["appearance"]), request.get("run_automatically"))
            case "set_global_style":
                self.settings.save(FigureStyle(**request["style"]))
            case "run_all":
                self.run_workflow(restart=True)
            case "run_next":
                length = len(self.workflow.steps)
                if self.workflow.needs_replay or self.workflow.completed < length:
                    self.run_workflow(limit=min(self.workflow.completed + 1, length))
            case "move_source":
                self.move_source(request["source_id"], request["destination"], placement=request.get("placement"))
            case "source_group":
                self.change_source_group(request)
            case "edit_step" | "move_step" | "delete_step":
                self.edit_workflow(request)
            case "edit_plugin_step":
                self.edit_plugin_step(request)
            case "state":
                pass
            case "new":
                self.set_project(Project(), None)
            case "new_workspace":
                self.collection = ProjectCollection().select(self.path) if self.path else ProjectCollection()
            case "open_workspace" | "open_recent_workspace":
                path = Path(request["path"]).resolve()
                if request["action"] == "open_recent_workspace" and str(path) not in self.settings.recent_workspaces:
                    raise ValueError("Choose a recently opened workspace.")
                self.open_workspace(path)
            case "save_workspace":
                if self.collection is None:
                    raise ValueError("Create a workspace before saving it.")
                path = Path(request["path"]).resolve() if request.get("path") else self.collection.path
                if path is None:
                    raise ValueError("Choose a file name for the workspace.")
                self.collection = self.collection.save(path)
                self.remember_paths(workspace_path=str(path))
            case "switch_workspace_project":
                path = Path(request["path"]).resolve()
                if self.collection is None or path not in self.collection.projects:
                    raise ValueError("Choose a project in the active workspace.")
                self.open_project(path)
                self.collection = self.collection.select(path)
            case "sample":
                self.enqueue({"action": "import_data"}, "Import sample data", (Source("Sample data.csv", SAMPLE),))
            case "import_data" | "replace_import":
                replacement = ({"step_id": request["step_id"], "slot": request["slot"]}
                               if request["action"] == "replace_import" else None)
                paths = [Path(value).resolve() for value in ([request["path"]] if replacement else request["paths"])]
                result = self.prepare_import(paths, request.get("settings"), request.get("interactive", False), replacement)
                if isinstance(result, dict):
                    return result
                if replacement:
                    self.edit_workflow({**request, "prepared_sources": result})
                else:
                    self.enqueue({"action": "import_data", "import_path": str(paths[-1])},
                                 "Import " + ", ".join(path.name for path in paths), result)
                    self.remember_paths(import_path=str(paths[-1]))
            case "open":
                path = Path(request["path"]).resolve()
                self.open_project(path)
                if self.collection is not None:
                    self.collection = self.collection.select(path)
            case "install_plugin":
                self.plugins.install(Path(request["path"]))
                if any(result.error for result in self.results.values()):
                    self.render(self.project, fallback=self.sources)
            case "save_workflow":
                self.save_workflow_definition(request)
            case "import_workflow":
                paths = request["paths"] if "paths" in request else [request["path"]]
                for definition in [read_workflow(Path(path)) for path in paths]:
                    self.add_saved_workflow(definition)
            case "edit_workflow_ports":
                self.edit_workflow_ports(request)
            case "edit_workflow_run":
                self.edit_workflow_run(request)
            case "run_saved_workflow":
                recipe = self.saved_workflows.get(request["id"])
                if recipe is None:
                    raise ValueError("Import the workflow before running it.")
                name = request["name"].strip()
                if not name:
                    raise ValueError("Enter a name for the workflow run.")
                references = {key: {"source_id": value} for key, value in request["sources"].items()}
                self.enqueue({"action": "invoke_workflow", "name": name, "definition": recipe,
                              "references": references, "numbers": request["numbers"]}, f"Workflow: {name}")
            case "export_script":
                from nigiro.script_export import write_script

                self.require_exportable_workflow()
                write_script(Path(request["path"]), request["template"], request["payload"],
                             tuple(self.project.raw_sources.values()), request["copy_raw_data"])
                return {}
            case "export_rendered":
                from nigiro.figure_export import write_figure

                fonts = Path(__file__).with_name("fonts")
                write_figure(Path(request["path"]), request["svg"], request["scale"], fonts)
                return {}
            case "apply_formula":
                references = self.formula_references(request["expression"])
                worksheet = self.input_worksheet(self.project, request["source_id"], self.sources)
                self.enqueue({**request, "column": worksheet.column_selection(request["column"]),
                              "references": references}, "Column Formula")
            case "add_scalar":
                name = Source.scalar(request["name"], 0).name
                command = {"action": "add_scalar", "name": name, "comment": normalize_comment(request.get("comment"))}
                if request.get("expression") is not None:
                    expression = request["expression"]
                    command.update(expression=expression, references=self.formula_references(expression))
                else:
                    command["value"] = Source.scalar(name, request["value"]).scalar_value
                self.enqueue(command, f"Add variable {name}")
            case "add_array":
                name = request["name"].strip()
                if not name or any(c in name for c in "\n\r\0"):
                    raise ValueError("Enter a name for the array.")
                command = {"action": "add_array", "name": name, "comment": normalize_comment(request.get("comment"))}
                if request.get("expression") is not None:
                    expression = request["expression"]
                    references = self.formula_references(expression)
                    if not references:
                        raise ValueError("Use at least one source reference in the array formula.")
                    command.update(expression=expression, references=references)
                else:
                    values = request["values"]
                    Source.array(name, values)
                    command["values"] = values
                self.enqueue(command, f"Add array {name}")
            case "execute_plugin" | "run_plugin":
                self.enqueue(request, request["plugin_id"])
            case "overlay_figures":
                operation = OverlayFigure(request["figure_ids"], keep_inputs=True)
                self.enqueue({**request, "figure_ids": operation.figure_ids}, "Plot: Overlay")
            case "scale_column":
                operations = self.scale_operations(request)
                if len(operations) == 1:
                    op = operations[0]
                    label = f"Multiply {self.project.raw_sources[op.source_id].worksheet.columns[op.column]}"
                else:
                    label = f"Multiply columns in {len(operations)} sources"
                self.enqueue(request, label)
            case "correct" | "fit" | "plot" | "color" | "figure_style" | "trace_style" | "inspect_style" | "edit_item" | "run_batch":
                labels = {"correct": "Correct worksheet cell", "fit": "Analysis: Linear Fit", "plot": "Plot",
                          "color": "Change trace color", "figure_style": "Change figure settings", "trace_style": "Change trace style",
                          "inspect_style": "Apply trace appearance", "edit_item": "Edit item", "run_batch": "Run analysis batch"}
                self.enqueue(request, labels[request["action"]])
            case _:
                self.apply(request)
        return self.snapshot(paged=request.get("_paged", False), known_figures=request.get("_known_figures"))

    def require_exportable_workflow(self) -> None:
        if self.workflow.needs_replay or self.workflow.completed < len(self.workflow.steps) or self.workflow.error:
            raise ValueError("Run all recorded steps before exporting a Python script.")

    def export_recipe(self) -> dict:
        self.require_exportable_workflow()
        project = self.project
        recipes = {}
        builtin_dependencies = {}
        for key, record in project.figures.items():
            if record.overlay or record.fit_id is not None:
                continue
            step = plugin_step(record.recipe)
            plugin = self.plugins.resolve(step)
            result = self.results[key]
            if result.error:
                raise ValueError(f"Cannot export {plugin.manifest['name']}. {result.error}")
            recipes[key] = {**asdict(step), "source": plugin.source,
                            "analysis": plugin.manifest["menu"] == "analysis",
                            "input_mode": plugin.manifest.get("input_mode", "batch")}
            named = [field["key"] for field in plugin.manifest["fields"] if field["type"] in ("column", "columns")
                     and field["key"] not in step.references and isinstance(step.options.get(field["key"]), (str, list))]
            if named:
                recipes[key]["named_columns"] = named
            if result.dependencies:
                if plugin.source is None:
                    builtin_dependencies.update(result.dependencies)
                else:
                    recipes[key]["dependencies"] = result.dependencies
        names = self.figure_names(project)
        outputs = {}
        for key, record in project.figures.items():
            if record.overlay or record.layers:
                outputs[key] = {
                    "members": record.members(key),
                    "labels": self.overlay_labels(project, key, self.sources, names),
                    "preserve_first": record.overlay is None,
                    "combined_input_count": record.combined_input_count,
                }
        return {"project": {
            "operations": [operation_record(op) for op in project.operations],
            "versions": {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
            "script_recipe": {
                "figure_id": self.figure_id, "plugins": recipes, "overlays": outputs,
                **({"builtin_dependencies": builtin_dependencies} if builtin_dependencies else {}),
            },
        }}

    def dialog_directory(self) -> str | None:
        for value in (
            self.project.last_import_path, self.settings.last_import_path,
            str(self.path) if self.path else None, self.settings.last_project_path,
        ):
            if value:
                directory = Path(value).parent
                if directory.is_dir():
                    return str(directory)
        return None

    def remember_paths(self, **paths) -> None:
        try:
            self.settings.remember(**paths)
        except OSError as exc:
            print(f"Could not save the last file folder. {exc}", file=sys.stderr)

    @staticmethod
    def prepare_import(paths, chosen, interactive, replacement):
        if not paths:
            raise ValueError("Choose at least one data file.")
        settings_by_file = [None] * len(paths) if chosen is None else chosen.copy()
        if len(settings_by_file) != len(paths):
            raise ValueError("Choose import settings for each selected file.")
        sources = []
        for index, path in enumerate(paths):
            content = path.read_bytes()
            provided = settings_by_file[index]
            settings, confident = guess_import(content) if provided is None else (TextImport(**provided), True)
            source = Source(path.name, content, encoding=settings.encoding, delimiter=settings.delimiter,
                            original_path=str(path), text_import=settings)
            try:
                source.worksheet
                if not confident:
                    raise ValueError("Nigiro could not identify the table layout. Check the import options.")
            except ValueError as error:
                if not interactive:
                    raise
                try:
                    preview = import_preview(content, settings)
                except ValueError:
                    preview = {"columns": (), "rows": (), "raw": (), "error": str(error)}
                return {"import_review": {
                    "paths": [str(path) for path in paths], "settings": settings_by_file, "index": index,
                    "suggested": asdict(settings), "preview": preview, "error": str(error), "replacement": replacement,
                }}
            sources.append(source)
            settings_by_file[index] = asdict(settings)
        return tuple(sources)

    def import_sources(self, additions: tuple[Source, ...], *, import_path: str | None = None, remember: bool = True) -> None:
        if not additions:
            raise ValueError("Choose at least one data file.")
        project = self.project
        updated = replace(project, additional_sources=(*project.additional_sources, *additions)) if project.source else replace(
            project, source=additions[0], additional_sources=additions[1:]
        )
        updated.validate()
        if import_path is not None:
            updated = replace(updated, last_import_path=import_path)
        self.project = updated
        self.dirty = True
        if import_path is not None and remember:
            self.remember_paths(import_path=import_path)

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
            case "add_scalar":
                if "expression" in request:
                    references = request["references"]
                    if any(project.item_deleted("source", reference["source_id"]) for reference in references.values()):
                        raise ValueError("Select available sources for the formula.")
                    formula = {"expression": request["expression"], "references": references, "position": len(project.operations)}
                    scalar = project.scalar_from_formula(request["name"], formula, self.sources, request.get("comment"))
                else:
                    scalar = Source.scalar(request["name"], request["value"], request.get("comment"))
                self.import_sources((scalar,), remember=False)
            case "add_array" if "values" in request:
                self.import_sources((Source.array(request["name"], request["values"], request.get("comment")),), remember=False)
                self.source_id = next(reversed(self.project.raw_sources))
                self.row_offset = 0
            case "apply_formula" | "add_array":
                array = request["action"] == "add_array"
                if array and not request["references"]:
                    raise ValueError("Use at least one source reference in the array formula.")
                source_id = next(iter(request["references"].values()))["source_id"] if array else request["source_id"]
                if project.item_deleted("source", source_id) or any(
                    project.item_deleted("source", reference["source_id"]) for reference in request["references"].values()
                ):
                    raise ValueError("Select available sources for the formula.")
                recipe = PluginStep(
                    ARRAY_FORMULA_PLUGIN if array else COLUMN_FORMULA_PLUGIN, "1", None,
                    {("name" if array else "column"): request["name" if array else "column"],
                     "expression": request["expression"]},
                    source_id=source_id, references=request["references"], comment=request.get("comment"),
                )
                result_id = len(project.operations)
                updated = project.apply(recipe)
                self.render(updated, changed={result_id}, fallback=self.sources)
                self.project = updated
                self.source_id = f"{result_id}:calculated"
                self.row_offset = 0
                self.dirty = True
            case "scale_column":
                updated = replace(project, operations=(*project.operations, *self.scale_operations(request)))
                updated.working_worksheets
                self.project = updated
                self.dirty = True
            case "correct":
                source_id = request.get("source_id", self.source_id)
                if source_id not in project.raw_sources:
                    raise ValueError("Select the imported source to correct its worksheet.")
                operation = Correction(request["row"], request["column"], request["value"], source_id)
                updated = project.apply(operation)
                if project.working_worksheets[source_id].rows[operation.row][operation.column] != operation.value:
                    self.render(updated, fallback=self.sources)
                    self.project = updated
                    self.dirty = True
            case "run_batch":
                self.run_batch(project, request)
            case "execute_plugin":
                runs = self.plugin_groups(request)
                if runs:
                    self.run_batch(project, {**request, "steps": [{**request, "runs": runs}]})
            case "overlay_figures":
                operation = OverlayFigure(request["figure_ids"], keep_inputs=True)
                for member in operation.figure_ids:
                    self.validate_destination(project, member)
                figure_id = len(project.operations)
                updated = project.apply(operation)
                self.render(updated, changed={figure_id}, fallback=self.sources)
                self.project = updated
                self.figure_id = figure_id
                self.dirty = True
            case "run_plugin" | "fit" | "plot":
                figure_id = len(project.operations)
                selection = figure_id
                if request["action"] == "run_plugin":
                    target = request.get("figure_id")
                    source_id = request.get("source_id", self.source_id)
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
                        if not request.get("replace_inputs"):
                            source_id = previous.source_id
                        figure_id = target
                    recipe = PluginStep(
                        request["plugin_id"], request["version"], request["checksum"], request["options"],
                        source_id=source_id, figure_id=target,
                        references=request.get("references", {}) if target is None or request.get("replace_inputs") else previous.references,
                    )
                    recipe = replace(recipe, table_only=self.plugins.resolve(recipe).table_only)
                    if target is not None and recipe.pin != previous.pin:
                        raise ValueError("Use the original plugin to change its options.")
                elif request["action"] == "fit":
                    recipe = LinearFit(request["x"], request["y"])
                else:
                    recipe = Plot(request["plot_type"], request["x"], request["y"])
                updated = project.apply(recipe)
                if isinstance(recipe, PluginStep) and recipe.figure_id is None and recipe.checksum is None and recipe.plugin_id in FIT_PLUGINS:
                    updated = updated.apply(ResidualFigure(figure_id))
                updated = self.apply_global_defaults(project, updated, request.get("default_style"))
                self.render(updated, changed={figure_id}, fallback=self.sources)
                self.project = updated
                self.select_plugin_output(selection, isinstance(recipe, PluginStep) and recipe.table_only)
                self.dirty = True
            case "inspect_style":
                changes = request["changes"]
                if not isinstance(changes, list) or any(
                    not isinstance(change, dict) or change.get("action") not in ("color", "trace_style") for change in changes
                ):
                    raise ValueError("Choose appearance changes for the trace.")
                figure_id, trace = request["figure_id"], request["trace"]
                result = self.combined.get(figure_id) or self.results.get(figure_id)
                if (figure_id not in project.visible_figures or result is None or not result.figure
                    or type(trace) is not int or not 0 <= trace < len(result.figure["traces"])):
                    raise ValueError("Choose an available trace.")
                local = copy(self)
                for change in changes:
                    local.apply({**change, "figure_id": figure_id})
                self.project, self.dirty = local.project, local.dirty
            case "color" | "figure_style" | "trace_style":
                figure_id = request.get("figure_id", self.figure_id)
                if type(figure_id) is not int or figure_id not in project.visible_figures:
                    raise ValueError("Select a figure first.")
                record = project.figures[figure_id]
                if request["action"] == "color":
                    operation = FigureColor(request["element"], request["color"], figure_id)
                    if record.colors[operation.element] == operation.color:
                        return
                elif request["action"] == "trace_style":
                    operation = TraceAppearance(figure_id, request["trace"], request.get("style"), request.get("kind") or "line")
                    result = self.combined.get(figure_id) or self.results.get(figure_id)
                    traces = result.figure["traces"] if result and result.figure else []
                    trace = traces[operation.trace] if operation.trace < len(traces) else {}
                    if not trace or trace.get("type") not in (None, "scatter", "scattergl", "bar"):
                        raise ValueError("Choose an available trace.")
                    if operation.style_kind == "line" and trace.get("type") == "bar":
                        raise ValueError("Choose a line trace.")
                    if operation.style_kind == "fill" and trace.get("fill") in (None, "none"):
                        raise ValueError("Choose a trace with a shaded area.")
                    stored = record.trace_styles.get(operation.trace, {})
                    if operation.style_kind == "line":
                        current = {key: stored[key] for key in ("color", "width", "dash") if key in stored} or None
                    elif operation.style_kind == "fill":
                        current = stored.get("fill")
                    else:
                        current = {"zorder": stored["zorder"]} if "zorder" in stored else None
                    if current == operation.style:
                        return
                else:
                    style = FigureStyle(**request["style"])
                    if style == record.style:
                        return
                    operation = FigureAppearance(figure_id, style)
                self.project = project.apply(operation)
                self.dirty = True
            case "save":
                path = Path(request["path"]).resolve() if "path" in request else self.path
                if path is None or path.suffix.lower() != ".nigiro":
                    raise ValueError("Choose a file name with the .nigiro extension.")
                updated = replace(project, notes=project.notes if request.get("notes") is None else request["notes"])
                save_project(path, replace(updated, saved_sources=self.sources), self.workflow)
                self.project = updated
                self.path = path
                if self.collection is not None:
                    self.collection = self.collection.select(path)
                self.dirty = False
            case "export":
                self.export(Path(request["path"]))
            case _:
                raise ValueError("Unknown workspace command.")

    def formula_references(self, expression: str, existing: dict | None = None, *, stable: bool = False) -> dict:
        _, tokens = parse_formula(expression)
        project = self.project
        names = self.figure_names(project)
        sources = [(key, self.source_name(project, key, self.sources, names)) for key in self.ordered_sources()]
        references = {}
        for token, (_, source, column, _, row) in tokens.items():
            if existing is not None and token in existing:
                references[token] = existing[token]
                continue
            matches = [key for key, name in sources if source == name]
            if not matches:
                matches = [key for key, name in sources if source == Path(name).stem
                           and key in project.raw_sources
                           and (project.raw_sources[key].original_path or name.lower().endswith(".csv"))]
            if not matches:
                raise ValueError(f"Source {source!r} was not found. Use Insert reference to select it.")
            if len(matches) > 1:
                raise ValueError(f"Source name {source!r} is ambiguous. Use its full name or rename the source.")
            key = matches[0]
            worksheet = self.input_worksheet(project, key, self.sources)
            if column is None:
                if len(worksheet.columns) != 1:
                    raise ValueError(f"{token} needs a column name.")
                if row is None and len(worksheet.rows) != 1:
                    raise ValueError(f"{token} needs a column name or a row index such as {token}[1].")
                selected = 0
            elif isinstance(column, int):
                if not 1 <= column <= len(worksheet.columns):
                    raise ValueError(f"{token} refers to a missing column.")
                selected = column - 1
            else:
                columns = [index for index, name in enumerate(worksheet.columns) if name == column]
                if len(columns) != 1:
                    raise ValueError(f"Choose a unique column named {column!r} in {source!r}.")
                selected = column
            references[token] = {
                "source_id": self.workflow.reference("source", key) if stable else key,
                "column": selected,
            }
        return references

    def scale_operations(self, request: dict) -> list[ScaleColumn]:
        runs = request.get("runs")
        if runs is None:
            runs = [{"source_id": request.get("source_id", self.source_id), "column": request["column"]}]
        if not runs or len({run["source_id"] for run in runs}) != len(runs):
            raise ValueError("Select different raw sources to multiply.")
        operations = []
        for run in runs:
            operation = ScaleColumn(run["column"], request["factor"], run["source_id"])
            source = self.project.raw_sources.get(operation.source_id)
            if source is None or operation.column >= len(source.worksheet.columns):
                raise ValueError("Choose a column for each raw source.")
            operations.append(operation)
        return operations

    def plugin_groups(self, request):
        destination = request.get("output_group")
        if destination is not None:
            mode = destination.get("mode")
            if mode == "existing":
                self.group_sources(destination["id"])
            elif mode == "new":
                if not isinstance(destination.get("name"), str) or not destination["name"].strip():
                    raise ValueError("Enter a name for the new source group.")
            elif mode != "ungrouped":
                raise ValueError("Choose a destination for the output sources.")
        group = request.get("input_group")
        if group is None:
            if not request["runs"]:
                raise ValueError("Select at least one source.")
            return request["runs"]
        plugin = self.plugins.resolve(PluginStep(request["plugin_id"], request["version"], request["checksum"], {}))
        if request["runs"] or plugin.manifest["menu"] != "analysis" or plugin.manifest.get("input_mode") == "joint":
            raise ValueError("Choose a group only for an analysis that runs on each source independently.")
        runs = []
        for source_id in self.group_sources(group["id"]):
            worksheet = self.input_worksheet(self.project, source_id, self.sources)
            options = group["options"].copy()

            def match(selection):
                if isinstance(selection, str):
                    matches = [i for i, name in enumerate(worksheet.columns)
                               if name.strip().casefold() == selection.strip().casefold()]
                    if len(matches) != 1:
                        names = self.figure_names(self.project)
                        source = self.source_name(self.project, source_id, self.sources, names)
                        raise ValueError(f"{source} needs a unique column named {selection!r}.")
                    return matches[0]
                return worksheet.column_index(selection)

            for field in plugin.manifest["fields"]:
                key = field["key"]
                if field["type"] == "column":
                    options[key] = match(options[key])
                elif field["type"] == "columns":
                    options[key] = [match(column) for column in options[key]]
            runs.append({"source_id": source_id, "options": options})
        return runs

    def run_batch(self, project: Project, request: dict) -> None:
        output, steps = request["output"], request["steps"]
        if output not in ("overlay", "separate") or not isinstance(steps, list) or not steps:
            raise ValueError("Choose batch commands and an output mode.")
        if any(step["plugin_id"] in REFERENCE_FORMULA_PLUGINS for step in steps):
            raise ValueError("Use Column Formula to calculate a column with source references.")
        operations = list(project.operations)
        changed = set()
        destinations = set()
        for step in steps:
            runs = step["runs"]
            if not isinstance(runs, list) or not runs:
                raise ValueError("Select at least one source.")
            plugin = self.plugins.resolve(PluginStep(step["plugin_id"], step["version"], step["checksum"], {}))
            table_only = plugin.table_only
            if plugin.manifest.get("input_mode") == "joint" and len(runs) != 1:
                raise ValueError("Submit all joint inputs as one plugin run.")
            ids, residuals, seen, targets = [], [], set(), set()
            for run in runs:
                source_id = run["source_id"]
                if source_id in seen or project.item_deleted("source", source_id):
                    raise ValueError("Select different available sources.")
                self.input_worksheet(project, source_id, self.sources)
                seen.add(source_id)
                recipe = PluginStep(step["plugin_id"], step["version"], step["checksum"], run["options"],
                                    source_id=source_id, references=run.get("references", {}), table_only=table_only)
                if any(project.item_deleted("source", reference.source_id) for reference in recipe.references.values()):
                    raise ValueError("Choose available sources for each input.")
                figure_id = len(operations)
                operations.append(recipe)
                changed.add(figure_id)
                ids.append(figure_id)
                if recipe.checksum is None and recipe.plugin_id in FIT_PLUGINS:
                    residuals.append(len(operations))
                    operations.append(ResidualFigure(figure_id))
                destination = run.get("target_id") if output == "separate" and not table_only else None
                if destination is not None:
                    self.validate_destination(project, destination)
                    if destination in targets:
                        raise ValueError("Choose a different figure for each source, or overlay the sources.")
                    targets.add(destination)
                    operations.append(AddFigureLayers(destination, (figure_id,)))
                    destinations.add(destination)
                selection = figure_id if destination is None else destination
            if output == "overlay" and not table_only:
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
        updated = self.apply_global_defaults(project, updated, request.get("default_style"))
        updated.validate()
        self.render(updated, changed=changed, fallback=self.sources, destinations=destinations)
        self.project = updated
        self.select_plugin_output(selection, table_only)
        self.dirty = True

    def select_plugin_output(self, selection: int, table_only: bool) -> None:
        if table_only:
            key = next(iter(self.results[selection].tables), None)
            if key is not None:
                self.source_id = f"{selection}:{key}"
                self.row_offset = 0
        else:
            self.figure_id = selection

    def apply_global_defaults(self, previous: Project, updated: Project, defaults: dict | None) -> Project:
        style = FigureStyle(**defaults) if defaults is not None else self.settings.figure_style
        if style == FigureStyle():
            return updated
        residual_style = replace(
            style, y=replace(style.y, zero_line=True),
            global_axis=replace(style.global_axis or style.x, zero_line=True)
            if style.axes_separate is False else style.global_axis,
        )
        operations = tuple(
            FigureAppearance(key, residual_style if record.part == "residual" else style)
            for key, record in updated.figures.items() if key not in previous.figures
        )
        return replace(updated, operations=(*updated.operations, *operations))

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
        columns = (project.plugin_input(step, self.sources) if isinstance(record.recipe, PluginStep)
                   else self.input_worksheet(project, step.source_id, self.sources)).columns
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
