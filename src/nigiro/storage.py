"""Portable project archives with original data bytes and a versioned recipe."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict
from pathlib import Path
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from .figure_style import FigureStyle
from .project import (
    AddFigureLayers, Correction, FigureAppearance, FigureColor, ItemEdit, LinearFit, Operation, OverlayFigure, Plot, PluginStep,
    Project, ResidualFigure, ScaleColumn, Source, TraceAppearance,
)
from .source_tables import SourceTable
from .text_import import TextImport
from .workflow import Step, Workflow
from .workflow_file import fixed_source_record, read_fixed_source, validate_project_workflow_configuration, validate_workflow


OPERATION_TYPES = {
    "correct_cell": Correction,
    "scale_column": ScaleColumn,
    "linear_fit": LinearFit,
    "plot": Plot,
    "plugin": PluginStep,
    "figure_color": FigureColor,
    "figure_style": FigureStyle,
    "figure_appearance": FigureAppearance,
    "trace_appearance": TraceAppearance,
    "residual_figure": ResidualFigure,
    "item_edit": ItemEdit,
    "overlay_figure": OverlayFigure,
    "add_figure_layers": AddFigureLayers,
}
OPERATION_NAMES = {cls: name for name, cls in OPERATION_TYPES.items()}


def operation_record(operation: Operation) -> dict:
    record = {"kind": OPERATION_NAMES[type(operation)], **asdict(operation)}
    if isinstance(operation, Correction) and operation.source_id is None:
        del record["source_id"]
    if isinstance(operation, PluginStep):
        if not operation.references:
            del record["references"]
        if operation.comment is None:
            del record["comment"]
    if isinstance(operation, ItemEdit) and not operation.internal:
        del record["internal"]
    return record


FORMAT_VERSION = 3


def source_file(checksum: str) -> str:
    return f"sources/{checksum}.csv"


def write_source(archive: ZipFile, source: Source, files: dict[bytes, str]) -> dict:
    comment = {"comment": source.comment} if source.comment else {}
    if source.scalar_value is not None:
        formula = {"scalar_formula": source.scalar_formula} if source.scalar_formula is not None else {}
        return {"name": source.name, "scalar_value": source.scalar_value, **comment, **formula}
    if source.content not in files:
        checksum = hashlib.sha256(source.content).hexdigest()
        archive.writestr(source_file(checksum), source.content)
        files[source.content] = checksum
    return {
        "name": source.name, "encoding": source.encoding, "delimiter": source.delimiter,
        "sha256": files[source.content], "original_path": source.original_path, **comment,
        **({"text_import": asdict(source.text_import)} if source.text_import is not None else {}),
    }


def read_source(archive: ZipFile, metadata: dict, files: dict[str, bytes]) -> Source:
    if "scalar_value" in metadata:
        return Source.scalar(metadata["name"], metadata["scalar_value"], metadata.get("comment"),
                             formula=metadata.get("scalar_formula"))
    checksum = metadata["sha256"]
    if not isinstance(checksum, str) or len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
        raise ValueError("Invalid source checksum.")
    if checksum not in files:
        content = archive.read(source_file(checksum))
        if hashlib.sha256(content).hexdigest() != checksum:
            raise ValueError("The embedded source does not match its checksum.")
        files[checksum] = content
    if not isinstance(metadata["name"], str):
        raise ValueError("Invalid source name.")
    return Source(metadata["name"], files[checksum], metadata["encoding"], metadata["delimiter"],
                  metadata["original_path"], comment=metadata.get("comment"),
                  text_import=TextImport(**metadata["text_import"]) if "text_import" in metadata else None)


def project_record(archive: ZipFile, project: Project, files: dict[bytes, str]) -> dict:
    project.validate()
    return {
        "sources": [write_source(archive, source, files) for source in project.raw_sources.values()],
        "operations": [operation_record(op) for op in project.operations],
        "derived_sources": {key: asdict(table) for key, table in project.saved_sources.items()},
        "last_import_path": project.last_import_path,
        "notes": project.notes,
    }


def read_project(archive: ZipFile, record: dict, files: dict[str, bytes]) -> Project:
    sources = [read_source(archive, source, files) for source in record["sources"]]
    operations = []
    for operation in record["operations"]:
        fields = dict(operation)
        cls = OPERATION_TYPES[fields.pop("kind")]
        operations.append(cls(**fields))
    tables = {key: SourceTable.from_record(value) for key, value in record["derived_sources"].items()}
    project = Project(
        source=sources[0] if sources else None, operations=tuple(operations), saved_sources=tables,
        additional_sources=tuple(sources[1:]), last_import_path=record["last_import_path"], notes=record.get("notes", ""),
    )
    project.validate()
    return project


def map_workflow_definition_sources(definition: dict, transform) -> dict:
    updated = definition.copy()
    if "fixed_sources" in definition:
        updated["fixed_sources"] = {key: transform(source) for key, source in definition["fixed_sources"].items()}
    updated["steps"] = [
        {**step, "request": map_workflow_command_sources(step["request"], transform)} for step in definition["steps"]
    ]
    return updated


def map_workflow_command_sources(command: dict, transform) -> dict:
    if command["action"] != "invoke_workflow":
        return command
    return {**command, "definition": map_workflow_definition_sources(command["definition"], transform)}


def workflow_record(archive: ZipFile, workflow: Workflow, files: dict[bytes, str]) -> dict:
    def store_fixed(source):
        return write_source(archive, read_fixed_source(source), files)

    return {
        "base": project_record(archive, workflow.base, files),
        "steps": [
            {"id": step.id, "label": step.label, "request": map_workflow_command_sources(step.request, store_fixed),
             "inputs": [write_source(archive, source, files) for source in step.sources]}
            for step in workflow.steps
        ],
        "completed": workflow.completed,
        "executed": sorted(workflow.executed),
        "bindings": workflow.bindings,
        "needs_replay": workflow.needs_replay,
        "error": workflow.error,
        "source_order": workflow.source_order,
        "source_groups": workflow.source_groups,
        "source_memberships": workflow.source_memberships,
        "next_step_id": workflow.next_step_id,
        "interface": workflow.interface,
        "imported_workflows": {
            key: {**entry, "definition": map_workflow_definition_sources(entry["definition"], store_fixed)}
            for key, entry in workflow.imported_workflows.items()
        },
    }


def read_workflow(archive: ZipFile, record: dict, files: dict[str, bytes]) -> Workflow:
    def restore_fixed(source):
        return fixed_source_record(read_source(archive, source, files))

    steps = [
        Step(step["id"], step["label"], map_workflow_command_sources(step["request"], restore_fixed),
             tuple(read_source(archive, source, files) for source in step["inputs"]))
        for step in record["steps"]
    ]
    completed = record["completed"]
    if type(completed) is not int or not 0 <= completed <= len(steps):
        raise ValueError("Invalid workflow progress.")
    next_step_id = record["next_step_id"]
    ids = {step.id for step in steps}
    if (any(type(step.id) is not int or step.id < 1 or not isinstance(step.label, str)
            or not isinstance(step.request, dict) for step in steps)
        or len(ids) != len(steps) or type(next_step_id) is not int
        or next_step_id <= max(ids, default=0)):
        raise ValueError("Invalid recorded step IDs or commands.")
    imported = {
        key: {**entry, "definition": map_workflow_definition_sources(entry["definition"], restore_fixed)}
        for key, entry in record.get("imported_workflows", {}).items()
    }
    interface = record.get("interface")
    if interface is not None:
        validate_project_workflow_configuration(interface)
    for entry in imported.values():
        if not isinstance(entry.get("path"), str):
            raise ValueError("Invalid workflow project path.")
        validate_project_workflow_configuration(entry["configuration"])
        validate_workflow(entry["definition"])
    return Workflow(
        base=read_project(archive, record["base"], files),
        steps=steps, completed=completed, executed=set(record["executed"]), bindings=record["bindings"],
        needs_replay=record["needs_replay"], error=record["error"], source_order=record["source_order"],
        next_step_id=next_step_id,
        source_groups=record.get("source_groups", {}), source_memberships=record.get("source_memberships", {}),
        interface=interface, imported_workflows=imported,
    )


def save_project(path: Path, project: Project, workflow: Workflow | None = None) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        pending = Path(temporary.name)
    try:
        with ZipFile(pending, "w", compression=ZIP_DEFLATED) as archive:
            files = {}
            manifest = {
                "format_version": FORMAT_VERSION,
                "project": project_record(archive, project, files),
                "workflow": workflow_record(archive, workflow, files) if workflow is not None else None,
            }
            archive.writestr("manifest.json", json.dumps(manifest, allow_nan=False))
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def load_project_session(path: Path) -> tuple[Project, Workflow]:
    try:
        with ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            version = manifest["format_version"]
            if type(version) is not int or version != FORMAT_VERSION:
                raise ValueError("Unsupported Nigiro project format.")
            files = {}
            project = read_project(archive, manifest["project"], files)
            record = manifest["workflow"]
            workflow = Workflow(project) if record is None else read_workflow(archive, record, files)
            return project, workflow
    except (AttributeError, BadZipFile, LookupError, RuntimeError, TypeError) as exc:
        raise ValueError("The Nigiro project archive is invalid.") from exc


def load_project(path: Path) -> Project:
    return load_project_session(path)[0]
