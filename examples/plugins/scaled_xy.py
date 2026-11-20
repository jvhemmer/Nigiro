"""Example Nigiro plugin that scales the Y values of an XY plot."""

import math
from html import escape


PLUGIN = {
    "api": 1,
    "id": "example.scaled_xy",
    "version": "1",
    "name": "Scaled XY",
    "menu": "plot",
    "distinct_columns": True,
    "fields": [
        {"key": "x", "label": "X column", "type": "column", "default": 0},
        {"key": "y", "label": "Y column", "type": "column", "default": 1},
        {"key": "factor", "label": "Y multiplier", "type": "number", "default": 2},
        {"key": "label", "label": "Y axis label", "type": "text", "default": "Scaled signal"},
        {"key": "markers", "label": "Show markers", "type": "boolean", "default": True},
        {
            "key": "dash", "label": "Line style", "type": "choice", "default": "solid",
            "choices": [{"value": "solid", "label": "Solid"}, {"value": "dot", "label": "Dotted"}],
        },
    ],
}


def run(columns, rows, options):
    x = []
    y = []
    for index, row in enumerate(rows, start=1):
        left, right = row[options["x"]], row[options["y"]]
        if not left.strip() or not right.strip():
            continue
        pair = float(left), float(right) * options["factor"]
        if not all(math.isfinite(value) for value in pair):
            raise ValueError(f"Enter finite values in row {index}.")
        x.append(pair[0])
        y.append(pair[1])
    if not x:
        raise ValueError("Choose columns with at least one complete pair.")
    return {
        "traces": [{
            "type": "scatter", "mode": "lines+markers" if options["markers"] else "lines",
            "name": escape(options["label"], quote=False),
            "x": x, "y": y, "line": {"dash": options["dash"]},
        }],
        "x_label": columns[options["x"]],
        "y_label": options["label"],
        "summary": {"Points": len(x), "Multiplier": options["factor"]},
    }
