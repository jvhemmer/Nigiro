"""Bundled plugins for worksheet plots and linear fitting."""

from __future__ import annotations

import ast
from html import escape

from .analysis_catalog import ANALYSIS_PLUGINS
from .analysis import run_linear_fit, run_plot
from .column_formula import ARRAY_FORMULA_PLUGIN, COLUMN_FORMULA_PLUGIN, run_array_formula, run_column_formula
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
        trace.update(type="scatter", mode="lines" if kind == "line" else "markers")
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
    result = run_linear_fit(Worksheet(columns, rows), LinearFit(x_index, y_index), force_zero=options.get("force_zero", False))
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


def linear_fit_view(result, part):
    if part is None:
        return result
    view = {**result, "residual_panel": False}
    if part == "fit":
        return {**view, "traces": result["traces"][:2], "elements": result["elements"][:2]}

    residual = {**result["traces"][2]}
    for key in ("xaxis", "yaxis", "showlegend"):
        del residual[key]
    return {**view, "traces": [residual], "elements": ["observations"], "y_label": "Residual", "summary": {}}


PLOT_HELP = {
    "scatter": "Plot numeric X and Y values as individual markers. Use it to compare two quantities or inspect the spread of measurements.",
    "line": "Connect numeric X and Y points in source row order. Use this plot for traces such as time series or sweeps.",
    "bar": "Plot a numeric Y value for each X category. Use the X column for category labels and the Y column for bar heights.",
    "linear_fit": """Fit the model $y = mx + b$ by least squares. Select **Force fit through zero** to fix $b = 0$.

The fit figure shows the data and fitted line. Use the separate residuals figure and results tables to inspect the fit.""",
}


BUILTINS = {
    f"nigiro.{name}": ({
        "api": 1, "id": f"nigiro.{name}", "version": "1", "name": label, "menu": menu,
        "description": PLOT_HELP[name],
        "distinct_columns": True,
        "outputs": ["Fit figure", "Residuals figure", "Coefficients table", "Fitted values table"]
        if name == "linear_fit" else [f"{label} figure"],
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


def filter_rows(columns, rows, options):
    expression = options["expression"]
    if len(expression) > 300:
        raise ValueError("Use an expression of 300 characters or fewer.")
    tree = ast.parse(expression.strip(), mode="eval")
    allowed = (
        ast.Expression, ast.Compare, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not,
        ast.USub, ast.UAdd, ast.Name, ast.Load, ast.Constant,
        ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq,
    )
    if any(not isinstance(node, allowed) or isinstance(node, ast.Name) and node.id != "value"
           or isinstance(node, ast.Constant) and type(node.value) not in (str, int, float, bool)
           for node in ast.walk(tree)):
        raise ValueError("Use value, comparisons, and, or, or not in the expression.")
    predicate = compile(tree, "<filter>", "eval")
    column = options["column"]
    values_only = options["output"] == "values"
    matches = []
    for index, row in enumerate(rows, start=1):
        value = row[column]
        try:
            value = float(value)
        except ValueError:
            pass
        try:
            keep = eval(predicate, {"__builtins__": {}}, {"value": value})
        except TypeError as error:
            raise ValueError(f"Cannot compare the value in row {index}.") from error
        if type(keep) is not bool:
            raise ValueError("The expression must return true or false.")
        if keep:
            matches.append([row[column]] if values_only else list(row))
    return {"traces": [], "sources": {"filtered": {
        "name": "Filtered values" if values_only else "Filtered rows",
        "columns": [columns[column]] if values_only else list(columns),
        "rows": matches,
    }}}


BUILTINS["nigiro.filter"] = ({
    "api": 1, "id": "nigiro.filter", "version": "1", "name": "Filter", "menu": "analysis",
    "outputs": ["Filtered source"],
    "description": """Keep values or rows that match a condition. Select a column and use its current value in an
expression such as `value > 0 and value <= 10`. Choose whether the result includes all columns or only the selected column.""",
    "fields": [
        {"key": "column", "label": "Column", "type": "column", "default": 0},
        {"key": "expression", "label": "Expression", "type": "text", "default": "value > 0"},
        {"key": "output", "label": "Keep", "type": "choice", "default": "rows", "choices": [
            {"value": "rows", "label": "Matching rows"}, {"value": "values", "label": "Matching values"},
        ]},
    ],
}, filter_rows)


BUILTINS[COLUMN_FORMULA_PLUGIN] = ({
    "api": 1, "id": COLUMN_FORMULA_PLUGIN, "version": "1", "name": "Column Formula", "menu": "analysis",
    "outputs": ["Calculated worksheet"],
    "description": """Calculate replacement values for a column in a new worksheet. Use `value` for the current
value or a reference such as `$Source:Column` for data from another column. The original worksheet stays intact.""",
    "fields": [
        {"key": "column", "label": "Column to calculate", "type": "column", "default": 0},
        {"key": "expression", "label": "Formula", "type": "text", "default": "value"},
    ],
}, run_column_formula)


BUILTINS[ARRAY_FORMULA_PLUGIN] = ({
    "api": 1, "id": ARRAY_FORMULA_PLUGIN, "version": "1", "name": "Add Array", "menu": "analysis",
    "outputs": ["Calculated array"],
    "description": """Create an array from confirmed source references. Use a formula such as `=$Source:Column * 2`.
References can point to other arrays, table columns, or scalar values.""",
    "fields": [
        {"key": "name", "label": "Name", "type": "text", "default": "Array"},
        {"key": "expression", "label": "Formula", "type": "text", "default": "$Source:Column"},
    ],
}, run_array_formula)

BUILTINS["nigiro.linear_fit"][0]["fields"].append({
    "key": "force_zero", "label": "Force fit through zero", "type": "boolean", "default": False, "optional": True,
})
BUILTINS.update(ANALYSIS_PLUGINS)
