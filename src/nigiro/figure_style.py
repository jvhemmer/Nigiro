"""Saved appearance settings for a figure."""

from __future__ import annotations

import math
import re
from dataclasses import InitVar, dataclass, field


def _finite(value: object) -> bool:
    return type(value) in (int, float) and -math.inf < value < math.inf


LENGTH_UNITS = {"px": 1, "pt": 96 / 72, "pc": 16, "in": 96, "cm": 96 / 2.54, "mm": 96 / 25.4, "q": 96 / 101.6}
ANGLE_UNITS = {"deg": 1, "°": 1, "rad": 180 / math.pi, "turn": 360}


def normalize_units(style, lengths, angles=()):
    units = style.units
    if not isinstance(units, dict):
        raise ValueError("Invalid measurement units.")
    units = units.copy()
    for key in lengths + angles:
        factors = ANGLE_UNITS if key in angles else LENGTH_UNITS
        default = "deg" if key in angles else "px"
        value = getattr(style, key)
        if isinstance(value, str):
            match = re.fullmatch(r"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z°]*)\s*", value)
            if not match or (match[2].lower() or default) not in factors:
                raise ValueError("Enter a number with a supported unit.")
            unit = match[2].lower() or default
            object.__setattr__(style, key, float(match[1]) * factors[unit])
            units[key] = unit
        if key in units and units[key] not in factors:
            raise ValueError("Unsupported measurement unit.")
    if any(key not in lengths + angles for key in units):
        raise ValueError("Invalid measurement field.")
    object.__setattr__(style, "units", units)


@dataclass(frozen=True)
class AxisStyle:
    label: str | None = None
    label_renderer: str = "auto"
    scale: str = "linear"
    lower: float | None = None
    upper: float | None = None
    step: float | None = None
    format: str = ""
    notation: str = "plain"
    angle: float = 0
    ticks: str = "outside"
    tick_length: float = 4
    tick_labels: bool = True
    minor_ticks: bool = False
    line: bool = True
    line_width: float = 1
    mirror: bool = False
    opposite_ticks: bool | None = None
    grid: bool = False
    zero_line: bool = False
    hover_ruler: bool = False

    units: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.label_renderer not in ("auto", "plain", "latex"):
            raise ValueError("Choose a text renderer for the axis label.")
        normalize_units(self, ("tick_length", "line_width"), ("angle",))
        if self.label is not None and not isinstance(self.label, str):
            raise ValueError("Enter text for the axis label.")
        if self.scale not in ("linear", "log"):
            raise ValueError("Select a linear or logarithmic scale.")
        for limit in (self.lower, self.upper):
            if limit is not None and (not _finite(limit) or (self.scale == "log" and limit <= 0)):
                raise ValueError("Enter finite limits. Logarithmic limits must be positive.")
        if self.lower is not None and self.upper is not None and self.lower >= self.upper:
            raise ValueError("Enter an upper limit greater than the lower limit.")
        if self.step is not None and (not _finite(self.step) or self.step <= 0):
            raise ValueError("Enter a positive tick interval.")
        if self.notation not in ("plain", "si", "scientific"):
            raise ValueError("Choose a number notation.")
        if self.ticks not in ("outside", "inside", "none") or not isinstance(self.format, str):
            raise ValueError("Invalid tick settings.")
        for value, minimum, maximum in ((self.angle, -180, 180), (self.tick_length, 0, 30), (self.line_width, 0.1, 12)):
            if not _finite(value) or not minimum <= value <= maximum:
                raise ValueError("Check the tick angle, tick length, and axis line width.")
        toggles = (self.tick_labels, self.minor_ticks, self.line, self.mirror, self.grid, self.zero_line, self.hover_ruler)
        if any(type(value) is not bool for value in toggles) or (
            self.opposite_ticks is not None and type(self.opposite_ticks) is not bool
        ):
            raise ValueError("Invalid axis display settings.")


@dataclass(frozen=True)
class FigureStyle:
    title: str = ""
    title_renderer: str = "auto"
    axes_width: float | None = None
    axes_height: float | None = None
    font_family: str = "DejaVu Sans"
    font_bold: bool = False
    font_italic: bool = False
    font_face: str | None = None
    math_alphabet: str = "default"
    math_preamble: str = ""
    label_size: float = 13
    tick_size: float = 11
    title_family: str | None = None
    title_bold: bool | None = None
    title_italic: bool | None = None
    title_face: str | None = None
    title_size: float | None = None
    x_label_family: str | None = None
    x_label_bold: bool | None = None
    x_label_italic: bool | None = None
    x_label_face: str | None = None
    x_label_size: float | None = None
    y_label_family: str | None = None
    y_label_bold: bool | None = None
    y_label_italic: bool | None = None
    y_label_face: str | None = None
    y_label_size: float | None = None
    x_tick_family: str | None = None
    x_tick_bold: bool | None = None
    x_tick_italic: bool | None = None
    x_tick_face: str | None = None
    x_tick_size: float | None = None
    y_tick_family: str | None = None
    y_tick_bold: bool | None = None
    y_tick_italic: bool | None = None
    y_tick_face: str | None = None
    y_tick_size: float | None = None
    legend_family: str | None = None
    legend_bold: bool | None = None
    legend_italic: bool | None = None
    legend_face: str | None = None
    legend_size: float | None = None
    text_color: str = "#181818"
    background: str = "#ffffff"
    legend: str = "auto"
    legend_frame: bool = False
    legend_border_color: str = "#444444"
    legend_border_width: float = 1
    legend_background: str | None = None
    marker_color: str | None = None
    line_color: str | None = None
    line_width: float = 1.5
    line_dash: str = "solid"
    marker_size: float = 5
    show_markers: bool = True
    show_lines: bool = True
    marker_symbol: str = "circle"
    bar_width: float = 0.8
    axes_separate: bool | None = None
    global_axis: AxisStyle | None = None
    x: AxisStyle = AxisStyle()
    y: AxisStyle = AxisStyle()
    residual: InitVar[AxisStyle | dict | None] = None

    units: dict[str, str] = field(default_factory=dict)

    def __post_init__(self, residual=None) -> None:
        if self.title_renderer not in ("auto", "plain", "latex"):
            raise ValueError("Choose a text renderer for the title.")
        if self.math_alphabet not in ("default", "roman", "sans", "mono"):
            raise ValueError("Choose a MathJax alphabet.")
        if not isinstance(self.math_preamble, str):
            raise ValueError("Enter the MathJax preamble as text.")
        roles = ("title", "x_label", "y_label", "x_tick", "y_tick", "legend")
        faces = (self.font_face, *(getattr(self, f"{role}_face") for role in roles))
        if any(face is not None and (not isinstance(face, str) or not re.fullmatch(
            r"(?:[1-9]\d{0,2}|1000):(normal|italic|oblique)", face,
        )) for face in faces):
            raise ValueError("Choose a valid font style.")
        sizes = tuple(f"{role}_size" for role in roles)
        normalize_units(self, ("axes_width", "axes_height", "label_size", "tick_size", "line_width", "marker_size", "legend_border_width", *sizes))
        for role in roles:
            family = getattr(self, f"{role}_family")
            size = getattr(self, f"{role}_size")
            if family is not None and (not isinstance(family, str) or not re.fullmatch(r"[\w .'-]+", family)):
                raise ValueError("Enter a valid font family.")
            if size is not None and (not _finite(size) or not 6 <= size <= 48):
                raise ValueError("Enter a font size from 6 to 48 px.")
            if any(value is not None and type(value) is not bool
                   for value in (getattr(self, f"{role}_bold"), getattr(self, f"{role}_italic"))):
                raise ValueError("Choose a valid font style.")
        for size in (self.axes_width, self.axes_height):
            if size is not None and (not _finite(size) or not 1 <= size <= 8000):
                raise ValueError("Enter axes dimensions from 1 to 8000 px.")
        if not isinstance(self.title, str) or not (
            isinstance(self.font_family, str) and self.font_family.strip()
            and re.fullmatch(r"[\w .'-]+", self.font_family)
        ):
            raise ValueError("Enter one font family name and a text title.")
        if type(self.font_bold) is not bool or type(self.font_italic) is not bool:
            raise ValueError("Choose a valid font style.")
        optional_colors = (self.legend_background, self.marker_color, self.line_color)
        for color in (self.text_color, self.background, self.legend_border_color,
                      *(color for color in optional_colors if color is not None)):
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError("Choose a valid figure color.")
        if self.legend not in ("auto", "none", "above", "top_left", "top_right", "bottom_left", "bottom_right"):
            raise ValueError("Choose a legend position.")
        if type(self.legend_frame) is not bool or not _finite(self.legend_border_width) or not 0 <= self.legend_border_width <= 12:
            raise ValueError("Check the legend frame width.")
        if self.line_dash not in ("solid", "dash", "dot", "dashdot"):
            raise ValueError("Choose a line style.")
        if type(self.show_markers) is not bool or type(self.show_lines) is not bool:
            raise ValueError("Choose whether to show markers and lines.")
        if self.marker_symbol not in ("circle", "square", "diamond", "triangle-up", "cross"):
            raise ValueError("Choose a marker shape.")
        for value, minimum, maximum in (
            (self.label_size, 6, 48), (self.tick_size, 6, 48), (self.line_width, 0.1, 12),
            (self.marker_size, 1, 30), (self.bar_width, 0.05, 1),
        ):
            if not _finite(value) or not minimum <= value <= maximum:
                raise ValueError("Check the font sizes, line width, marker size, and bar width.")
        if self.axes_separate is not None and type(self.axes_separate) is not bool:
            raise ValueError("Choose whether to configure axes separately.")
        for name in ("x", "y", "global_axis"):
            axis = getattr(self, name)
            if isinstance(axis, dict):
                object.__setattr__(self, name, AxisStyle(**axis))
            elif not isinstance(axis, AxisStyle) and (name != "global_axis" or axis is not None):
                raise ValueError("Invalid axis settings.")
