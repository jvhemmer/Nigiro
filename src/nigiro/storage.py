"""Portable project archives with original CSV bytes and a versioned recipe."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import tempfile
from dataclasses import asdict
from pathlib import Path
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

import numpy
import scipy

from .figure_style import FigureStyle
from .project import (
    AddFigureLayers, Correction, FigureAppearance, FigureColor, ItemEdit, LinearFit, Operation, OverlayFigure, Plot, PluginStep,
    Project, ResidualFigure, Source,
)
from .source_tables import SourceTable


OPERATION_TYPES = {
    "correct_cell": Correction,
    "linear_fit": LinearFit,
    "plot": Plot,
    "plugin": PluginStep,
    "figure_color": FigureColor,
    "figure_style": FigureStyle,
    "figure_appearance": FigureAppearance,
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
    return record


def source_metadata(source: Source) -> dict:
    return {
        "name": source.name, "encoding": source.encoding, "delimiter": source.delimiter,
        "sha256": hashlib.sha256(source.content).hexdigest(),
    }


def read_source(archive: ZipFile, path: str, metadata: dict) -> Source:
    content = archive.read(path)
    if hashlib.sha256(content).hexdigest() != metadata["sha256"]:
        raise ValueError("The embedded source does not match its checksum.")
    if not isinstance(metadata["name"], str):
        raise ValueError("Invalid source file name.")
    return Source(metadata["name"], content, metadata["encoding"], metadata["delimiter"])


def save_project(path: Path, project: Project) -> None:
    project.validate()
    source = project.source
    manifest = {
        "format_version": 2 if source is None or project.additional_sources or any(
            isinstance(op, (OverlayFigure, AddFigureLayers)) for op in project.operations
        ) else 1,
        "source": source_metadata(source) if source else None,
        "operations": [operation_record(op) for op in project.operations],
        "saved_with": {
            "python": platform.python_version(),
            "numpy": numpy.__version__,
            "scipy": scipy.__version__,
        },
    }
    if project.saved_sources:
        manifest["derived_sources"] = {key: asdict(table) for key, table in project.saved_sources.items()}
    if project.additional_sources:
        manifest["additional_sources"] = [source_metadata(item) for item in project.additional_sources]
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with ZipFile(temporary_path, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
            if source:
                archive.writestr("source.csv", source.content)
            for index, item in enumerate(project.additional_sources):
                archive.writestr(f"sources/{index}.csv", item.content)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_project(path: Path) -> Project:
    try:
        with ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            version = manifest["format_version"]
            if type(version) is not int or version not in (1, 2):
                raise ValueError("Unsupported Nigiro project format.")
            metadata = manifest["source"]
            source = None if version == 2 and metadata is None else read_source(archive, "source.csv", metadata)
            additional = tuple(
                read_source(archive, f"sources/{index}.csv", metadata)
                for index, metadata in enumerate(manifest.get("additional_sources", ()))
            )
        operations = []
        for record in manifest["operations"]:
            fields = dict(record)
            cls = OPERATION_TYPES[fields.pop("kind")]
            operations.append(cls(**fields))
        records = manifest.get("derived_sources", {})
        if not isinstance(records, dict):
            raise ValueError("Invalid saved sources.")
        tables = {key: SourceTable.from_record(record) for key, record in records.items()}
        project = Project(source, tuple(operations), tables, additional)
        project.validate()
        return project
    except (BadZipFile, LookupError, RuntimeError, TypeError) as exc:
        raise ValueError("The Nigiro project archive is invalid.") from exc
