"""Equivalent-circuit fitting and its reproducible analysis outputs."""

import json
import math

import numpy as np

from .analysis_plugins import analysis_table, analysis_trace, integer_option, numeric_column


# A series resistance followed by a parallel charge-transfer resistance and capacitor.
def default_eis_circuit():
    return json.dumps({
        "type": "Series",
        "blocks": [
            {"type": "R", "parameters": [eis_parameter("Rs", 10, 0, 1e5)]},
            {"type": "Parallel", "blocks": [
                {"type": "R", "parameters": [eis_parameter("Rct", 100, 0, 1e5)]},
                {"type": "C", "parameters": [eis_parameter("Cdl", 2e-5, 1e-12, 1)]},
            ]},
        ],
    })


def eis_parameter(name, guess, lower, upper):
    return {"name": name, "x0": guess, "lower": lower, "upper": upper, "fixed": False, "shared": False}


def eis_fit(columns, rows, options):
    from impydance import Block, circuit_expression, fit_eis, impedance_from_columns

    try:
        circuit = Block.from_dict(json.loads(options["circuit"]))
    except (TypeError, ValueError, RecursionError) as error:
        raise ValueError(f"Check the circuit in the editor. {error}") from error

    frequency = numeric_column(rows, options["frequency"], "frequency")
    real = numeric_column(rows, options["real"], "real impedance")
    imaginary = numeric_column(rows, options["imaginary"], "imaginary impedance")
    measured = impedance_from_columns(real, imaginary, negative_imaginary=options["sign"] == "negative_imaginary")
    result = fit_eis(circuit, frequency, measured, weight=options["weight"],
                     n_starts=integer_option(options["starts"], "solver starts", 1, 100), lin_kk=options["lin_kk"])
    observed, fitted, residuals = measured, result.fitted, result.residuals
    order = np.argsort(frequency, kind="stable")
    traces = [
        analysis_trace("Measured", observed.real, -observed.imag, "markers"),
        analysis_trace("Circuit fit", fitted.real[order], -fitted.imag[order]),
    ]
    summary = {
        "Circuit": circuit_expression(circuit),
        "Solver converged": result.solver_success,
        "Jacobian rank": result.jacobian_rank,
        "Free parameters": len(result.free_parameters),
        "Full local rank": result.identifiable,
        "Jacobian condition": (result.jacobian_condition if result.jacobian_condition is not None
                                and math.isfinite(result.jacobian_condition) else None),
        "Weighted residual error": result.weighted_sse,
        "Status": result.message,
    }
    sources = {
        "parameters": analysis_table("EIS parameters", ("Parameter", "Estimate", "Fixed", "Active bound"),
                                     ((name, value, name in result.fixed_parameters, result.active_bounds.get(name))
                                      for name, value in result.parameters.items())),
        "spectrum": analysis_table("EIS fitted spectrum", (
            "Frequency (Hz)", "Z′ measured (Ω)", "Z″ measured (Ω)", "Z′ fitted (Ω)", "Z″ fitted (Ω)",
            "Z′ residual (Ω)", "Z″ residual (Ω)", "|Z| measured (Ω)", "|Z| fitted (Ω)",
            "Phase measured (°)", "Phase fitted (°)",
        ), zip(frequency.tolist(), observed.real.tolist(), observed.imag.tolist(), fitted.real.tolist(), fitted.imag.tolist(),
               residuals.real.tolist(), residuals.imag.tolist(), np.abs(observed).tolist(), np.abs(fitted).tolist(),
               np.angle(observed, deg=True).tolist(), np.angle(fitted, deg=True).tolist())),
    }
    check = result.lin_kk
    if check is not None:
        summary.update({
            "Lin-KK RC terms": check.n_rc, "Lin-KK μ": check.mu,
            "Lin-KK RMS residual (%)": check.metrics.rms_complex_percent,
            "Lin-KK maximum residual (%)": check.metrics.max_complex_percent,
        })
        sources["lin_kk"] = analysis_table("Lin-KK residuals", (
            "Frequency (Hz)", "Z′ fitted (Ω)", "Z″ fitted (Ω)", "Z′ residual (%)", "Z″ residual (%)",
        ), zip(frequency.tolist(), check.fitted.real.tolist(), check.fitted.imag.tolist(),
               (100 * check.relative_residuals.real).tolist(), (100 * check.relative_residuals.imag).tolist()))
    return {
        "traces": traces, "elements": ["observations", "fit"],
        "x_label": "Z′ (Ω)", "y_label": "−Z″ (Ω)", "layout": {"yaxis": {"scaleanchor": "x"}},
        "summary": summary, "sources": sources,
    }
