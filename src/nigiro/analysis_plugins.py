"""Numerical analysis plugins shared by the desktop and exported scripts."""

from __future__ import annotations

import ast
import keyword
import math

import numpy as np
from scipy import optimize, signal, special


def numeric_column(rows, index, name):
    values = []
    for number, row in enumerate(rows, start=1):
        try:
            value = float(row[index])
        except (TypeError, ValueError) as error:
            raise ValueError(f"Enter a numeric {name} at row {number}.") from error
        if not math.isfinite(value):
            raise ValueError(f"Enter a finite {name} at row {number}.")
        values.append(value)
    if not values:
        raise ValueError("Select a source with data.")
    return np.array(values, dtype=float)


def analysis_table(name, columns, rows):
    return {"name": name, "columns": list(columns), "rows": list(rows)}


def analysis_trace(name, x, y, mode="lines", **attributes):
    return {"type": "scatter", "mode": mode, "name": name,
            "x": np.asarray(x).tolist(), "y": np.asarray(y).tolist(), **attributes}


def integer_option(value, label, minimum=1, maximum=1_000_000):
    if int(value) != value or not minimum <= value <= maximum:
        raise ValueError(f"Enter a whole number from {minimum} to {maximum} for {label}.")
    return int(value)


def analysis_window(x, text):
    if not text.strip():
        return np.ones(x.shape, dtype=bool)
    try:
        low, high = (float(item) for item in text.split(","))
    except ValueError as error:
        raise ValueError("Enter the range as two comma-separated numbers.") from error
    if not math.isfinite(low) or not math.isfinite(high) or low >= high:
        raise ValueError("Enter finite range limits in increasing order.")
    return (x >= low) & (x <= high)


def aligned_pair(inputs, x_key, y_key, duplicates):
    def values(key):
        entry = inputs[key]
        return numeric_column(entry["rows"], entry["column"], key.replace("_", " "))

    x, y = values(x_key), values(y_key)
    if len(x) != len(y):
        raise ValueError("Pair each X column with a Y column that has the same number of rows.")
    order = np.argsort(x, kind="stable")
    x, y = x[order], y[order]
    grid, index, counts = np.unique(x, return_index=True, return_counts=True)
    if len(grid) < 2:
        raise ValueError("Each trace needs at least two distinct X values.")
    if duplicates == "error" and np.any(counts > 1):
        raise ValueError("X values repeat. Choose how to combine duplicates or select one sweep.")
    return grid, np.add.reduceat(y, index) / counts if duplicates == "mean" else y[index]


def align_resample(columns, rows, options, inputs):
    ref_x, ref_y = aligned_pair(inputs, "reference_x", "reference_y", options["duplicates"])
    x, y = aligned_pair(inputs, "target_x", "target_y", options["duplicates"])
    low, high = max(ref_x[0], x[0]), min(ref_x[-1], x[-1])
    if low >= high:
        raise ValueError("The traces need an overlapping X range.")
    if options["grid"] == "uniform":
        grid = np.linspace(low, high, integer_option(options["points"], "grid points", 2))
    else:
        grid = ref_x[(ref_x >= low) & (ref_x <= high)]
        if len(grid) < 2:
            raise ValueError("The overlap contains fewer than two reference samples. Use an evenly spaced grid.")
    table = analysis_table("Aligned XY", ("X", "Reference Y", "Target Y"),
                           zip(grid.tolist(), np.interp(grid, ref_x, ref_y).tolist(), np.interp(grid, x, y).tolist()))
    return {"sources": {"aligned": table}}


def sampled_signal(columns, rows, options):
    index = options["signal"]
    values = numeric_column(rows, index, columns[index])
    if len(values) < 3:
        raise ValueError("Use a signal with at least three samples.")
    if options["sampling"] == "rate":
        rate = options["rate"]
    else:
        index = options["time"]
        if index == options["signal"]:
            raise ValueError("Choose different time and signal columns.")
        time = numeric_column(rows, index, columns[index])
        steps = np.diff(time)
        period = np.median(steps)
        if period <= 0 or not np.all(steps > 0) or not np.allclose(steps, period, rtol=0.01, atol=0):
            raise ValueError("Use increasing time in seconds with sample spacing within 1% of the median.")
        rate = 1 / period
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError("Enter a positive sampling rate in Hz.")
    return values, rate


def fft_spectrum(columns, rows, options):
    values, rate = sampled_signal(columns, rows, options)
    if options["remove_mean"]:
        values = values - values.mean()
    window = signal.get_window(options["window"], len(values))
    spectrum = np.fft.rfft(values * window)
    amplitude = np.abs(spectrum) / window.sum()
    amplitude[1:(-1 if len(values) % 2 == 0 else None)] *= 2
    hz = np.fft.rfftfreq(len(values), 1 / rate)
    return {
        "traces": [analysis_trace("Amplitude spectrum", hz, amplitude)],
        "x_label": "Frequency (Hz)", "y_label": "Amplitude",
        "sources": {"spectrum": analysis_table(
            "FFT spectrum", ("Frequency (Hz)", "Amplitude", "Phase (rad)"),
            zip(hz.tolist(), amplitude.tolist(), np.angle(spectrum).tolist()),
        )},
    }


def signal_filter(columns, rows, options):
    values, rate = sampled_signal(columns, rows, options)
    mode = options["filter"]
    if mode == "harmonic":
        fundamental, width = options["fundamental"], options["half_width"]
        if not 0 < width < fundamental / 2:
            raise ValueError("Enter a half-width below half the fundamental frequency.")
        limit = integer_option(options["harmonics"], "maximum harmonics", 1, 100)
        bands = [(n * fundamental - width, n * fundamental + width)
                 for n in range(1, limit + 1) if n * fundamental + width < rate / 2]
        if not bands:
            raise ValueError("The first stop band must fit below the Nyquist frequency.")
    else:
        low, high = options["low"], options["high"]
        if not 0 < low < high < rate / 2:
            raise ValueError("The stop band must be positive, increasing, and below the Nyquist frequency.")
        bands = [(low, high)]
    if mode == "notch":
        center = (low + high) / 2
        numerator, denominator = signal.iirnotch(center, center / (high - low), rate)
        sections = signal.tf2sos(numerator, denominator)
    else:
        order = integer_option(options["order"], "filter order", 1, 12)
        sections = np.vstack([signal.butter(order, band, btype="bandstop", fs=rate, output="sos") for band in bands])
    try:
        filtered = signal.sosfiltfilt(sections, values)
    except ValueError as error:
        raise ValueError("The signal is too short for this zero-phase filter. Reduce the order or number of bands.") from error
    return {"sources": {
        "filtered": analysis_table("Filtered signal", (*columns, f"{columns[options['signal']]} (filtered)"),
                                   (tuple(row) + (value,) for row, value in zip(rows, filtered.tolist()))),
        "bands": analysis_table("Applied stop bands", ("Low (Hz)", "High (Hz)"), bands),
    }}


def fitting_numbers(text, size, label, defaults, *, infinite=False):
    if not text.strip():
        return np.asarray(defaults, dtype=float)
    try:
        parts = text.split(",")
        if len(parts) != size:
            raise ValueError(f"Enter {size} values for {label}.")
        values = np.asarray([float(item) if item.strip() else default for item, default in zip(parts, defaults)], dtype=float)
    except ValueError as error:
        raise ValueError(f"Enter comma-separated numbers for {label}.") from error
    if np.isnan(values).any() or (not infinite and not np.isfinite(values).all()):
        raise ValueError(f"Enter {size} valid values for {label}.")
    return values


def custom_fit_function(expression, parameters):
    if not expression.strip() or len(expression) > 500:
        raise ValueError("Enter a custom expression of up to 500 characters.")
    functions = {"exp": np.exp, "log": np.log, "log10": np.log10, "sqrt": np.sqrt,
                 "sin": np.sin, "cos": np.cos, "tan": np.tan, "abs": np.abs, "erf": special.erf}
    constants = {"pi": np.pi, "e": np.e}
    reserved = set(functions) | set(constants) | {"x"}
    if not 1 <= len(parameters) <= 12 or len(set(parameters)) != len(parameters) or any(
        not name.isascii() or not name.isidentifier() or keyword.iskeyword(name) or name in reserved for name in parameters
    ):
        raise ValueError("Enter 1 to 12 distinct parameter names other than x, pi, e, or a function name.")
    try:
        tree = ast.parse(expression.replace("^", "**").strip(), mode="eval")
    except SyntaxError as error:
        raise ValueError("Enter a valid mathematical expression in x and the parameters.") from error
    variables = set(parameters) | set(constants) | {"x"}

    def evaluate(node, values):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return np.float64(node.value)
        if isinstance(node, ast.Name) and node.id in variables:
            return values[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = evaluate(node.operand, values)
            return operand if isinstance(node.op, ast.UAdd) else -operand
        if isinstance(node, ast.BinOp):
            operators = {ast.Add: np.add, ast.Sub: np.subtract, ast.Mult: np.multiply,
                         ast.Div: np.divide, ast.Pow: np.power}
            operation = operators.get(type(node.op))
            if operation:
                return operation(evaluate(node.left, values), evaluate(node.right, values))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in functions and len(node.args) == 1 and not node.keywords:
            return functions[node.func.id](evaluate(node.args[0], values))
        raise ValueError("Use only numbers, x, your parameters, arithmetic, and the listed functions.")

    return lambda x, *args: np.broadcast_to(evaluate(tree.body, {**constants, "x": x, **dict(zip(parameters, args))}), x.shape)


def nonlinear_model(options, x, y):
    span = np.ptp(x)
    midpoint = float(np.median(x))
    low, high = float(np.min(y)), float(np.max(y))
    amplitude = high - low or max(abs(high), 1.0)
    width = span / 4
    peak = int(np.argmax(abs(y - np.median(y))))
    rising = y[np.argmin(x)] <= y[np.argmax(x)]
    model = options["model"]
    if model == "custom":
        names = [item.strip() for item in options["parameters"].split(",")]
        return names, custom_fit_function(options["expression"], names), [1] * len(names), [-np.inf] * len(names)
    models = {
        "exponential": (("offset", "amplitude", "rate"), lambda t, a, b, c: a + b * np.exp(c * t),
                        [low, amplitude, -1 / span], [-np.inf] * 3),
        "gaussian": (("offset", "height", "center", "sigma"), lambda t, a, b, c, d: a + b * np.exp(-0.5 * ((t - c) / d) ** 2),
                     [float(np.median(y)), float(y[peak] - np.median(y)), x[peak], width], [-np.inf, -np.inf, -np.inf, 0]),
        "lorentzian": (("offset", "height", "center", "half_width"), lambda t, a, b, c, d: a + b / (1 + ((t - c) / d) ** 2),
                       [float(np.median(y)), float(y[peak] - np.median(y)), x[peak], width], [-np.inf, -np.inf, -np.inf, 0]),
        "logistic": (("low", "high", "center", "width"), lambda t, a, b, c, d: a + (b - a) * special.expit((t - c) / d),
                     [low if rising else high, high if rising else low, midpoint, width], [-np.inf, -np.inf, -np.inf, 0]),
        "power": (("offset", "amplitude", "exponent"), lambda t, a, b, c: a + b * np.power(t, c),
                  [low, amplitude / span, 1], [-np.inf] * 3),
    }
    if model == "power" and np.any(x <= 0):
        raise ValueError("Power-law fitting requires positive X values.")
    return models[model]


def nonlinear_fit(columns, rows, options):
    x_index, y_index = options["x"], options["y"]
    complete = [row for row in rows if str(row[x_index]).strip() and str(row[y_index]).strip()]
    x = numeric_column(complete, x_index, columns[x_index])
    y = numeric_column(complete, y_index, columns[y_index])
    keep = analysis_window(x, options["range"])
    x, y = x[keep], y[keep]
    if len(x) < 2 or np.ptp(x) == 0:
        raise ValueError("Choose a fit range with distinct X values.")
    names, model, defaults, required_lower = nonlinear_model(options, x, y)
    size = len(names)
    if len(x) <= size or np.unique(x).size < size:
        raise ValueError("The fit needs more observations than parameters and enough distinct X values.")
    start = fitting_numbers(options["guesses"], size, "initial guesses", defaults)
    lower = fitting_numbers(options["lower"], size, "lower bounds", required_lower, infinite=True)
    upper = fitting_numbers(options["upper"], size, "upper bounds", [np.inf] * size, infinite=True)
    if np.any(lower < required_lower) or np.any(lower >= upper) or np.any(start < lower) or np.any(start > upper):
        raise ValueError("Use increasing bounds and initial guesses within them. Model widths must be positive.")
    if np.any((np.asarray(required_lower) == 0) & (start <= 0)):
        raise ValueError("Enter positive initial widths.")
    attempts = integer_option(options["evaluations"], "maximum evaluations", 1, 100_000)
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        try:
            fit = optimize.least_squares(lambda p: model(x, *p) - y, start, bounds=(lower, upper),
                                         x_scale="jac", max_nfev=attempts)
        except ValueError as error:
            raise ValueError(f"Could not start the fit. Check the model, range, guesses, and bounds. {error}") from error
        if not fit.success:
            raise ValueError(f"The fit did not converge. {fit.message}")
        predicted = model(x, *fit.x)
        grid = np.linspace(x.min(), x.max(), 401)
        curve = model(grid, *fit.x)
    if not np.isfinite(curve).all():
        raise ValueError("The fitted model is undefined within the selected X range.")
    residuals = y - predicted
    dof = len(x) - size
    rank = int(np.linalg.matrix_rank(fit.jac))
    sse = float(np.dot(residuals, residuals))
    stderr = [None] * size
    if rank == size and not fit.active_mask.any():
        _, singular, vectors = np.linalg.svd(fit.jac, full_matrices=False)
        variances = ((vectors.T / singular) ** 2).sum(axis=1) * sse / dof
        stderr = np.sqrt(variances).tolist()
    total = float(np.sum((y - y.mean()) ** 2))
    return {
        "traces": [analysis_trace("Observations", x, y, "markers"), analysis_trace("Nonlinear fit", grid, curve),
                   analysis_trace("Residuals", x, residuals, "markers", xaxis="x2", yaxis="y2", showlegend=False)],
        "elements": ["observations", "fit", "observations"],
        "x_label": columns[x_index], "y_label": columns[y_index], "residual_panel": True,
        "summary": {"R²": 1 - sse / total if total > 0 else None, "Observations": len(x),
                    "Jacobian rank": rank, "Parameters": size, "Evaluations": fit.nfev},
        "sources": {
            "coefficients": analysis_table("Parameters", ("Parameter", "Estimate", "Standard error", "Active bound"),
                                            zip(names, fit.x.tolist(), stderr, fit.active_mask.tolist())),
            "fitted": analysis_table("Fitted values", (columns[x_index], "Observed", "Fitted", "Residual"),
                                      zip(x.tolist(), y.tolist(), predicted.tolist(), residuals.tolist())),
        },
    }
