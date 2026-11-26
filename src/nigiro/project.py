"""Immutable project inputs and the operations that describe a worksheet and figure."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field, replace
from functools import cached_property
from typing import Literal

from .column_formula import run_scalar_formula
from .figure_style import AxisStyle, FigureStyle
from .source_tables import FIT_PLUGINS, TABLE_ONLY_PLUGINS, SourceTable, raw_source_id, source_origin
from .text_import import TextImport, decode_table, text_table

PAIRED_PLOT_PLUGINS = {"nigiro.scatter", "nigiro.line", "nigiro.bar"}


def normalize_comment(comment: str | None) -> str | None:
    if comment is None:
        return None
    if not isinstance(comment, str):
        raise ValueError("Enter the comment as text.")
    return comment.strip() or None


@dataclass(frozen=True)
class Source:
    name: str
    content: bytes
    encoding: str = "utf-8-sig"
    delimiter: str = ","
    original_path: str | None = None
    scalar_value: float | None = None
    comment: str | None = None
    scalar_formula: dict | None = None
    text_import: TextImport | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "comment", normalize_comment(self.comment))

    @classmethod
    def scalar(cls, name: str, value: float, comment: str | None = None, *, formula: dict | None = None) -> Source:
        if not isinstance(name, str) or not name.strip() or any(c in name for c in ("\n", "\r", "\0")):
            raise ValueError("Enter a name for the scalar source.")
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Enter a finite scalar value.")
        return cls(name.strip(), f"Value\n{value}\n".encode("utf-8"), scalar_value=value, comment=comment, scalar_formula=formula)

    @classmethod
    def array(cls, name: str, text: str, comment: str | None = None) -> Source:
        if not isinstance(name, str) or not name.strip() or any(c in name for c in "\n\r\0"):
            raise ValueError("Enter a name for the array.")
        if not isinstance(text, str):
            raise ValueError("Enter values for the array.")
        try:
            values = [float(item) for item in re.split(r"[,;\s]+", text.strip()) if item]
        except ValueError as error:
            raise ValueError("Enter numbers separated by spaces, commas, or new lines.") from error
        if not values or not all(map(math.isfinite, values)):
            raise ValueError("Enter at least one finite number.")
        return cls(name.strip(), ("Value\n" + "".join(f"{value}\n" for value in values)).encode("utf-8"), comment=comment)

    @cached_property
    def worksheet(self) -> Worksheet:
        if self.text_import is not None:
            text = decode_table(self.content, self.text_import.encoding)
            return Worksheet(*text_table(text, self.text_import))
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

    def column_index(self, selection: int | str) -> int:
        if isinstance(selection, str):
            matches = [index for index, name in enumerate(self.columns) if name == selection]
            if len(matches) != 1:
                raise ValueError(f"Choose a unique column named {selection!r}. Edit the step to select an available column.")
            return matches[0]
        if type(selection) is not int or not 0 <= selection < len(self.columns):
            raise ValueError("Choose an available column.")
        return selection

    def column_selection(self, index: int) -> int | str:
        if type(index) is int and 0 <= index < len(self.columns):
            name = self.columns[index]
            if name.strip() and self.columns.count(name) == 1:
                return name
        return index


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
class ScaleColumn:
    column: int
    factor: float
    source_id: str | None = None

    def __post_init__(self) -> None:
        if type(self.column) is not int or self.column < 0:
            raise ValueError("Choose a valid column.")
        if type(self.factor) not in (int, float) or not math.isfinite(self.factor):
            raise ValueError("Enter a finite multiplication factor.")


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
class TraceAppearance:
    figure_id: int
    trace: int
    style: dict | None
    style_kind: Literal["line", "fill", "order"] = "line"

    def __post_init__(self) -> None:
        if any(type(index) is not int or index < 0 for index in (self.figure_id, self.trace)):
            raise ValueError("Choose a valid figure and trace.")
        if self.style_kind not in ("line", "fill", "order"):
            raise ValueError("Choose a trace style to edit.")
        if self.style is None:
            return
        if self.style_kind == "fill":
            if (not isinstance(self.style, dict) or self.style.keys() != {"color", "opacity"}
                or not isinstance(self.style["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", self.style["color"])
                or type(self.style["opacity"]) not in (int, float) or not 0 <= self.style["opacity"] <= 1):
                raise ValueError("Choose a fill color and an opacity from 0 to 100%.")
            object.__setattr__(self, "style", self.style.copy())
            return
        if self.style_kind == "order":
            if (not isinstance(self.style, dict) or self.style.keys() != {"zorder"}
                or type(self.style["zorder"]) is not int or not -10000 <= self.style["zorder"] <= 10000):
                raise ValueError("Enter a draw order from -10000 to 10000.")
            object.__setattr__(self, "style", self.style.copy())
            return
        if not isinstance(self.style, dict) or self.style.keys() != {"color", "width", "dash"}:
            raise ValueError("Choose a line color, width, and dash style.")
        color, width, dash = (self.style[key] for key in ("color", "width", "dash"))
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("Choose a valid line color.")
        if type(width) not in (int, float) or not 0.1 <= width <= 12:
            raise ValueError("Choose a line width from 0.1 to 12 px.")
        if dash not in ("solid", "dash", "dot", "dashdot", "longdash", "longdashdot"):
            raise ValueError("Choose a valid line dash style.")
        object.__setattr__(self, "style", self.style.copy())


@dataclass(frozen=True)
class ColumnReference:
    source_id: str | None
    column: int | str

    def __post_init__(self) -> None:
        if self.source_id is not None:
            source_origin(self.source_id)
        if not (type(self.column) is int and self.column >= 0) and not (
            isinstance(self.column, str) and self.column.strip()
        ):
            raise ValueError("Invalid column reference.")


def valid_plugin_option(value: object) -> bool:
    if isinstance(value, list):
        return all((type(item) is int and item >= 0) or (isinstance(item, str) and item.strip()) for item in value)
    return type(value) in (str, int, float, bool) and (not isinstance(value, float) or math.isfinite(value))


@dataclass(frozen=True)
class PluginStep:
    plugin_id: str
    version: str
    checksum: str | None
    options: dict[str, str | int | float | bool | list[int | str]]
    keep_style: bool = False
    source_id: str | None = None
    figure_id: int | None = None

    references: dict[str, ColumnReference] = field(default_factory=dict)
    comment: str | None = None
    table_only: bool = False

    def __post_init__(self) -> None:
        if type(self.table_only) is not bool or (self.table_only and self.figure_id is not None):
            raise ValueError("Invalid plugin output type.")
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
            not isinstance(key, str) or not valid_plugin_option(value) for key, value in self.options.items()
        ):
            raise ValueError("Invalid saved plugin options.")
        if not isinstance(self.references, dict):
            raise ValueError("Invalid plugin references.")
        references = {
            token: ColumnReference(**reference) if isinstance(reference, dict) else reference
            for token, reference in self.references.items()
        }
        if any(not isinstance(token, str) or not isinstance(reference, ColumnReference)
               for token, reference in references.items()):
            raise ValueError("Invalid plugin column reference.")
        object.__setattr__(self, "references", references)
        object.__setattr__(self, "options", {key: value.copy() if isinstance(value, list) else value
                                             for key, value in self.options.items()})
        object.__setattr__(self, "comment", normalize_comment(self.comment))

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
    keep_inputs: bool = False

    def __post_init__(self) -> None:
        if (
            not isinstance(self.figure_ids, (list, tuple)) or len(self.figure_ids) < 2
            or any(type(key) is not int or key < 0 for key in self.figure_ids)
            or len(set(self.figure_ids)) != len(self.figure_ids)
        ):
            raise ValueError("Choose at least two different figures to overlay.")
        if self.fit_id is not None and (type(self.fit_id) is not int or self.fit_id < 0):
            raise ValueError("Invalid fit overlay reference.")
        if type(self.keep_inputs) is not bool:
            raise ValueError("Choose whether to keep the input figures.")
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
    Correction | ScaleColumn | FigureRecipe | FigureColor | FigureStyle | FigureAppearance | TraceAppearance | ResidualFigure | ItemEdit
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
    trace_styles: dict[int, dict] = field(default_factory=dict)

    def members(self, figure_id: int) -> tuple[int, ...]:
        return (self.overlay.figure_ids if self.overlay else (figure_id,)) + self.layers

    @property
    def combined_input_count(self) -> int:
        return len(self.overlay.figure_ids) if self.overlay and self.overlay.keep_inputs else 0


@dataclass(frozen=True)
class Project:
    source: Source | None = None
    operations: tuple[Operation, ...] = ()
    saved_sources: dict[str, SourceTable] = field(default_factory=dict)
    additional_sources: tuple[Source, ...] = ()
    last_import_path: str | None = None
    notes: str = ""

    def apply(self, operation: Operation) -> Project:
        updated = replace(self, operations=(*self.operations, operation))
        updated.validate()
        return updated

    def validate(self) -> None:
        if not isinstance(self.notes, str):
            raise ValueError("Project notes must be text.")
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
            if isinstance(operation, ScaleColumn):
                source = self.raw_sources.get(operation.source_id)
                if source is None or operation.column >= len(source.worksheet.columns):
                    raise ValueError("Choose an available raw data column.")
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
            key for op in self.operations
            if isinstance(op, AddFigureLayers) or (isinstance(op, OverlayFigure) and not op.keep_inputs)
            for key in op.figure_ids
        }
        return {
            key: figure for key, figure in self.figures.items()
            if key not in members and not self.item_deleted("figure", key)
            and not (isinstance(figure.recipe, PluginStep)
                     and (figure.recipe.table_only or figure.recipe.plugin_id in TABLE_ONLY_PLUGINS))
        }

    @cached_property
    def figures(self) -> dict[int, FigureRecord]:
        figures = {}
        current = None
        legacy_colors = DEFAULT_COLORS.copy()
        for index, op in enumerate(self.operations):
            if isinstance(op, (LinearFit, Plot, PluginStep)):
                if isinstance(op, PluginStep) and any(
                    reference.source_id not in self.raw_sources and (
                        reference.source_id is None or source_origin(reference.source_id) not in figures
                    ) for reference in op.references.values()
                ):
                    raise ValueError("A plugin refers to a missing input source.")
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
                    isinstance(fit.recipe, PluginStep) and fit.recipe.checksum is None and fit.recipe.plugin_id in FIT_PLUGINS
                ):
                    raise ValueError("A residual figure needs a fit.")
                figures[op.fit_id] = replace(fit, part="fit")
                figures[index] = FigureRecord(
                    fit.recipe, FigureStyle(y=AxisStyle(zero_line=True)),
                    legacy_colors.copy(), part="residual", fit_id=op.fit_id,
                )
            elif isinstance(op, OverlayFigure):
                if any(key not in figures or (figures[key].overlay and not op.keep_inputs) for key in op.figure_ids):
                    raise ValueError("An overlay refers to a missing or combined figure.")
                current = index
                first = figures[op.figure_ids[0]]
                if op.fit_id is not None and (
                    op.fit_id not in figures or not figures[op.fit_id].overlay
                    or figures[op.fit_id].part != "fit" or first.part != "residual"
                ):
                    raise ValueError("A residual overlay needs a fit overlay.")
                figures[index] = replace(first, fit_id=op.fit_id, overlay=op)
                if op.keep_inputs:
                    figures[index] = replace(figures[index], layers=(), trace_styles={})
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
            elif isinstance(op, TraceAppearance):
                record = figures.get(op.figure_id)
                if record is None:
                    raise ValueError("A trace style refers to a missing figure.")
                styles = record.trace_styles.copy()
                style = styles.get(op.trace, {}).copy()
                if op.style_kind == "line":
                    for key in ("color", "width", "dash"):
                        style.pop(key, None)
                    style.update(op.style or {})
                elif op.style is None:
                    style.pop("fill" if op.style_kind == "fill" else "zorder", None)
                else:
                    style.update({"fill": op.style} if op.style_kind == "fill" else op.style)
                if style:
                    styles[op.trace] = style
                else:
                    styles.pop(op.trace, None)
                figures[op.figure_id] = replace(record, trace_styles=styles)
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
        return {key: self.build_worksheet(key, len(self.operations)) for key in self.raw_sources}

    @cached_property
    def recipe_positions(self) -> dict[int, int]:
        return {id(op): index for index, op in enumerate(self.operations) if isinstance(op, (PluginStep, LinearFit, Plot))}

    @cached_property
    def scaled_worksheets(self) -> dict[tuple[str | None, int], Worksheet]:
        return {}

    def worksheet_for_recipe(self, source_id: str | None, recipe: FigureRecipe) -> Worksheet:
        end = self.recipe_positions.get(id(recipe), len(self.operations))
        if not any(isinstance(op, ScaleColumn) and op.source_id == source_id for op in self.operations[end:]):
            return self.working_worksheets[source_id]
        key = (source_id, end)
        if key not in self.scaled_worksheets:
            self.scaled_worksheets[key] = self.build_worksheet(source_id, end)
        return self.scaled_worksheets[key]

    def recipe_input(self, source_id: str | None, recipe: FigureRecipe, tables: dict[str, SourceTable]) -> Worksheet:
        if source_id in self.raw_sources:
            return self.worksheet_for_recipe(source_id, recipe)
        if source_id not in tables:
            raise ValueError("The input source is unavailable.")
        table = tables[source_id]
        return Worksheet(table.columns, table.rows)

    def recipe_references(self, step: PluginStep, tables: dict[str, SourceTable]) -> dict:
        return {
            token: (worksheet, worksheet.column_index(reference.column))
            for token, reference in step.references.items()
            for worksheet in (self.recipe_input(reference.source_id, step, tables),)
        }

    def scalar_from_formula(self, name: str, formula: dict, tables: dict[str, SourceTable], comment: str | None = None) -> Source:
        position = formula["position"]
        project = self if position == len(self.operations) else replace(self, operations=self.operations[:position])
        inputs = {}
        for token, reference in formula["references"].items():
            source_id = reference["source_id"]
            if source_id in project.raw_sources:
                worksheet = project.build_worksheet(source_id, position)
            elif source_id in tables:
                table = tables[source_id]
                worksheet = Worksheet(table.columns, table.rows)
            else:
                raise ValueError(f"The input source for {token} is unavailable.")
            inputs[token] = worksheet, worksheet.column_index(reference["column"])
        value = run_scalar_formula(formula["expression"], inputs)
        return Source.scalar(name, value, comment, formula=formula)

    @staticmethod
    def joint_inputs(references: dict) -> dict:
        return {
            key: {"columns": worksheet.columns, "rows": worksheet.rows, "column": column}
            for key, (worksheet, column) in references.items()
        }

    def plugin_input(self, step: PluginStep, tables: dict[str, SourceTable]) -> Worksheet:
        if step.plugin_id not in PAIRED_PLOT_PLUGINS or not step.references:
            return self.recipe_input(step.source_id, step, tables)
        if step.checksum is not None or step.references.keys() != {"x", "y"}:
            raise ValueError("Choose one column for X and one for Y.")
        x, y = (step.references[axis] for axis in ("x", "y"))
        x_table, y_table = (self.recipe_input(ref.source_id, step, tables) for ref in (x, y))
        x_column, y_column = x_table.column_index(x.column), y_table.column_index(y.column)
        if len(x_table.rows) != len(y_table.rows):
            raise ValueError(f"X and Y sources must have the same number of rows ({len(x_table.rows)} and {len(y_table.rows)}).")

        def label(table: Worksheet, ref: ColumnReference, column: int) -> str:
            if len(table.columns) == 1:
                source = self.raw_sources.get(ref.source_id) or tables[ref.source_id]
                return self.item_names.get(("source", ref.source_id), source.name)
            return table.columns[column]

        return Worksheet((label(x_table, x, x_column), label(y_table, y, y_column)), tuple(
            (x_row[x_column], y_row[y_column]) for x_row, y_row in zip(x_table.rows, y_table.rows)
        ))

    def build_worksheet(self, source_id: str | None, scale_until: int) -> Worksheet:
        result = self.raw_sources[source_id].worksheet
        corrections = {}
        for index, operation in enumerate(self.operations):
            if isinstance(operation, Correction) and operation.source_id == source_id:
                corrections[operation.row, operation.column] = operation.value
            if isinstance(operation, ScaleColumn) and operation.source_id == source_id and index < scale_until:
                result = self.corrected_worksheet(result, corrections)
                corrections = {}
                column = operation.column
                rows = []
                for row_number, row in enumerate(result.rows, start=1):
                    if not row[column].strip():
                        rows.append(row)
                        continue
                    try:
                        value = float(row[column]) * operation.factor
                        if not math.isfinite(value):
                            raise ValueError
                    except ValueError as error:
                        raise ValueError(f"Multiplication needs a finite number in row {row_number}.") from error
                    rows.append((*row[:column], repr(value), *row[column + 1:]))
                result = Worksheet(result.columns, tuple(rows))
        return self.corrected_worksheet(result, corrections)

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
