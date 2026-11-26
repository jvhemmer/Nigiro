"""Discover, validate, and run Nigiro plugins."""

from __future__ import annotations

import ast
import hashlib
import json
import math
import re
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Callable

from .builtin_plugins import BUILTINS
from .column_formula import REFERENCE_FORMULA_PLUGINS
from .plugin_dependencies import installed_requirements, plugin_requirements
from .plugin_source import run_plugin_source
from .project import LinearFit, Plot, PluginStep, Project, Worksheet
from .source_tables import TABLE_ONLY_PLUGINS


@dataclass(frozen=True)
class Plugin:
    manifest: dict
    run: Callable | None = None
    checksum: str | None = None
    source: str | None = None

    @property
    def pin(self) -> tuple[str, str, str | None]:
        return self.manifest["id"], self.manifest["version"], self.checksum

    @property
    def table_only(self) -> bool:
        return self.manifest.get("table_only", self.manifest["id"] in TABLE_ONLY_PLUGINS)

    @property
    def definition(self) -> dict:
        return {**self.manifest, "checksum": self.checksum, "table_only": self.table_only}


def valid_value(field: dict, value: object, columns: int | None) -> bool:
    match field["type"]:
        case "column":
            return type(value) is int and value >= 0 and (columns is None or value < columns)
        case "number":
            return (
                type(value) in (int, float) and -math.inf < value < math.inf
                and field.get("min", -math.inf) <= value <= field.get("max", math.inf)
            )
        case "boolean":
            return type(value) is bool
        case "text":
            return isinstance(value, str) and (not field.get("required") or bool(value.strip()))
        case "choice":
            return isinstance(value, str) and any(choice["value"] == value for choice in field["choices"])
    return False


def read_plugin(content: bytes) -> Plugin:
    source = content.decode("utf-8-sig")
    try:
        tree = ast.parse(source)
        declaration, = [
            node.value for node in tree.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "PLUGIN" for target in node.targets)
        ]
        manifest = ast.literal_eval(declaration)
    except (SyntaxError, ValueError, TypeError) as exc:
        raise ValueError("The plugin needs one literal PLUGIN dictionary.") from exc
    if not any(isinstance(node, ast.FunctionDef) and node.name == "run" for node in tree.body):
        raise ValueError("The plugin needs a run function.")
    if not isinstance(manifest, dict) or type(manifest.get("api")) is not int or manifest["api"] != 1:
        raise ValueError("The plugin must use API version 1.")
    identifier = manifest.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)*", identifier):
        raise ValueError("Enter a valid plugin ID.")
    if identifier.startswith("nigiro."):
        raise ValueError("Use a plugin ID outside the nigiro namespace.")
    if not all(isinstance(manifest.get(key), str) and manifest[key].strip() for key in ("name", "version")):
        raise ValueError("The plugin needs a name and version.")
    if manifest.get("menu") not in ("plot", "analysis"):
        raise ValueError("Set the plugin menu to plot or analysis.")
    if type(manifest.get("distinct_columns", False)) is not bool or not isinstance(manifest.get("fields"), list):
        raise ValueError("Invalid plugin controls.")
    outputs = manifest.get("outputs", [])
    if not isinstance(outputs, list) or not all(isinstance(label, str) and label.strip() for label in outputs):
        raise ValueError("List plugin outputs as text.")
    plugin_requirements(manifest.get("dependencies", []))

    if type(manifest.get("table_only", False)) is not bool:
        raise ValueError("Set table_only to true or false.")
    if manifest.get("input_mode", "batch") not in ("batch", "joint"):
        raise ValueError("Set input_mode to batch or joint.")
    if manifest.get("input_mode") == "joint" and not any(
        isinstance(field, dict) and field.get("type") == "column" for field in manifest["fields"]
    ):
        raise ValueError("Joint plugins need named column inputs.")

    keys = set()
    for field in manifest["fields"]:
        if not isinstance(field, dict) or not all(
            isinstance(field.get(key), str) and field[key].strip() for key in ("key", "label", "type")
        ):
            raise ValueError("Each plugin control needs a key, label, and type.")
        key = field["key"]
        if key in keys or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]*", key):
            raise ValueError("Use a unique key for each plugin control.")
        keys.add(key)
        if field["type"] == "choice":
            choices = field.get("choices")
            if not isinstance(choices, list) or not choices or not all(
                isinstance(choice, dict) and isinstance(choice.get("value"), str)
                and isinstance(choice.get("label"), str) for choice in choices
            ):
                raise ValueError("Each choice needs a text value and label.")
        if field["type"] == "number":
            for bound in ("min", "max"):
                if bound in field and not valid_value({"type": "number"}, field[bound], None):
                    raise ValueError("Enter finite bounds for number controls.")
        if not valid_value({**field, "required": False}, field.get("default"), None):
            raise ValueError(f"Invalid default for {field['label']}.")

    json.dumps(manifest, allow_nan=False)
    return Plugin(manifest, checksum=hashlib.sha256(content).hexdigest(), source=source)


class PluginRegistry:
    def __init__(self, directory: Path | None = None):
        self.directory = directory
        self.plugins: dict[tuple[str, str, str | None], Plugin] = {}
        self.active: dict[str, Plugin] = {}
        for manifest, runner in BUILTINS.values():
            self.add(Plugin(manifest, runner))
        if directory is not None and directory.is_dir():
            installed = []
            for path in directory.glob("*.py"):
                try:
                    plugin = read_plugin(path.read_bytes())
                    if path.stem == plugin.checksum:
                        installed.append((path.stat().st_mtime_ns, path.name, plugin))
                except (OSError, TypeError, ValueError) as exc:
                    print(f"Could not read plugin {path.name}. {exc}", file=sys.stderr)
            for _, _, plugin in sorted(installed, key=lambda entry: entry[:2]):
                self.add(plugin)

    def add(self, plugin: Plugin) -> None:
        self.plugins[plugin.pin] = plugin
        self.active[plugin.manifest["id"]] = plugin

    def catalog(self) -> list[dict]:
        return [plugin.definition for plugin in self.active.values()]

    def install(self, path: Path) -> None:
        if self.directory is None:
            raise ValueError("The plugin folder is unavailable.")
        if path.suffix.lower() != ".py":
            raise ValueError("Choose a Python plugin file.")
        content = path.read_bytes()
        plugin = read_plugin(content)
        self.directory.mkdir(parents=True, exist_ok=True)
        destination = self.directory / f"{plugin.checksum}.py"
        with NamedTemporaryFile(dir=self.directory, delete=False) as temporary:
            pending = Path(temporary.name)
        try:
            pending.write_bytes(content)
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
        self.add(plugin)

    def resolve(self, step: PluginStep) -> Plugin:
        plugin = self.plugins.get(step.pin)
        if plugin is None:
            raise ValueError(f"Install the original {step.plugin_id} plugin, version {step.version}, to replay this figure.")
        return plugin

    def execute(self, step: PluginStep, worksheet: Worksheet, references: dict) -> tuple[dict, dict[str, str]]:
        plugin = self.resolve(step)
        fields = plugin.manifest["fields"]
        defaults = {field["key"]: field.get("saved_default", field["default"])
                    for field in fields if field.get("optional")}
        options = {**defaults, **step.options}
        joint = plugin.manifest.get("input_mode") == "joint"
        if joint and references.keys() != {field["key"] for field in fields if field["type"] == "column"}:
            raise ValueError("Choose a source and column for each input.")
        if options.keys() != {field["key"] for field in fields}:
            raise ValueError("The plugin options do not match its controls.")
        columns = []
        for field in fields:
            value = options[field["key"]]
            if joint and field["type"] == "column":
                table, column = references[field["key"]]
                if not valid_value(field, column, len(table.columns)):
                    raise ValueError(f"Invalid value for {field['label']}.")
                options[field["key"]] = column
                continue
            if field["type"] == "column" and isinstance(value, str):
                value = options[field["key"]] = worksheet.column_index(value)
            if not valid_value(field, value, len(worksheet.columns)):
                raise ValueError(f"Invalid value for {field['label']}.")
            if field["type"] == "column":
                columns.append(value)
        if plugin.manifest.get("distinct_columns") and len(set(columns)) != len(columns):
            raise ValueError("Choose different X and Y columns." if len(columns) == 2 else "Choose different columns.")

        try:
            dependencies = installed_requirements(plugin.manifest.get("dependencies", []))
            with redirect_stdout(sys.stderr):
                args = worksheet.columns, worksheet.rows, options.copy()
                if joint:
                    args = (*args, Project.joint_inputs(references))
                if plugin.run is None:
                    result = run_plugin_source(plugin.source, step.plugin_id, *args)
                elif step.plugin_id in REFERENCE_FORMULA_PLUGINS:
                    result = plugin.run(*args, references)
                else:
                    result = plugin.run(*args)
            if not isinstance(result, dict):
                raise ValueError("The plugin must return a dictionary.")
            if plugin.table_only:
                if result.get("traces") or not result.get("sources"):
                    raise ValueError("A table-only plugin must return source tables without traces.")
                result = {**result, "traces": []}
            elif not isinstance(result.get("traces"), list) or not result["traces"]:
                raise ValueError("The plugin must return a figure with at least one trace.")
            if not all(isinstance(trace, dict) for trace in result["traces"]):
                raise ValueError("Each trace must be a dictionary.")
            for key in ("layout", "summary"):
                if not isinstance(result.get(key, {}), dict):
                    raise ValueError(f"The plugin {key} must be a dictionary.")
            for key in ("x_label", "y_label"):
                if not isinstance(result.get(key, ""), str):
                    raise ValueError("The plugin axis labels must be text.")
            elements = result.get("elements", [])
            if not isinstance(elements, list) or any(element not in ("observations", "fit", None) for element in elements):
                raise ValueError("Invalid plot element roles.")
            if elements and len(elements) != len(result["traces"]):
                raise ValueError("Supply one element role per trace.")
            if any(type(value) not in (bool, int, float, str, type(None)) for value in result.get("summary", {}).values()):
                raise ValueError("Invalid plugin summary value.")
            json.dumps(result, allow_nan=False)
        except (Exception, SystemExit) as exc:
            raise ValueError(f"{plugin.manifest['name']}: {exc}") from exc
        return result, dependencies


def plugin_step(recipe: PluginStep | LinearFit | Plot) -> PluginStep:
    if isinstance(recipe, PluginStep):
        return recipe
    identifier = "nigiro.linear_fit" if isinstance(recipe, LinearFit) else f"nigiro.{recipe.plot_type}"
    return PluginStep(identifier, "1", None, {"x": recipe.x, "y": recipe.y})
