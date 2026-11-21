"""Immutable project inputs and the operations that describe a worksheet and figure."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field, replace
from functools import cached_property
from typing import Literal

from .figure_style import AxisStyle, FigureStyle
from .source_tables import SourceTable, raw_source_id, source_origin


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
    source_id: str | None = None

    def __post_init__(self) -> None:
        if (
            type(self.row) is not int or self.row < 0
            or type(self.column) is not int or self.column < 0
            or not isinstance(self.value, str)
            or (self.source_id is not None and source_origin(self.source_id) is not None)
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
    figure_id: int | None = None

    def __post_init__(self) -> None:
        if self.element not in ("fit", "observations") or not (
            isinstance(self.color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", self.color)
        ):
            raise ValueError("Invalid figure color.")
        if self.figure_id is not None and (type(self.figure_id) is not int or self.figure_id < 0):
            raise ValueError("Invalid figure reference.")


@dataclass(frozen=True)
class FigureAppearance:
    figure_id: int
    style: FigureStyle

    def __post_init__(self) -> None:
        if type(self.figure_id) is not int or self.figure_id < 0:
            raise ValueError("Invalid figure reference.")
        if isinstance(self.style, dict):
            object.__setattr__(self, "style", FigureStyle(**self.style))
        elif not isinstance(self.style, FigureStyle):
            raise ValueError("Invalid figure settings.")


@dataclass(frozen=True)
class PluginStep:
    plugin_id: str
    version: str
    checksum: str | None
    options: dict[str, str | int | float | bool]
    keep_style: bool = False
    source_id: str | None = None
    figure_id: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.plugin_id, str) or not self.plugin_id or not isinstance(self.version, str) or not self.version:
            raise ValueError("Invalid plugin record.")
        if self.checksum is not None and not (
            isinstance(self.checksum, str) and re.fullmatch(r"[0-9a-f]{64}", self.checksum)
        ):
            raise ValueError("Invalid plugin checksum.")
        if type(self.keep_style) is not bool:
            raise ValueError("Invalid plugin style setting.")
        if self.source_id is not None:
            source_origin(self.source_id)
        if self.figure_id is not None and (type(self.figure_id) is not int or self.figure_id < 0):
            raise ValueError("Invalid figure reference.")
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


FigureRecipe = LinearFit | Plot | PluginStep


@dataclass(frozen=True)
class ResidualFigure:
    fit_id: int

    def __post_init__(self) -> None:
        if type(self.fit_id) is not int or self.fit_id < 0:
            raise ValueError("Invalid fit figure reference.")


@dataclass(frozen=True)
class ItemEdit:
    target: Literal["source", "figure"]
    item_id: str | int | None
    name: str | None

    def __post_init__(self) -> None:
        if self.target == "figure":
            if type(self.item_id) is not int or self.item_id < 0:
                raise ValueError("Invalid figure reference.")
        elif self.target == "source":
            if self.item_id is not None:
                source_origin(self.item_id)
            elif self.name is None:
                raise ValueError("The imported source is required for this project.")
        else:
            raise ValueError("Invalid project item type.")
        if self.name is not None:
            if not isinstance(self.name, str) or not self.name.strip():
                raise ValueError("Enter a name.")
            object.__setattr__(self, "name", self.name.strip())


@dataclass(frozen=True)
class OverlayFigure:
    figure_ids: tuple[int, ...]
    fit_id: int | None = None

    def __post_init__(self) -> None:
        if (
            not isinstance(self.figure_ids, (list, tuple)) or len(self.figure_ids) < 2
            or any(type(key) is not int or key < 0 for key in self.figure_ids)
            or len(set(self.figure_ids)) != len(self.figure_ids)
        ):
            raise ValueError("Choose at least two different figures to overlay.")
        if self.fit_id is not None and (type(self.fit_id) is not int or self.fit_id < 0):
            raise ValueError("Invalid fit overlay reference.")
        object.__setattr__(self, "figure_ids", tuple(self.figure_ids))


@dataclass(frozen=True)
class AddFigureLayers:
    target_id: int
    figure_ids: tuple[int, ...]

    def __post_init__(self) -> None:
        if (
            type(self.target_id) is not int or self.target_id < 0
            or not isinstance(self.figure_ids, (list, tuple)) or not self.figure_ids
            or any(type(key) is not int or key < 0 for key in self.figure_ids)
            or len(set(self.figure_ids)) != len(self.figure_ids) or self.target_id in self.figure_ids
        ):
            raise ValueError("Choose valid figures to combine.")
        object.__setattr__(self, "figure_ids", tuple(self.figure_ids))


Operation = (
    Correction | FigureRecipe | FigureColor | FigureStyle | FigureAppearance | ResidualFigure | ItemEdit
    | OverlayFigure | AddFigureLayers
)
DEFAULT_COLORS = {"observations": "#245e9b", "fit": "#be481f"}


@dataclass(frozen=True)
class FigureRecord:
    recipe: FigureRecipe
    style: FigureStyle
    colors: dict[str, str]
    part: Literal["fit", "residual"] | None = None
    fit_id: int | None = None
    overlay: OverlayFigure | None = None
    layers: tuple[int, ...] = ()

    def members(self, figure_id: int) -> tuple[int, ...]:
        return (self.overlay.figure_ids if self.overlay else (figure_id,)) + self.layers


@dataclass(frozen=True)
class Project:
    source: Source | None = None
    operations: tuple[Operation, ...] = ()
    saved_sources: dict[str, SourceTable] = field(default_factory=dict)
    additional_sources: tuple[Source, ...] = ()
    last_import_path: str | None = None

    def apply(self, operation: Operation) -> Project:
        updated = replace(self, operations=(*self.operations, operation))
        updated.validate()
        return updated

    def validate(self) -> None:
        if self.last_import_path is not None and not isinstance(self.last_import_path, str):
            raise ValueError("Invalid saved import path.")
        for source in self.raw_sources.values():
            source.worksheet
        if self.source is None and self.additional_sources:
            raise ValueError("A project with imported data needs a primary source.")
        column_count = len(self.source.worksheet.columns) if self.source else 0
        for operation in self.operations:
            if isinstance(operation, Correction):
                source = self.raw_sources.get(operation.source_id)
                if source is None or operation.row >= len(source.worksheet.rows) or operation.column >= len(source.worksheet.columns):
                    raise ValueError("Correction refers to a missing worksheet cell.")
            if isinstance(operation, LinearFit) and max(operation.x, operation.y) >= column_count:
                raise ValueError("Fit refers to a missing worksheet column.")

            if isinstance(operation, Plot) and max(operation.x, operation.y) >= column_count:
                raise ValueError("Plot refers to a missing worksheet column.")
        figures = self.figures
        for key in self.saved_sources:
            if source_origin(key) not in figures:
                raise ValueError("A saved source refers to a missing figure.")
        for target, item_id in self.item_edits:
            if target == "figure" and item_id not in figures:
                raise ValueError("A recorded edit refers to a missing figure.")
            if target == "source" and item_id not in self.raw_sources and (
                item_id is None or source_origin(item_id) not in figures
            ):
                raise ValueError("A recorded edit refers to a missing source.")

    @cached_property
    def item_edits(self) -> dict[tuple[str, str | int | None], str | None]:
        return {(op.target, op.item_id): op.name for op in self.operations if isinstance(op, ItemEdit)}

    @cached_property
    def item_names(self) -> dict[tuple[str, str | int | None], str]:
        return {
            (op.target, op.item_id): op.name
            for op in self.operations if isinstance(op, ItemEdit) and op.name is not None
        }

    def item_deleted(self, target: str, item_id: str | int | None) -> bool:
        key = (target, item_id)
        return key in self.item_edits and self.item_edits[key] is None

    @cached_property
    def visible_figures(self) -> dict[int, FigureRecord]:
        members = {
            key for op in self.operations if isinstance(op, (OverlayFigure, AddFigureLayers)) for key in op.figure_ids
        }
        return {
            key: figure for key, figure in self.figures.items()
            if key not in members and not self.item_deleted("figure", key)
        }

    @cached_property
    def figures(self) -> dict[int, FigureRecord]:
        figures = {}
        current = None
        legacy_colors = DEFAULT_COLORS.copy()
        for index, op in enumerate(self.operations):
            if isinstance(op, (LinearFit, Plot, PluginStep)):
                updating = isinstance(op, PluginStep) and op.figure_id is not None
                if updating:
                    current = op.figure_id
                    previous = figures.get(current)
                    if previous is None or op.source_id != getattr(previous.recipe, "source_id", None):
                        raise ValueError("A plugin update refers to an invalid figure or source.")
                    figures[current] = replace(previous, recipe=op)
                    for key, record in figures.items():
                        if record.fit_id == current:
                            figures[key] = replace(record, recipe=op)
                    continue
                if isinstance(op, PluginStep) and op.source_id not in self.raw_sources and (
                    op.source_id is None or source_origin(op.source_id) not in figures
                ):
                    raise ValueError("A plugin refers to a missing input source.")
                previous = figures.get(current)
                style = previous.style if isinstance(op, PluginStep) and op.keep_style and previous else FigureStyle()
                current = index
                figures[current] = FigureRecord(op, style, legacy_colors.copy())
            elif isinstance(op, ResidualFigure):
                fit = figures.get(op.fit_id)
                if fit is None or fit.part is not None or not (
                    isinstance(fit.recipe, PluginStep) and fit.recipe.pin == ("nigiro.linear_fit", "1", None)
                ):
                    raise ValueError("A residual figure needs a linear fit.")
                figures[op.fit_id] = replace(fit, part="fit")
                figures[index] = FigureRecord(
                    fit.recipe, FigureStyle(y=AxisStyle(zero_line=True)),
                    legacy_colors.copy(), part="residual", fit_id=op.fit_id,
                )
            elif isinstance(op, OverlayFigure):
                if any(key not in figures or figures[key].overlay for key in op.figure_ids):
                    raise ValueError("An overlay refers to a missing or combined figure.")
                current = index
                first = figures[op.figure_ids[0]]
                if op.fit_id is not None and (
                    op.fit_id not in figures or not figures[op.fit_id].overlay
                    or figures[op.fit_id].part != "fit" or first.part != "residual"
                ):
                    raise ValueError("A residual overlay needs a fit overlay.")
                figures[index] = replace(first, fit_id=op.fit_id, overlay=op)
            elif isinstance(op, AddFigureLayers):
                target = figures.get(op.target_id)
                if target is None or any(
                    key not in figures or figures[key].overlay or figures[key].layers
                    or key in target.members(op.target_id) for key in op.figure_ids
                ):
                    raise ValueError("A figure layer refers to a missing or combined figure.")
                figures[op.target_id] = replace(target, layers=target.layers + op.figure_ids)
            elif isinstance(op, FigureColor):
                target = op.figure_id if op.figure_id is not None else current
                if op.figure_id is None:
                    legacy_colors[op.element] = op.color
                if target in figures:
                    record = figures[target]
                    figures[target] = replace(record, colors={**record.colors, op.element: op.color})
                elif op.figure_id is not None:
                    raise ValueError("A color change refers to a missing figure.")
            elif isinstance(op, FigureAppearance):
                if op.figure_id not in figures:
                    raise ValueError("A settings change refers to a missing figure.")
                figures[op.figure_id] = replace(figures[op.figure_id], style=op.style)
            elif isinstance(op, FigureStyle) and current in figures:
                figures[current] = replace(figures[current], style=op)
        return figures

    @property
    def last_figure_id(self) -> int | None:
        figure_id = next(reversed(self.visible_figures), None)
        if figure_id is not None:
            fit_id = self.visible_figures[figure_id].fit_id
            if fit_id in self.visible_figures:
                return fit_id
        return figure_id

    @property
    def figure(self) -> FigureRecipe | None:
        return self.figures[self.last_figure_id].recipe if self.visible_figures else None

    @property
    def figure_style(self) -> FigureStyle:
        return self.figures[self.last_figure_id].style if self.visible_figures else FigureStyle()

    @cached_property
    def worksheet(self) -> Worksheet:
        return self.working_worksheets.get(None, Worksheet((), ()))

    @cached_property
    def raw_sources(self) -> dict[str | None, Source]:
        if self.source is None:
            return {}
        return {None: self.source, **{raw_source_id(index): source for index, source in enumerate(self.additional_sources)}}

    @cached_property
    def working_worksheets(self) -> dict[str | None, Worksheet]:
        corrections = {}
        for op in self.operations:
            if isinstance(op, Correction):
                corrections.setdefault(op.source_id, {})[op.row, op.column] = op.value
        return {
            key: self.corrected_worksheet(source.worksheet, corrections.get(key, {}))
            for key, source in self.raw_sources.items()
        }

    @staticmethod
    def corrected_worksheet(original: Worksheet, changes: dict[tuple[int, int], str]) -> Worksheet:
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
            if isinstance(operation, PluginStep) and operation.source_id is None and operation.pin == ("nigiro.linear_fit", "1", None):
                x, y = operation.options.get("x"), operation.options.get("y")
                if type(x) is int and type(y) is int and 0 <= min(x, y) <= max(x, y) < len(self.worksheet.columns):
                    return LinearFit(x, y)
        return None

    @cached_property
    def colors(self) -> dict[str, str]:
        if self.visible_figures:
            return self.figures[self.last_figure_id].colors
        return {**DEFAULT_COLORS, **{op.element: op.color for op in self.operations if isinstance(op, FigureColor)}}


def numeric_value(text: str) -> float | None:
    if not text.strip():
        return None
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("Expected a finite number.")
    return value
