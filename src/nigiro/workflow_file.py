"""Read and write reusable workflow definitions."""

from __future__ import annotations

import json
import re
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile

from .workflow import map_references

ACTIONS = {
    "import_data", "add_scalar", "add_array", "apply_formula", "execute_plugin",
    "run_plugin", "scale_column", "correct", "edit_item", "color", "figure_style",
    "run_batch", "trace_style", "inspect_style", "overlay_figures", "invoke_workflow",
}
OUTPUT_KEY = re.compile(r"([1-9][0-9]*)/(source|figure)/([0-9]+)")
TABLE_KEY = re.compile(r"[a-z][a-z0-9_-]*")


def command_group_ids(command):
    if group := command.get("input_group"):
        yield group["id"]
    if (group := command.get("output_group")) and group["mode"] == "existing":
        yield group["id"]


def validate_workflow(record: dict) -> dict:
    def require(condition, message="Invalid workflow definition."):
        if not condition:
            raise ValueError(message)

    def check_reference(kind, reference):
        match = OUTPUT_KEY.fullmatch(str(reference.get("output", ""))) if isinstance(reference, dict) else None
        require(match is not None, "Include the step that produces each input.")
        producer, output_kind, _ = match.groups()
        table = reference.get("table")
        require(int(producer) in available,
                "Under Workflow steps, include the step that produces each required source or figure.")
        require((kind == output_kind and table is None)
                or (kind == "source" and output_kind == "figure" and isinstance(table, str) and TABLE_KEY.fullmatch(table)))
        return reference

    require(isinstance(record, dict) and record.get("version") == 1)
    require(isinstance(record.get("name"), str) and bool(record["name"].strip()))
    require(all(isinstance(record.get(key), list) for key in ("steps", "inputs", "outputs")))
    require(bool(record["steps"]) and bool(record["outputs"]), "Choose steps and at least one output.")
    groups = record.get("source_groups", {})
    memberships = record.get("source_memberships", {})
    require(isinstance(groups, dict) and isinstance(memberships, dict))
    for group_id, settings in groups.items():
        require(isinstance(group_id, str) and group_id.startswith("manual:") and isinstance(settings, dict)
                and isinstance(settings.get("name"), str) and bool(settings["name"].strip()))
    available = {}
    for step in record["steps"]:
        require(isinstance(step, dict) and type(step.get("id")) is int and step["id"] > 0 and step["id"] not in available)
        require(isinstance(step.get("label"), str) and isinstance(step.get("request"), dict))
        action = step["request"].get("action")
        require(isinstance(action, str) and action in ACTIONS, "This step cannot be saved in a reusable workflow.")
        if action == "invoke_workflow":
            validate_workflow(step["request"]["definition"])
        for group_id in command_group_ids(step["request"]):
            earlier = re.fullmatch(r"step:([1-9][0-9]*)", group_id)
            require(group_id in groups or (earlier and int(earlier[1]) in available),
                    "Include the earlier step that creates the source group.")
        map_references(step["request"], check_reference)
        available[step["id"]] = step["request"]

    for reference, group_id in memberships.items():
        check_reference("source", json.loads(reference))
        require(group_id is None or isinstance(group_id, str))

    ports = set()
    for port in record["inputs"]:
        require(isinstance(port, dict) and isinstance(port.get("name"), str) and bool(port["name"].strip()))
        require(type(port.get("exposed", True)) is bool)
        output = port.get("output")
        require(isinstance(output, str) and output not in ports)
        check_reference("source", {"output": output})
        step_id, _, index = OUTPUT_KEY.fullmatch(output).groups()
        producer = available[int(step_id)]
        require((port.get("kind") == "csv" and producer["action"] == "import_data")
                or (port.get("kind") == "number" and producer["action"] == "add_scalar"
                    and "value" in producer and index == "0"))
        ports.add(output)
    for step_id, command in available.items():
        if command["action"] == "import_data":
            prefix = f"{step_id}/source/"
            indexes = sorted(int(port.rsplit("/", 1)[1]) for port in ports if port.startswith(prefix))
            require(indexes and indexes == list(range(len(indexes))), "Each data import must have a workflow input.")

    references = set()
    for port in record["outputs"]:
        require(isinstance(port, dict) and isinstance(port.get("name"), str) and bool(port["name"].strip()))
        require(port.get("kind") in ("source", "figure"))
        ref = check_reference(port["kind"], port.get("reference"))
        identity = (ref["output"], ref.get("table"))
        require(identity not in references, "Choose each workflow output only once.")
        references.add(identity)
    return record


def read_workflow(path: Path) -> dict:
    try:
        return validate_workflow(json.loads(path.read_text(encoding="utf-8")))
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise ValueError(f"Could not read workflow. {error}") from error


def write_workflow(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as file:
        pending = Path(file.name)
        try:
            json.dump(record, file, indent=2, ensure_ascii=False, allow_nan=False)
            file.write("\n")
            file.close()
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)


def register_workflow(directory: Path, record: dict) -> str:
    digest = sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()[:16]
    write_workflow(directory / f"{digest}.nigiro-workflow", record)
    return digest


def workflow_catalog(directory: Path) -> dict[str, dict]:
    catalog = {}
    for path in sorted(directory.glob("*.nigiro-workflow")):
        try:
            record = read_workflow(path)
        except (OSError, ValueError):
            continue
        catalog[path.stem] = record
    return catalog
