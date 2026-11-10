"""Immutable project inputs and the operations that describe a worksheet and figure."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, replace
from functools import cached_property
from typing import Literal


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


@dataclass(frozen=True)
class FigureColor:
    element: Literal["fit", "observations"]
    color: str

    def __post_init__(self) -> None:
        if self.element not in ("fit", "observations") or not (
            isinstance(self.color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", self.color)
        ):
            raise ValueError("Invalid figure color.")


Operation = Correction | LinearFit | FigureColor


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
        return next((op for op in reversed(self.operations) if isinstance(op, LinearFit)), None)

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
