"""Combine plugin figures that use matching axes."""

from copy import deepcopy
from html import escape


BATCH_COLORS = ("#245e9b", "#be481f", "#297d65", "#7655a6", "#a37513", "#a33f72", "#367985", "#6d644f")


def overlay_figures(figures, labels, preserve_first=False):
    first = figures[0]
    combined = deepcopy(first)
    combined.update(traces=[], elements=[], series_colors=[], summary=first.get("summary", {}) if preserve_first else {})
    layout = combined.setdefault("layout", {})
    axes = first.get("layout", {}).get("xaxis", {})
    bar_ticks = first.get("categorical_x") and axes.get("tickmode") == "array"
    categories = {}
    names = set()
    for index, (figure, label) in enumerate(zip(figures, labels, strict=True)):
        if bool(figure.get("categorical_x")) != bool(first.get("categorical_x")):
            raise ValueError("The figures use different types of X axes. Choose separate figures.")
        axis_keys = {key for key in layout if key.startswith(("xaxis", "yaxis"))}
        next_layout = figure.get("layout", {})
        if axis_keys != {key for key in next_layout if key.startswith(("xaxis", "yaxis"))} or any(
            layout[key].get("type") != next_layout[key].get("type") for key in axis_keys
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
        color = None if index == 0 and preserve_first else BATCH_COLORS[index % len(BATCH_COLORS)]
        combined["series_colors"].extend([color] * len(traces))
    if bar_ticks:
        layout["xaxis"].update(tickvals=list(categories.values()), ticktext=[name for name, _ in categories])
        layout.setdefault("barmode", "group")
    return combined
