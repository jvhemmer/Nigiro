"""Immutable project inputs and the operations that describe a worksheet and figure."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, replace
from functools import cached_property
from typing import Literal

from .figure_style import FigureStyle


@dataclass(frozen=True)
class Source:
    name: str
    content: bytes
    encoding: str = "utf-8-sig"
    delimiter: str = ","

    @cached_property
    def worksheet(self) -> Worksheet:
        stream = io.StringIO(self.content.decode(self.encoding), newline="")
        reader = csv.reader(stream, delimiter=self.delimiter, strict=True)
        header = next(reader, None)
        if not header or not any(name.strip() for name in header):
            raise ValueError("The CSV needs a header row.")
        rows = []
        for row in reader:
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError(f"CSV line {reader.line_num} has the wrong number of fields.")
            rows.append(tuple(row))
        if not rows:
            raise ValueError("The CSV needs at least one data row.")
        return Worksheet(tuple(header), tuple(rows))


@dataclass(frozen=True)
class Worksheet:
    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class Correction:
    row: int
    column: int
    value: str

    def __post_init__(self) -> None:
        if (
            type(self.row) is not int or self.row < 0
            or type(self.column) is not int or self.column < 0
            or not isinstance(self.value, str)
        ):
            raise ValueError("Invalid worksheet correction.")


@dataclass(frozen=True)
class LinearFit:
    x: int
    y: int
    version: int = 1

    def __post_init__(self) -> None:
        if type(self.x) is not int or type(self.y) is not int or min(self.x, self.y) < 0:
            raise ValueError("Invalid fit columns.")
        if type(self.version) is not int or self.version != 1:
            raise ValueError("Unsupported linear fit version.")


PlotKind = Literal["scatter", "line", "bar"]


@dataclass(frozen=True)
class Plot:
    plot_type: PlotKind
    x: int
    y: int

    def __post_init__(self) -> None:
        if self.plot_type not in ("scatter", "line", "bar"):
            raise ValueError("Unknown plot type.")
        if type(self.x) is not int or type(self.y) is not int or min(self.x, self.y) < 0:
            raise ValueError("Invalid plot columns.")
        if self.x == self.y:
            raise ValueError("Choose different X and Y columns.")


@dataclass(frozen=True)
class FigureColor:
    element: Literal["fit", "observations"]
    color: str

    def __post_init__(self) -> None:
        if self.element not in ("fit", "observations") or not (
            isinstance(self.color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", self.color)
        ):
            raise ValueError("Invalid figure color.")


@dataclass(frozen=True)
class PluginStep:
    plugin_id: str
    version: str
    checksum: str | None
    options: dict[str, str | int | float | bool]
    keep_style: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.plugin_id, str) or not self.plugin_id or not isinstance(self.version, str) or not self.version:
            raise ValueError("Invalid plugin record.")
        if self.checksum is not None and not (
            isinstance(self.checksum, str) and re.fullmatch(r"[0-9a-f]{64}", self.checksum)
        ):
            raise ValueError("Invalid plugin checksum.")
        if type(self.keep_style) is not bool:
            raise ValueError("Invalid plugin style setting.")
        if not isinstance(self.options, dict) or any(
            not isinstance(key, str) or type(value) not in (str, int, float, bool)
            or (isinstance(value, float) and not math.isfinite(value))
            for key, value in self.options.items()
        ):
            raise ValueError("Invalid saved plugin options.")
        object.__setattr__(self, "options", self.options.copy())

    @property
    def pin(self) -> tuple[str, str, str | None]:
        return self.plugin_id, self.version, self.checksum


Operation = Correction | LinearFit | Plot | PluginStep | FigureColor | FigureStyle


@dataclass(frozen=True)
class Project:
    source: Source
    operations: tuple[Operation, ...] = ()

    def apply(self, operation: Operation) -> Project:
        updated = replace(self, operations=(*self.operations, operation))
        updated.validate()
        return updated

    def validate(self) -> None:
        rows = self.source.worksheet.rows
        column_count = len(self.source.worksheet.columns)
        for operation in self.operations:
            if isinstance(operation, Correction):
                if operation.row >= len(rows) or operation.column >= column_count:
                    raise ValueError("Correction refers to a missing worksheet cell.")
            if isinstance(operation, LinearFit) and max(operation.x, operation.y) >= column_count:
                raise ValueError("Fit refers to a missing worksheet column.")

            if isinstance(operation, Plot) and max(operation.x, operation.y) >= column_count:
                raise ValueError("Plot refers to a missing worksheet column.")

    @cached_property
    def figure(self) -> LinearFit | Plot | PluginStep | None:
        return next((op for op in reversed(self.operations) if isinstance(op, (LinearFit, Plot, PluginStep))), None)

    @cached_property
    def figure_style(self) -> FigureStyle:
        for operation in reversed(self.operations):
            if isinstance(operation, FigureStyle):
                return operation
            if isinstance(operation, PluginStep) and operation.keep_style:
                continue
            if isinstance(operation, (LinearFit, Plot, PluginStep)):
                break
        return FigureStyle()

    @cached_property
    def worksheet(self) -> Worksheet:
        original = self.source.worksheet
        changes = {
            (op.row, op.column): op.value
            for op in self.operations
            if isinstance(op, Correction)
        }
        if not changes:
            return original
        return Worksheet(
            original.columns,
            tuple(
                tuple(changes.get((r, c), value) for c, value in enumerate(row))
                for r, row in enumerate(original.rows)
            ),
        )

    @cached_property
    def fit(self) -> LinearFit | None:
        for operation in reversed(self.operations):
            if isinstance(operation, LinearFit):
                return operation
            if isinstance(operation, PluginStep) and operation.pin == ("nigiro.linear_fit", "1", None):
                x, y = operation.options.get("x"), operation.options.get("y")
                if type(x) is int and type(y) is int and 0 <= min(x, y) <= max(x, y) < len(self.worksheet.columns):
                    return LinearFit(x, y)
        return None

    @cached_property
    def colors(self) -> dict[str, str]:
        return {
            "observations": "#245e9b",
            "fit": "#be481f",
            **{op.element: op.color for op in self.operations if isinstance(op, FigureColor)},
        }


def numeric_value(text: str) -> float | None:
    if not text.strip():
        return None
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("Expected a finite number.")
    return value
