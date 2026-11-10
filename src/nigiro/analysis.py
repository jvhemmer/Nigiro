"""Numerical execution for a saved linear-fit recipe."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import stats

from .project import LinearFit, Worksheet, numeric_value


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


def run_linear_fit(worksheet: Worksheet, recipe: LinearFit) -> FitResult:
    if recipe.x == recipe.y:
        raise ValueError("Choose different X and Y columns.")
    pairs = []
    for index, row in enumerate(worksheet.rows, start=1):
        try:
            x = numeric_value(row[recipe.x])
            y = numeric_value(row[recipe.y])
        except ValueError as exc:
            raise ValueError(f"Worksheet row {index} has an invalid X or Y value.") from exc
        if x is not None and y is not None:
            pairs.append((x, y))
    if len(pairs) < 2:
        raise ValueError("Linear fitting needs at least two complete X/Y pairs.")

    x, y = np.asarray(pairs).T
    if np.all(x == x[0]):
        raise ValueError("Linear fitting needs at least two distinct X values.")
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        result = stats.linregress(x, y)
        fitted = result.intercept + result.slope * x
        residuals = y - fitted
    constant_y = bool(np.all(y == y[0]))
    if (
        not all(math.isfinite(value) for value in (result.slope, result.intercept))
        or (not constant_y and not math.isfinite(result.rvalue))
        or not np.isfinite(fitted).all()
        or not np.isfinite(residuals).all()
    ):
        raise ValueError("The fit exceeded the supported numeric range.")

    return FitResult(
        x=x,
        y=y,
        fitted=fitted,
        residuals=residuals,
        slope=float(result.slope),
        intercept=float(result.intercept),
        r_squared=None if constant_y else float(result.rvalue**2),
        omitted_rows=len(worksheet.rows) - len(pairs),
    )
