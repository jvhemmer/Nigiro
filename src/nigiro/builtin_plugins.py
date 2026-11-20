"""Bundled plugins for worksheet plots and linear fitting."""

from __future__ import annotations

from html import escape

from .analysis import run_linear_fit, run_plot
from .project import LinearFit, Plot, Worksheet


def plot_text(value: str) -> str:
    return escape(value, quote=False).replace("\n", "<br>")


def xy_figure(columns, rows, options, kind):
    x, y = options["x"], options["y"]
    result = run_plot(Worksheet(columns, rows), Plot(kind, x, y))
    bar = kind == "bar"
    trace = {"name": plot_text(columns[y]), "x": result.x, "y": result.y}
    layout = {}
    if bar:
        labels = [plot_text(value) for value in result.x]
        positions = list(range(len(labels)))
        trace.update(type="bar", x=positions, text=labels, hoverinfo="y+text")
        layout["xaxis"] = {"tickmode": "array", "tickvals": positions, "ticktext": labels}
    else:
        trace.update(type="scatter", mode="lines+markers" if kind == "line" else "markers")
    return {
        "traces": [trace], "layout": layout, "elements": ["observations"],
        "x_label": columns[x], "y_label": columns[y], "categorical_x": bar,
        "summary": {"Observations": len(result.y), "Omitted": result.omitted_rows},
        "legacy": {"x_values": result.x, "y_values": result.y, "omitted_rows": result.omitted_rows},
    }


def scatter_plot(columns, rows, options):
    return xy_figure(columns, rows, options, "scatter")


def line_plot(columns, rows, options):
    return xy_figure(columns, rows, options, "line")


def bar_plot(columns, rows, options):
    return xy_figure(columns, rows, options, "bar")


def linear_fit_figure(columns, rows, options):
    x_index, y_index = options["x"], options["y"]
    result = run_linear_fit(Worksheet(columns, rows), LinearFit(x_index, y_index))
    x, y, fitted, residuals = (values.tolist() for values in (result.x, result.y, result.fitted, result.residuals))
    first, last = x.index(min(x)), x.index(max(x))
    fractions = [index / 200 for index in range(201)]

    def interpolate(values):
        return [(1 - t) * values[first] + t * values[last] for t in fractions]

    return {
        "traces": [
            {"type": "scatter", "mode": "markers", "name": "Observations", "x": x, "y": y},
            {"type": "scatter", "mode": "lines", "name": "Linear fit",
             "x": interpolate(x), "y": interpolate(fitted), "hoverinfo": "none"},
            {"type": "scatter", "mode": "markers", "name": "Residuals",
             "x": x, "y": residuals, "xaxis": "x2", "yaxis": "y2", "showlegend": False},
        ],
        "elements": ["observations", "fit", "observations"],
        "x_label": columns[x_index], "y_label": columns[y_index], "residual_panel": True,
        "summary": {
            "Slope": result.slope, "Intercept": result.intercept, "R²": result.r_squared,
            "Observations": len(x), "Omitted": result.omitted_rows,
        },
        "sources": {
            "coefficients": {
                "name": "Coefficients",
                "columns": ["Slope", "Intercept", "R²", "Observations", "Omitted"],
                "rows": [[result.slope, result.intercept, result.r_squared, len(x), result.omitted_rows]],
            },
            "fitted": {
                "name": "Fitted values",
                "columns": [columns[x_index], "Observed", "Fitted", "Residual"],
                "rows": list(zip(x, y, fitted, residuals)),
            },
        },
        "legacy": {
            "x": x, "y": y, "fitted": fitted, "residuals": residuals,
            "slope": result.slope, "intercept": result.intercept, "r_squared": result.r_squared,
            "omitted_rows": result.omitted_rows,
        },
    }


BUILTINS = {
    f"nigiro.{name}": ({
        "api": 1, "id": f"nigiro.{name}", "version": "1", "name": label, "menu": menu,
        "distinct_columns": True,
        "fields": [
            {"key": "x", "label": "X column", "type": "column", "default": 0},
            {"key": "y", "label": "Y column", "type": "column", "default": 1},
        ],
    }, runner)
    for name, label, menu, runner in (
        ("scatter", "Scatter", "plot", scatter_plot),
        ("line", "Line", "plot", line_plot),
        ("bar", "Bar", "plot", bar_plot),
        ("linear_fit", "Linear Fit", "analysis", linear_fit_figure),
    )
}
