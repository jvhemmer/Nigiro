"""Electrochemistry operations used by Nigiro and Python replay."""

from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation

import numpy as np
from scipy import constants, optimize, signal, special, stats

from .analysis_plugins import analysis_table, analysis_trace, analysis_window, integer_option, numeric_column


def segment_potential(potential, tolerance, minimum):
    if len(potential) < 2:
        raise ValueError("Detecting segments needs at least two potential readings.")
    steps = np.diff(potential)
    signs = np.where(steps > tolerance, 1, np.where(steps < -tolerance, -1, 0))
    # A plateau belongs to the previous sweep. Isolated reversals do not split it.
    turns = [0]
    directions = []
    direction = 0
    candidate, first, count = 0, 0, 0
    for index, sign in enumerate(signs):
        if sign == 0:
            continue
        if sign == direction:
            candidate, count = 0, 0
            continue
        if sign != candidate:
            candidate, first, count = sign, index, 0
        count += 1
        if count < minimum:
            continue
        if direction:
            turns.append(first + 1)
        direction = candidate
        directions.append("Increasing" if direction > 0 else "Decreasing")
        candidate, count = 0, 0
    if not directions:
        raise ValueError("No sweep meets the reversal threshold. Check the tolerance and confirmation length.")
    return list(zip(turns, (*turns[1:], len(potential)), directions))


def filter_segments(columns, rows, options):
    entries = [item.strip() for item in options["segments"].split(",")]
    if any(not re.fullmatch(r"[0-9]+", item) for item in entries):
        raise ValueError("Enter segment numbers separated by commas, for example 1,2,3,5.")
    column = options["column"]
    if options.get("mode", "column") == "potential":
        requested = {int(item) for item in entries}
        potential = numeric_column(rows, column, columns[column])
        minimum = integer_option(options.get("confirmation", 2), "confirmation steps")
        segments = segment_potential(potential, options.get("tolerance", 0), minimum)
        missing = requested.difference(range(1, len(segments) + 1))
        if missing:
            unavailable = ", ".join(map(str, sorted(missing)))
            raise ValueError(f"Detected {len(segments)} segments numbered from 1. Segment numbers unavailable: {unavailable}.")
        matches = [row for number, (start, stop, _) in enumerate(segments, start=1)
                   if number in requested for row in rows[start:stop]]
    else:
        requested = {Decimal(item) for item in entries}
        matches = []
        for row in rows:
            try:
                segment = Decimal(str(row[column]))
            except InvalidOperation:
                continue
            if segment.is_finite() and segment in requested:
                matches.append(row)
    return {"traces": [], "sources": {
        "filtered": analysis_table("Filtered segments", columns, matches),
    }}


def detect_cv_segments(columns, rows, options):
    potential = numeric_column(rows, options["potential"], "potential")
    minimum = integer_option(options["confirmation"], "confirmation steps", 1)
    segments = segment_potential(potential, options["tolerance"], minimum)
    if {"segment", "direction"} & {name.strip().lower() for name in columns}:
        raise ValueError("The source already contains a Segment or Direction column.")
    table = analysis_table("CV segments", (*columns, "Segment", "Direction"),
                           (tuple(rows[index]) + (number, direction)
                            for number, (start, stop, direction) in enumerate(segments, start=1)
                            for index in range(start, stop)))
    return {"sources": {"segments": table}}


def cv_peak_groups(columns, rows, potential, options):
    if options["grouping"] == "one":
        return [(1, 0, len(rows))]
    segment_column = next((index for index, name in enumerate(columns) if name.strip().lower() == "segment"), None)
    if segment_column is not None and options["grouping"] == "column":
        identifiers = [row[segment_column] for row in rows]
        starts = [0, *(index for index in range(1, len(rows)) if identifiers[index] != identifiers[index - 1])]
        return [(identifiers[start], start, stop) for start, stop in zip(starts, (*starts[1:], len(rows)))]
    if options["grouping"] == "column":
        raise ValueError("Detect CV segments first, or choose a different sweep grouping.")
    segments = segment_potential(potential, options["tolerance"], integer_option(options["confirmation"], "confirmation steps"))
    return [(index, start, stop) for index, (start, stop, _) in enumerate(segments, start=1)]


def find_cv_peaks(columns, rows, options):
    ix, iy = options["potential"], options["current"]
    x, y = numeric_column(rows, ix, "potential"), numeric_column(rows, iy, "current")
    window = analysis_window(x, options["range"])
    maximum = integer_option(options["count"], "peaks per sweep", 0)
    results = []
    for label, start, stop in cv_peak_groups(columns, rows, x, options):
        candidates = []
        for polarity, sign in (("maxima", 1), ("minima", -1)):
            if options["polarity"] not in ("both", polarity):
                continue
            # Include the preceding vertex as a boundary sample for the next sweep.
            left = max(0, start - 1)
            indices, properties = signal.find_peaks(sign * y[left:stop], prominence=options["prominence"],
                                                     width=options["width"] or None)
            candidates.extend((label, int(index + left), polarity, float(prominence))
                              for index, prominence in zip(indices, properties["prominences"])
                              if index + left >= start and window[index + left])
        if maximum:
            candidates = sorted(candidates, key=lambda peak: (-peak[3], peak[1]))[:maximum]
        results.extend(sorted(candidates, key=lambda peak: peak[1]))
    indices = [row for _, row, _, _ in results]
    table = analysis_table("CV peaks", ("Segment", "Row", columns[ix], columns[iy], "Type", "Prominence"),
                           ((label, row + 1, float(x[row]), float(y[row]), polarity, prominence)
                            for label, row, polarity, prominence in results))
    return {"traces": [analysis_trace("CV", x, y), analysis_trace("Peaks", x[indices], y[indices], "markers")],
            "elements": ["observations", "fit"], "x_label": columns[ix], "y_label": columns[iy],
            "summary": {"Peaks": len(results)}, "sources": {"peaks": table}}


def ir_correction(columns, rows, options):
    potential = numeric_column(rows, options["potential"], "potential")
    current = numeric_column(rows, options["current"], "current")
    current_scale = {"A": 1, "mA": 1e-3, "uA": 1e-6}[options["current_units"]]
    potential_scale = {"V": 1, "mV": 1e-3}[options["potential_units"]]
    corrected = potential - current * (options["resistance"] * current_scale / potential_scale)
    label = f"Corrected potential ({options['potential_units']})"
    table = analysis_table("iR-corrected data", (*columns, label),
                           (tuple(row) + (value,) for row, value in zip(rows, corrected.tolist())))
    return {"sources": {"corrected": table}}


def onset_potential(columns, rows, options):
    ix, iy = options["potential"], options["current"]
    x, y = numeric_column(rows, ix, "potential"), numeric_column(rows, iy, "current")
    keep = analysis_window(x, options["range"])
    x, y = x[keep], y[keep]
    if len(x) < 6 or not (np.all(np.diff(x) > 0) or np.all(np.diff(x) < 0)):
        raise ValueError("Select at least six distinct potential readings in one monotonic sweep.")
    if np.ptp(y) == 0:
        raise ValueError("The selected current is constant.")
    direction = 1 if x[-1] > x[0] else -1
    origin, span = float(x[0]), float(abs(x[-1] - x[0]))
    t = direction * (x - origin) / span

    def model(t, start, end, center, width, drift):
        return start + (end - start) * special.expit((t - center) / width) + drift * t

    initial = (y[0], y[-1], 0.5, 0.1, 0.0)
    lower = (-np.inf, -np.inf, 0, 1e-8, -np.inf)
    upper = (np.inf, np.inf, 1, np.inf, np.inf)
    fit = optimize.least_squares(lambda p: model(t, *p) - y, initial, bounds=(lower, upper), x_scale="jac")
    if not fit.success or np.linalg.matrix_rank(fit.jac) < len(initial):
        raise ValueError("Could not identify a sigmoid in this range. Include the baseline and reaction plateau.")
    fraction = options["fraction"] / 100
    onset = fit.x[2] + fit.x[3] * (math.log(fraction) - math.log1p(-fraction))
    if not 0 <= onset <= 1:
        raise ValueError("The requested onset is outside the fit range. Adjust the range or threshold.")
    voltage = float(origin + direction * span * onset)
    current = float(model(onset, *fit.x))
    predicted = model(t, *fit.x)
    return {
        "traces": [analysis_trace("Observations", x, y, "markers"),
                   analysis_trace("Sigmoid fit", x, predicted), analysis_trace("Onset", [voltage], [current], "markers")],
        "elements": ["observations", "fit", None],
        "x_label": columns[ix], "y_label": columns[iy],
        "summary": {"Onset potential": voltage, "Threshold (%)": options["fraction"]},
        "sources": {"onset": analysis_table("Onset", (columns[ix], columns[iy], "Threshold (%)"),
                                            [(voltage, current, options["fraction"])]),
                    "fitted": analysis_table("Fitted onset", (columns[ix], "Observed", "Fitted", "Residual"),
                                             zip(x.tolist(), y.tolist(), predicted.tolist(), (y - predicted).tolist()))},
    }


def tafel_analysis(columns, rows, options):
    if not options["range"].strip():
        raise ValueError("Enter the potential limits of the linear Tafel region.")
    potential = numeric_column(rows, options["potential"], "potential (V)")
    current = numeric_column(rows, options["current"], "current density")
    sign = 1 if options["branch"] == "anodic" else -1
    eta = sign * (potential - options["equilibrium"])
    density = sign * current
    keep = analysis_window(potential, options["range"]) & (eta > 0) & (density > 0)
    eta, density = eta[keep], density[keep]
    if len(eta) < 3 or np.unique(density).size < 3:
        raise ValueError("Choose a Tafel range with at least three distinct current densities of the selected polarity.")
    log_current = np.log10(density)
    fit = stats.linregress(log_current, eta)
    if not math.isfinite(fit.slope) or fit.slope <= 0:
        raise ValueError("The selected data do not give a positive Tafel slope for this branch.")
    log_j0 = float(-fit.intercept / fit.slope)
    j0 = 10 ** log_j0 if -300 < log_j0 < 300 else None
    predicted = fit.intercept + fit.slope * log_current
    grid = np.array([log_current.min(), log_current.max()])
    units = options["current_units"]
    summary = {"Slope (mV/dec)": float(1000 * fit.slope),
               "Slope standard error (mV/dec)": float(1000 * fit.stderr),
               "Exchange current density": j0, "log10 exchange current density": log_j0,
               "Current density units": units, "R²": float(fit.rvalue**2), "Observations": len(eta)}
    if options["estimate_alpha"]:
        electrons = integer_option(options["electrons"], "electron count", 1, 20)
        summary["Apparent transfer coefficient"] = float(math.log(10) * constants.R * options["temperature"]
                                                          / (electrons * constants.physical_constants["Faraday constant"][0] * fit.slope))
    return {
        "traces": [analysis_trace("Observations", log_current, 1000 * eta, "markers"),
                   analysis_trace("Tafel fit", grid, 1000 * (fit.intercept + fit.slope * grid))],
        "elements": ["observations", "fit"],
        "x_label": f"log₁₀(|j| / ({units}))", "y_label": "Overpotential magnitude (mV)",
        "summary": summary,
        "sources": {"coefficients": analysis_table("Tafel parameters", ("Parameter", "Value"), summary.items()),
                    "fitted": analysis_table("Tafel fit", ("log₁₀(|j|)", "Observed (mV)", "Fitted (mV)", "Residual (mV)"),
                                             zip(log_current.tolist(), (1000 * eta).tolist(), (1000 * predicted).tolist(),
                                                 (1000 * (eta - predicted)).tolist()))},
    }
