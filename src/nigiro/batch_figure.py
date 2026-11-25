"""Combine plugin figures that use matching axes."""

from copy import deepcopy
from html import escape


BATCH_COLORS = ("#245e9b", "#be481f", "#297d65", "#7655a6", "#a37513", "#a33f72", "#367985", "#6d644f")


def single_xy_figure(figure):
    return bool(figure and figure["traces"]) and not figure.get("residual_panel") and all(
        trace.get("type") in (None, "scatter", "scattergl", "bar")
        and trace.get("xaxis") in (None, "x") and trace.get("yaxis") in (None, "y")
        for trace in figure["traces"]
    ) and not any(
        key.startswith(("xaxis", "yaxis")) and key not in ("xaxis", "yaxis")
        for key in figure.get("layout", {})
    )


def overlay_figures(figures, labels, preserve_first=False, *, single_axes=False):
    if single_axes and not all(single_xy_figure(figure) for figure in figures):
        raise ValueError("Choose figures with one X axis and one Y axis.")
    first = figures[0]
    layout = deepcopy(first.get("layout", {}))
    combined = {**first, "layout": layout, "traces": [], "elements": [], "series_colors": [],
                "series_cycle": [], "summary": first.get("summary", {}) if preserve_first else {}}
    axes = first.get("layout", {}).get("xaxis", {})
    bar_ticks = first.get("categorical_x") and axes.get("tickmode") == "array"
    categories = {}
    names = set()
    next_cycle = 0
    axis_keys = ("xaxis", "yaxis") if single_axes else {key for key in layout if key.startswith(("xaxis", "yaxis"))}
    for index, (figure, label) in enumerate(zip(figures, labels, strict=True)):
        if bool(figure.get("categorical_x")) != bool(first.get("categorical_x")):
            raise ValueError("The figures use different types of X axes. Choose separate figures.")
        next_layout = figure.get("layout", {})
        if (not single_axes and axis_keys != {key for key in next_layout if key.startswith(("xaxis", "yaxis"))}) or any(
            layout.get(key, {}).get("type") != next_layout.get(key, {}).get("type") for key in axis_keys
        ):
            raise ValueError("The figures use different axes. Choose separate figures.")

        positions = {}
        if bar_ticks:
            counts = {}
            ticks = next_layout.get("xaxis", {})
            for position, name in zip(ticks.get("tickvals", ()), ticks.get("ticktext", ()), strict=True):
                occurrence = counts.get(name, 0)
                counts[name] = occurrence + 1
                positions[position] = categories.setdefault((name, occurrence), len(categories))

        traces = deepcopy(figure["traces"])
        roles = figure.get("elements") or [None] * len(traces)
        safe_label = escape(label, quote=False)
        for trace in traces:
            if bar_ticks and trace.get("type") == "bar":
                trace["x"] = [positions[position] for position in trace["x"]]
            if index != 0 or not preserve_first:
                name = trace.get("name")
                label = f"{safe_label} · {name}" if name and (len(traces) > 1 or safe_label in names) else safe_label
                unique = label
                ordinal = 2
                while unique in names:
                    unique = f"{label} ({ordinal})"
                    ordinal += 1
                trace["name"] = unique
                trace["legendgroup"] = f"source-{index}"
            names.add(trace.get("name"))
        combined["traces"].extend(traces)
        combined["elements"].extend(roles)
        if single_axes:
            input_cycles = figure.get("series_cycle") or [0] * len(traces)
            cycles = {value: next_cycle + i for i, value in enumerate(dict.fromkeys(input_cycles))}
            combined["series_cycle"].extend(cycles[value] for value in input_cycles)
            combined["series_colors"].extend(BATCH_COLORS[cycles[value] % len(BATCH_COLORS)] for value in input_cycles)
            next_cycle += len(cycles)
        else:
            color = None if index == 0 and preserve_first else BATCH_COLORS[index % len(BATCH_COLORS)]
            combined["series_colors"].extend([color] * len(traces))
            combined["series_cycle"].extend([index] * len(traces))
    if bar_ticks:
        layout["xaxis"].update(tickvals=list(categories.values()), ticktext=[name for name, _ in categories])
        layout.setdefault("barmode", "group")
    return combined
