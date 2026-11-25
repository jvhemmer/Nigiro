"""Numerical execution for saved plot and fit recipes."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import stats

from .project import LinearFit, Plot, Worksheet, numeric_value


@dataclass(frozen=True)
class FitResult:
    x: np.ndarray
    y: np.ndarray
    fitted: np.ndarray
    residuals: np.ndarray
    slope: float
    intercept: float
    r_squared: float | None
    omitted_rows: int


@dataclass(frozen=True)
class PlotResult:
    x: list[float | str]
    y: list[float]
    omitted_rows: int


def xy_pairs(
    worksheet: Worksheet, x_column: int, y_column: int, *, categorical: bool = False
) -> list[tuple[float | str, float]]:
    if x_column == y_column:
        raise ValueError("Choose different X and Y columns.")
    pairs = []
    for index, row in enumerate(worksheet.rows, start=1):
        try:
            label = row[x_column]
            x = (label if label.strip() else None) if categorical else numeric_value(label)
            y = numeric_value(row[y_column])
        except ValueError as exc:
            raise ValueError(f"Worksheet row {index} has an invalid X or Y value.") from exc
        if x is not None and y is not None:
            pairs.append((x, y))
    return pairs


def run_plot(worksheet: Worksheet, recipe: Plot) -> PlotResult:
    pairs = xy_pairs(worksheet, recipe.x, recipe.y, categorical=recipe.plot_type == "bar")
    if not pairs:
        raise ValueError("Plotting needs at least one complete X/Y pair.")
    return PlotResult(
        x=[x for x, _ in pairs],
        y=[y for _, y in pairs],
        omitted_rows=len(worksheet.rows) - len(pairs),
    )


def run_linear_fit(worksheet: Worksheet, recipe: LinearFit, *, force_zero: bool = False) -> FitResult:
    pairs = xy_pairs(worksheet, recipe.x, recipe.y)
    if len(pairs) < 2:
        raise ValueError("Linear fitting needs at least two complete X/Y pairs.")

    x, y = np.asarray(pairs).T
    constant_y = bool(np.all(y == y[0]))
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        if force_zero:
            scale = np.max(np.abs(x))
            if scale == 0:
                raise ValueError("Fitting through zero requires at least one nonzero X value.")
            scaled = x / scale
            slope = (np.dot(scaled, y) / np.dot(scaled, scaled)) / scale
            intercept = 0.0
            fitted = slope * x
            residuals = y - fitted
            r_squared = None if constant_y else float(1 - np.sum(residuals**2) / np.sum((y - np.mean(y))**2))
        else:
            if np.all(x == x[0]):
                raise ValueError("Linear fitting needs at least two distinct X values.")
            result = stats.linregress(x, y)
            slope, intercept = result.slope, result.intercept
            fitted = intercept + slope * x
            residuals = y - fitted
            r_squared = None if constant_y else float(result.rvalue**2)
    if (
        not all(math.isfinite(value) for value in (slope, intercept))
        or (r_squared is not None and not math.isfinite(r_squared))
        or not np.isfinite(fitted).all()
        or not np.isfinite(residuals).all()
    ):
        raise ValueError("The fit exceeded the supported numeric range.")

    return FitResult(x, y, fitted, residuals, float(slope), float(intercept), r_squared, len(worksheet.rows) - len(pairs))
