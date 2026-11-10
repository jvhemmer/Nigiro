"""Build both the desktop preview and vector export from project state."""

from __future__ import annotations

import numpy as np
from matplotlib.artist import Artist
from matplotlib.figure import Figure

from .analysis import FitResult


def draw_fit(
    figure: Figure,
    result: FitResult | None,
    x_label: str,
    y_label: str,
    colors: dict[str, str],
) -> dict[Artist, str]:
    figure.clear()
    if result is None:
        figure.text(0.5, 0.5, "Choose X and Y, then run a linear fit.", ha="center")
        return {}

    main, residual = figure.subplots(2, 1, sharex=True, height_ratios=(3, 1))
    observations = main.scatter(
        result.x, result.y, color=colors["observations"], label="Observations", picker=6
    )
    order = np.argsort(result.x)
    line, = main.plot(
        result.x[order], result.fitted[order], color=colors["fit"],
        linewidth=2, label="Linear fit", picker=6,
    )
    main.set_ylabel(y_label, parse_math=False)
    main.legend()

    residual.axhline(0, color="#777777", linewidth=0.8)
    residual_points = residual.scatter(
        result.x, result.residuals, color=colors["observations"], picker=6
    )
    residual.set_xlabel(x_label, parse_math=False)
    residual.set_ylabel("Residual")
    return {observations: "observations", residual_points: "observations", line: "fit"}
