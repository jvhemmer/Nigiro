"""Manifests for the built-in signal, fitting, and electrochemistry plugins."""

from .analysis_plugins import align_resample, fft_spectrum, integrate_peak, nonlinear_fit, signal_filter
from .eis import default_eis_circuit, eis_fit
from .electrochemistry import detect_cv_segments, filter_segments, find_cv_peaks, ir_correction, onset_potential, tafel_analysis


def analysis_field(key, label, kind, default, **settings):
    return {"key": key, "label": label, "type": kind, "default": default, **settings}


def analysis_choice(key, label, default, *choices, **settings):
    return analysis_field(key, label, "choice", default,
                          choices=[{"value": value, "label": text} for value, text in choices], **settings)


def analysis_plugin(identifier, name, run, fields, outputs, **settings):
    key = f"nigiro.{identifier}"
    manifest = {"api": 1, "id": key, "version": "1", "name": name, "menu": "analysis",
                "fields": fields, "outputs": outputs, **settings}
    return key, (manifest, run)


voltage_current = [
    analysis_field("potential", "Potential column", "column", 0),
    analysis_field("current", "Current column", "column", 1),
]
xy_columns = [
    analysis_field("x", "X column", "column", 0),
    analysis_field("y", "Y column", "column", 1),
]
range_field = analysis_field("range", "Range", "text", "", help="Enter minimum, maximum. Leave blank for the entire source.")
segment_options = [
    analysis_field("tolerance", "Potential step tolerance", "number", 0, min=0,
                   help="Ignore smaller potential changes when detecting reversals."),
    analysis_field("confirmation", "Confirmation steps", "number", 2, min=1,
                   help="Number of steps in the new direction needed to confirm a reversal."),
]
sample_fields = [
    analysis_field("time", "Time column (s)", "column", 0, help="Used when sampling comes from the time column."),
    analysis_field("signal", "Signal column", "column", 1),
    analysis_choice("sampling", "Sampling", "time", ("time", "From time column"), ("rate", "Enter sampling rate")),
    analysis_field("rate", "Sampling rate (Hz)", "number", 100, min=0, visible_when={"sampling": "rate"}),
]

ANALYSIS_PLUGINS = dict([
    analysis_plugin("eis_fit", "EIS Fit", eis_fit, [
        analysis_field("frequency", "Frequency column (Hz)", "column", 0),
        analysis_field("real", "Real impedance column (Ω)", "column", 1),
        analysis_field("imaginary", "Imaginary impedance column (Ω)", "column", 2),
        analysis_field("circuit", "Equivalent circuit", "text", default_eis_circuit(), editor="eis_circuit"),
        analysis_choice("sign", "Imaginary column contains", "imaginary", ("imaginary", "Z″"), ("negative_imaginary", "−Z″")),
        analysis_choice("weight", "Weighting", "modulus", ("modulus", "Modulus"), ("none", "Unweighted")),
        analysis_field("starts", "Solver starts", "number", 8, min=1, max=100),
        analysis_field("lin_kk", "Include Lin-KK validation", "boolean", False),
    ], ["Nyquist figure", "Fit parameters and fitted spectrum tables", "Optional Lin-KK residuals table"],
        category="electrochemistry", distinct_columns=True, dependencies=["impydance"],
        description=r"""Fit complex impedance data to an equivalent circuit. Enter frequency in Hz and impedance in ohms.
Choose whether the imaginary input is $Z''$ or $-Z''$. The Nyquist plot shows $-Z''$ against $Z'$.

Set initial values and bounds in the circuit editor. Compare the fit with the measured spectrum and use the optional
Lin-KK residuals to check how closely the measurements satisfy the linear Kramers–Kronig relations."""),

    analysis_plugin("align_xy", "Align / Resample XY", align_resample, [
        analysis_field("reference_x", "Reference X", "column", 0),
        analysis_field("reference_y", "Reference Y", "column", 1),
        analysis_field("target_x", "Target X", "column", 0, prefer_other_source=True),
        analysis_field("target_y", "Target Y", "column", 1, prefer_other_source=True),
        analysis_choice("grid", "Output grid", "reference", ("reference", "Reference X values"), ("uniform", "Even spacing")),
        analysis_field("points", "Grid points", "number", 100, min=2, visible_when={"grid": "uniform"}),
        analysis_choice("duplicates", "Repeated X values", "error", ("error", "Report an error"),
                        ("mean", "Average Y values"), ("first", "Use first Y value")),
    ], ["One source with aligned X and both Y columns within their shared range"], input_mode="joint", table_only=True,
        description="""Interpolate two XY traces onto the same grid. Select X and Y for each trace.
Use the reference trace's X values or choose an evenly spaced grid.
The result contains only the shared X range. Choose how to handle repeated X values before interpolation."""),
    analysis_plugin("fft", "FFT Spectrum", fft_spectrum, [*sample_fields,
        analysis_choice("window", "Window", "hann", ("hann", "Hann"), ("boxcar", "Rectangular")),
        analysis_field("remove_mean", "Remove mean before FFT", "boolean", True),
    ], ["One-sided amplitude spectrum", "Frequency, amplitude, and phase table"], category="signal",
        description=r"""Compute a one-sided amplitude spectrum from a regularly sampled signal.
Supply a sampling rate in Hz or a time column in seconds. Choose a Hann or rectangular window.

The frequency spacing is $\Delta f = f_s/N$, where $f_s$ is the sampling rate and $N$ is the number of samples.
Remove the mean to suppress the DC component before windowing."""),
    analysis_plugin("signal_filter", "Filter Signal", signal_filter, [*sample_fields,
        analysis_choice("filter", "Filter type", "bandstop", ("bandstop", "Butterworth band-stop"),
                        ("notch", "Notch"), ("harmonic", "Harmonic band-stop")),
        analysis_field("low", "Lower frequency (Hz)", "number", 9.9, min=0,
                       visible_when={"filter": ["bandstop", "notch"]}),
        analysis_field("high", "Upper frequency (Hz)", "number", 10.1, min=0,
                       visible_when={"filter": ["bandstop", "notch"]}),
        analysis_field("fundamental", "Fundamental frequency (Hz)", "number", 10, min=0, visible_when={"filter": "harmonic"}),
        analysis_field("half_width", "Half-width per band (Hz)", "number", 0.1, min=0, visible_when={"filter": "harmonic"}),
        analysis_field("harmonics", "Maximum harmonics", "number", 5, min=1, max=100, visible_when={"filter": "harmonic"}),
        analysis_field("order", "Butterworth order", "number", 4, min=1, max=12, visible_when={"filter": ["bandstop", "harmonic"]}),
    ], ["Source with the original columns and the filtered signal", "Applied stop bands table"], category="signal", table_only=True,
        description=r"""Remove selected frequencies from a regularly sampled signal. Use a notch for one narrow band
or harmonic filtering for bands around multiples of a fundamental frequency.
All stop bands must fit below the Nyquist frequency $f_s/2$.

The filter runs forward and backward to avoid phase delay. The output adds a filtered column and lists the stop bands."""),
    analysis_plugin("nonlinear_fit", "Nonlinear Curve Fit", nonlinear_fit, [*xy_columns,
        analysis_choice("model", "Function", "gaussian",
                        ("gaussian", "Gaussian"), ("lorentzian", "Lorentzian"), ("exponential", "Exponential"),
                        ("logistic", "Logistic"), ("power", "Power law"), ("custom", "Custom expression")),
        analysis_field("expression", "f(x)", "text", "offset + amplitude * exp(rate * x)",
                       help="Use arithmetic, exp, log, log10, sqrt, sin, cos, tan, abs, or erf.",
                       visible_when={"model": "custom"}),
        analysis_field("parameters", "Parameter names", "text", "offset, amplitude, rate",
                       visible_when={"model": "custom"}),
        analysis_field("guesses", "Initial guesses", "text", "", help="Comma-separated. Leave blank to estimate from the data."),
        analysis_field("lower", "Lower bounds", "text", "", help="Comma-separated. Use -inf for no lower bound."),
        analysis_field("upper", "Upper bounds", "text", "", help="Comma-separated. Use inf for no upper bound."),
        range_field,
        analysis_field("evaluations", "Maximum evaluations", "number", 2000, min=1, max=100000),
    ], ["Fit figure", "Residuals figure", "Parameter and fitted values tables"], distinct_columns=True,
        model_parameters={
            "gaussian": ["offset", "height", "center", "sigma"], "lorentzian": ["offset", "height", "center", "half_width"],
            "exponential": ["offset", "amplitude", "rate"], "logistic": ["low", "high", "center", "width"],
            "power": ["offset", "amplitude", "exponent"],
        }, description=r"""Fit a built-in function or a custom expression to numeric X and Y data.
The fit minimizes the sum of squared residuals $y_i - f(x_i)$ in the selected range.

Provide starting values and bounds when you know plausible parameter values. Use the residuals to check for patterns
that the model leaves unexplained."""),
    analysis_plugin("integrate_peak", "Integrate Peak", integrate_peak, [*xy_columns, range_field,
        analysis_choice("baseline", "Baseline", "endpoints", ("endpoints", "Straight line through endpoints"), ("zero", "Zero")),
    ], ["Peak area figure", "Signed and absolute areas", "Baseline and corrected signal table"],
        distinct_columns=True, description=r"""Integrate one peak over a numeric X interval. Enter the range as **minimum, maximum**.
Leave it blank to use the full input. Use at least two points with strictly increasing or decreasing X values.

Choose a straight baseline through the selected endpoints or a zero baseline. The trapezoidal rule approximates:

$$
A = \int_{x_{\mathrm{first}}}^{x_{\mathrm{last}}} [y(x) - b(x)]\,dx
$$

Here $b(x)$ is the baseline. Integration follows the input row order, so reversing the rows changes the sign.
The output includes signed and absolute areas, a shaded figure, and a table with the baseline and corrected signal."""),
    analysis_plugin("detect_cv_segments", "Detect CV Segments", detect_cv_segments,
                    [voltage_current[0], *segment_options], ["Source with segment and direction columns"],
                    category="electrochemistry", table_only=True,
                    description="""Identify cyclic voltammetry sweeps from changes in the direction of the potential.
Use the step tolerance to ignore small changes and the confirmation setting to require consecutive steps
before accepting a reversal. The result adds segment numbers and directions to the original columns."""),
    analysis_plugin("filter_segments", "Filter Segments", filter_segments, [
        analysis_field("column", "Potential column", "column", 0),
        analysis_choice("mode", "Segment selection", "potential",
                        ("potential", "Detect from potential"), ("column", "Use existing segment numbers"),
                        optional=True, saved_default="column"),
        analysis_field("segments", "Segment numbers", "text", "1"),
        *(dict(field, optional=True, visible_when={"mode": "potential"}) for field in segment_options),
    ], ["Source with all columns and rows from the selected segments"],
        category="electrochemistry", table_only=True,
        description="""Keep selected cyclic voltammetry segments. Enter segment numbers separated by commas.
Detect sweeps from potential or use an existing segment-number column. All original columns are retained."""),
    analysis_plugin("cv_peaks", "Find CV Peaks", find_cv_peaks, [*voltage_current,
        analysis_choice("grouping", "Sweeps", "detect", ("detect", "Detect reversals"), ("column", "Use Segment column"),
                        ("one", "Treat input as one sweep")),
        analysis_choice("polarity", "Peak polarity", "both", ("both", "Maxima and minima"), ("maxima", "Maxima"), ("minima", "Minima")),
        analysis_field("prominence", "Minimum prominence", "number", 0, min=0),
        analysis_field("width", "Minimum width (samples)", "number", 0, min=0),
        analysis_field("count", "Peaks per sweep", "number", 0, min=0, help="Use 0 to keep every qualifying peak."),
        range_field,
        *(dict(field, visible_when={"grouping": "detect"}) for field in segment_options),
    ], ["CV with peak markers", "Peak table"], category="electrochemistry", distinct_columns=True,
        description="""Find current maxima, minima, or both within cyclic voltammetry sweeps.
Choose automatic sweep detection, a Segment column, or a single sweep.
Use the potential range, prominence, and width to narrow the search.
The result marks the peaks and reports their potential and current."""),
    analysis_plugin("ir_correction", "iR Correction", ir_correction, [*voltage_current,
        analysis_field("resistance", "Uncompensated resistance (Ω)", "number", 0, min=0),
        analysis_choice("potential_units", "Potential units", "V", ("V", "V"), ("mV", "mV")),
        analysis_choice("current_units", "Current units", "A", ("A", "A"), ("mA", "mA"), ("uA", "µA")),
    ], ["Source with the corrected potential column"], category="electrochemistry", table_only=True, distinct_columns=True,
        description=r"""Correct potential for uncompensated resistance using $E_{\mathrm{corrected}} = E - iR$.
Enter resistance in ohms and select the units of the input potential and current.
The result adds a corrected potential column in the selected potential units."""),
    analysis_plugin("onset", "Estimate Onset Potential", onset_potential, [*voltage_current, range_field,
        analysis_field("fraction", "Reaction progress at onset (%)", "number", 5, min=0.01, max=99.99,
                       help="Fraction of the fitted transition from baseline toward the reaction plateau."),
    ], ["Sigmoid fit with onset marker", "Onset and fitted values tables"], category="electrochemistry", distinct_columns=True,
        description="""Estimate onset from a sigmoid fit with linear baseline drift. Select one sweep that includes
both the baseline and the reaction plateau. The threshold specifies the percentage of the fitted sigmoid
transition at which to report the onset potential."""),
    analysis_plugin("tafel", "Tafel Analysis (Irreversible)", tafel_analysis, [
        {**voltage_current[0], "label": "Potential column (V)"}, {**voltage_current[1], "label": "Current density column"},
        analysis_field("range", "Tafel potential range (V)", "text", "", required=True,
                       help="Enter minimum, maximum for the linear region."),
        analysis_choice("branch", "Branch", "cathodic", ("cathodic", "Cathodic"), ("anodic", "Anodic")),
        analysis_field("equilibrium", "Equilibrium potential (V)", "number", 0),
        analysis_choice("current_units", "Current density units", "mA/cm²", ("mA/cm²", "mA/cm²"), ("A/cm²", "A/cm²")),
        analysis_field("estimate_alpha", "Estimate transfer coefficient", "boolean", False),
        analysis_field("temperature", "Temperature (K)", "number", 298.15, min=1, visible_when={"estimate_alpha": True}),
        analysis_field("electrons", "Electron count", "number", 1, min=1, max=20, visible_when={"estimate_alpha": True}),
    ], ["Tafel plot and fit", "Slope, exchange current density, and fitted values"],
        category="electrochemistry", distinct_columns=True,
        description=r"""Fit the linear region of an irreversible anodic or cathodic branch. Enter the equilibrium
potential, current-density units, and the potential limits of the linear region.

The fit uses $|\eta| = a + b \log_{10}|j|$ in the selected units. The output reports the slope in mV per decade
and extrapolates the exchange current density to zero overpotential. The transfer coefficient estimate also
requires the temperature and electron count."""),
])
