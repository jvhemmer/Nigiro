# Nigiro

Nigiro is a free, open-source desktop app for scientific plotting and reproducible analysis. The editor links a CSV, a worksheet, a linear fit, and a figure.

Download a desktop installer for Windows, Linux, or macOS from [GitHub Releases](https://github.com/jvhemmer/Nigiro/releases/latest).

## Run the desktop app in development

Install Node.js 22.12 or later, uv, and the Tauri prerequisites for your operating system. See the [uv install guide](https://docs.astral.sh/uv/getting-started/installation/) and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run dev
```

Tauri opens Nigiro in its own window. The development command builds the Python engine from `uv.lock`.

## Build a desktop bundle

Run the build on the operating system and architecture you want to package.

```sh
npm run bundle -- -- --locked
```

On Debian or Ubuntu, build just the `.deb` package with this command.

```sh
npm run bundle -- --bundles deb -- --locked
```

Find the package in `src-tauri/target/release/bundle/`. The bundle includes the Python engine and runs offline with the system webview.

## Desktop updates

Open **Edit → Settings → Updates** to change the startup check or check for a release. When a release is available, the information icon next to the version opens this tab. Save your work, then select **Update and restart**. Nigiro verifies the download signature before it installs the update.

Install the first updater-enabled release manually. In-app updates use the Windows installer, macOS app bundle, or Linux AppImage. Use your package manager for packages such as `.deb`.

### Prepare a signed release

1. Generate a key with `npm run tauri -- signer generate -- -w ~/.tauri/nigiro.key`. Keep a secure backup of the private key and password. Installed apps trust the matching public key.
2. Set the GitHub Actions repository variable `NIGIRO_UPDATER_PUBLIC_KEY` to the contents of `nigiro.key.pub`.
3. Set the Actions secret `TAURI_SIGNING_PRIVATE_KEY` to the contents of `nigiro.key`. If the key has a password, set the `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret.
4. Push a tag that matches the version in `src-tauri/tauri.conf.json`, for example `v0.2.0` for version `0.2.0`.
5. After the build jobs pass, review and publish the draft release. The workflow includes signed assets and the `latest.json` update manifest.

See the [Tauri updater guide](https://v2.tauri.app/plugin/updater/) for details about the signing key and supported formats.

## Python runtime

Open **Edit → Settings → Python** to see the active runtime and select the one to use after restart.

- **Bundled engine** includes Nigiro's analysis code, Python, and the required packages. This is the default and works offline.
- **Existing Python installation** uses the full path to a Python 3.10 or newer executable. Install Nigiro's runtime dependencies in that environment.
- **Python managed by uv** uses an installed uv to select a Python version and install the packages pinned in `uv.lock` in an isolated environment. Enter a version such as `3.12`. Set the full path to uv if Nigiro cannot find it.

Nigiro tests a new runtime before it saves your selection. If the selected runtime fails at a later startup, Nigiro uses its bundled engine and shows the error in **Settings → Python**.

## Try the editor

1. Select **Data → Try Sample Data** or **Data → Import Raw Data**. **File → New** starts an empty project.
2. Select **Analysis → Linear Fit**. Choose a source and its X and Y columns on **Inputs**, then select **Run analysis**.
3. Select a point or the fit line, then apply a color in **Figure element**.
4. Double-click a value in **Working data** and press Enter to apply the edit.
5. Select **File → Save** to save the project.

The fit excludes rows with a blank X or Y value and reports how many it excluded. Other invalid values produce an error with the row number.

Import and Open dialogs start in the current project's last import folder. If it is unavailable, Nigiro uses the last remembered import folder, including from a previous session. The project archive saves its import path.

**Import Raw Data** can detect text tables in CSV, TSV, TXT, and files with other extensions. It supports comma, tab, semicolon, pipe, and whitespace separators. If the layout is unclear, **Import Options** shows a preview of up to 20 rows. Choose a delimiter, text encoding, comment prefix, and header row. Use zero for a file with no header. To exclude particular lines, enter their original line numbers, for example `2,5-8`. A project keeps the original file bytes and the import settings.

## Plot columns

Select **Plot → Scatter**, **Line**, or **Bar**. Plots, analyses, and operations use the same input dialog. In **Inputs**, each source row shows its name, original path when available, and dimensions as rows × columns. Select the sources and columns there. With multiple sources, Nigiro matches column headers from the reference source. Use the mapping table to change the columns for any source. Scatter and line plots use numeric X and Y values. Bar plots use the X column as labels.

The **Configuration** tab contains the plugin's settings. The **Output** tab lists what the plugin produces and lets you create new figures or add traces to existing figures with compatible axes. For multiple sources, you can overlay the traces or use a separate figure for each source.

For an analysis that runs independently on each source, choose a **Source group** on **Inputs** to use its current members every time the step runs. On **Output**, set **Group destination** to keep the result tables outside groups, add them to an existing group, or create a group for a later step. A group created by a step stays available even if that step produces zero tables on a rerun.

## Switch sources and figures

Open **Edit → Settings → Global Figure Settings** to set defaults for new figures. Settings persist across app restarts. Each value in an individual figure's settings has a save icon to make it the global default and a restore icon to copy the current global default into that figure. Select **Apply** to save changes to the figure.

In **Edit → Settings → Appearance**, choose **System**, **Light**, or **Dark** and an accent color, then select **Save settings**. System follows the operating system's color scheme. Expand or collapse **Global Figure Settings** in the left sidebar to show its figure and axis sections.

Use the tabs in **Worksheet** to switch between imported data and analysis results. Drag entries in **Sources** to change their display order. Select a source or click a plot trace to see its details in **Inspect**. The dockable **Sources** panel lists all sources. Select an entry to open it in **Worksheet**. Linear Fit creates separate tables for coefficients and fitted values. The fitted values table includes X, observed Y, fitted Y, and residuals.

Linear Fit produces a fit and a separate residual figure. Use the tabs in **Figure** to switch between them or return to any earlier figure. Each figure has its own appearance settings. For a fit from one source, **Plugin settings** updates its fit and residual figures.

Save the project to keep the figures, their settings, and the analysis tables. Nigiro recalculates linked results after a worksheet correction.

## Run recorded steps

Nigiro records imports, plots, analyses, and worksheet changes in **Recorded Steps**. In **Analysis → Operations**, **Filter** keeps rows or values that match a condition, such as `0 < value <= 10`. Use **Filter Rows** to keep a range by row number. The first row is 1 and both ends are included. Enter `1:100` for the first 100 rows or `100:end` for row 100 through the last row.

1. Drag a recorded step to change the execution order. Right-click a step to edit its options or move it earlier or later.
2. Select **Run all** to rerun the workflow in order. Select **Run next** from the dropdown to run the first queued or stale step.
3. Use **Edit → Settings → Workflow** to turn off automatic execution and queue new steps for manual execution.

When you edit or move a step, Nigiro marks affected results as stale. If a step uses an output from another step, put the producer first. A project saved before this feature supplies the starting point for new steps.

## Calculate a column with a formula

1. Open **Analysis → Operations → Column Formula**. Select the worksheet and the column to calculate.
2. In **Configuration**, enter a formula. Use `value` for each value in the selected column. Use **Insert reference** to select a column from any available source.
3. Select **Calculate column**. Nigiro creates a new worksheet with the calculated column and the other columns from the selected source.

For background correction, enter `$Data1:Current - $Data2:Current`. Nigiro matches rows by position, so both columns must have the same row count. `#` also works in a source reference. Use quotes for a source or column name with spaces or punctuation, for example `$"Test data.csv":"Current (A)"`.

Use **File → Add Variable** to enter a named constant. If the source holds one value, refer to it by name alone. For example, enter `$Data1:Voltage - $Data1:Current * $SolResistance`. Nigiro uses the same resistance for each row. An explicitly selected column with one row also acts as a constant. Python exports write values entered with **Add Variable** as numeric parameters.

Formulas support arithmetic, including `^` or `**` for powers, and math functions including `abs`, `sqrt`, `log`, `log10`, `exp`, `sin`, `cos`, `tan`, `min`, and `max`. Edit a formula or a scalar value under **Recorded Steps**, then rerun the workflow to update its results.

## Install a plugin

1. Download a Nigiro plugin as a `.py` file.
2. Select **Plugins → Install Python Plugin**. Select the downloaded file and check the trust prompt.
3. Open a worksheet. Select the plugin from **Plot** or **Analysis** and set its options.

Linear Fit, Scatter, Line, and Bar ship with Nigiro. Use **Plugin settings** in the **Analysis** panel to edit the current plugin's options. Save the project to record the options and plugin version. Install the same plugin file on another machine to reopen a project that uses it.

## Write a plugin

Use the [Scaled XY example](examples/plugins/scaled_xy.py) as a template. Define a literal `PLUGIN` dictionary at the top of a UTF-8 Python file. Give it an `id`, a `name`, a `version` string, `api: 1`, and a `menu` of `plot` or `analysis`.

Define the plugin's `fields` as a list of controls. Each control has a `key`, `label`, `type`, and `default`. The available types are `column`, `columns`, `number`, `text`, `boolean`, and `choice`. A `columns` control lets the user select multiple columns from one source. It passes a list of zero-based indices to the plugin. Use an empty list as the default to start with no selections. Number fields accept optional `min` and `max`. Choice fields take a `choices` list with a text `value` and `label` for each choice. Set `distinct_columns` to `True` to require different columns.

Set the optional `outputs` field to a list of labels, such as `["Fit figure", "Coefficients table"]`. Nigiro shows these labels on the **Output** tab.

Set the optional `description` field to Markdown text for the **Help** tab. Use `$...$` for inline equations.
For a display equation, put `$$` on separate lines above and below the equation. Use a raw Python string
(`r"""..."""`) to preserve LaTeX backslashes. Project Notes preview supports the same Markdown math.

Define `run(columns, rows, options)`. Nigiro passes the column names, corrected worksheet rows, and selected options. Column indices start at zero. Return a dictionary with a `traces` list of Plotly trace dictionaries. The desktop renderer supports `scatter`, `bar`, and `pie`. You can also return `layout`, `x_label`, `y_label`, and a `summary` of name-value pairs. Use JSON-compatible values.

Return `sources` to create output tables. Map each stable key, such as `fitted`, to a dictionary with `name`, `columns`, and `rows`. Nigiro makes the tables available as sources for later runs. An analysis plugin with a summary and no explicit tables supplies a results table.

Use `elements` to give each trace a style role. Set each role to `"observations"`, `"fit"`, or `None`. Use `residual_panel: True` for a residual panel with traces on `x2` and `y2`. Use `categorical_x: True` for bar positions with labels supplied in `layout.xaxis`. Nigiro applies any plugin layout overrides to its figure layout.

Install plugins as single files. The desktop worker supplies bundled modules such as NumPy and SciPy. A Python export includes the active plugin code and the current figure settings.

Declare extra packages in the optional `dependencies` field, for example `"dependencies": ["scipy>=1.10"]`. Install the required packages in the Python environment you select in Nigiro. When the plugin runs, Nigiro records the installed versions of its declared packages and their dependencies.

### Source outputs and joint inputs

Set `"table_only": True` in the plugin manifest to create Sources. Return a `sources` dictionary. The plugin can omit `traces`.

Set `"input_mode": "joint"` to receive named inputs together. Each column field lets the user select a source and a column. Define `run(columns, rows, options, inputs)` for this mode. The `inputs` dictionary uses each column field key. Each entry contains `columns`, `rows`, and the selected zero-based `column` index. In this mode, use those bindings to access the data. For example, use `inputs["reference_x"]` for the source and column bound to `reference_x`. In batch mode, the three-argument plugin runs separately for each selected source.

## Analysis tools

- Use **Align / Resample XY** to put two traces on a shared X grid. Select the X and Y columns for each trace. The result covers their shared X range.
- Under **Signal Processing**, use **FFT Spectrum** for a one-sided amplitude spectrum. Use **Filter Signal** for Butterworth band-stop, notch, or harmonic filtering. Supply a sampling rate or a time column in seconds.
- **Linear Fit** has a **Force fit through zero** option. **Nonlinear Curve Fit** offers named functions and custom expressions. Enter a guess and limits for each parameter, or leave them blank to use the model defaults. Both tools create a fit figure, a residuals figure, and result tables.
- Under **Analysis**, **Integrate Peak** measures the area between a signal and its baseline over the selected X range.
- Under **Electrochemistry**, **Filter Segments** detects sweeps from a potential column and keeps the rows you select. It can also use an existing segment column. **Detect CV Segments** adds segment and direction columns for inspection. **Find CV Peaks**, **iR Correction**, **Estimate Onset Potential**, and **Tafel Analysis (Irreversible)** use selected data columns. For Tafel analysis, enter the potential limits of the linear region.

### Fit an impedance spectrum

1. Open **Analysis → Electrochemistry → EIS Fit**.
2. Map frequency in Hz and the real and imaginary impedance columns in ohms.
3. Under **Configuration**, choose whether the file stores Z″ or −Z″.
4. Select **Edit Circuit**. Select an element to edit its parameters. Use **Add in series** or **Add in parallel** to connect a new element to the selection.
5. Select **Apply circuit**, then **Run analysis**.

Nigiro creates a Nyquist figure and Sources for the fit parameters, fitted spectrum, and residuals. The spectrum table also contains magnitude and phase for Bode plots. Enable **Include Lin-KK validation** to add its residual table and metrics.

The circuit is saved with the recorded step. Open **Edit Step** to change it and rerun the workflow. Python export includes the circuit and pins the impydance version that ran the fit.

## Edit the figure

Use **Figure settings** in the Figure panel. Double-click an axis label to open its settings. Choose **Figure**, **X axis**, or **Y axis**. Residual figures use the regular Y-axis settings.

Enter sizes with units, such as `9 pt`, `8 cm`, or `400 px`. Bare numbers use pixels. Supported lengths are `px`, `pt`, `cm`, `mm`, `in`, `pc`, and `q`, using 96 pixels per inch. Angles accept `deg`, `°`, `rad`, or `turn`, with degrees as the default. The selected units are saved with the figure and global defaults.

- Set the title and canvas in **Figure**. Use **Legend** for position, background, and frame. Use **Traces** for markers, lines, bars, and the overlay color cycle, and **Figure** for title typography and the default text color. Set **Text renderer** to **Plain text** to use the selected system font. In **Auto**, wrap math in dollar signs. For example, enter `$i$ (A)` to show italic i followed by the unit.
- In **Text**, choose a TeX font or enter definitions in the **TeX preamble**. For example, define `\def\conc{c_{0}}`, then use `$\conc$` in a label.
- Set **Axes width** and **Axes height** in **Figure**. Leave either field blank for **Auto**. A set dimension stays fixed when you resize the window. Labels and margins sit outside the axes area.
- Set labels, scales, limits, ticks, axis line width, and hover rulers in **Axes**. The **Label** and **Ticks** groups each have their own font and text renderer. The tick renderer applies to custom tick text, such as bar categories. Use **Configure axes separately** to edit each axis. Otherwise, **Global** applies to every axis in the figure. Choose plain numbers, SI prefixes, or a shared scientific exponent for numeric ticks. Leave a limit blank for automatic scaling.
- Select **Apply** to update the figure. Save the project to keep its settings.

Select a line and use **Show in legend** and **Legend desc.** in **Inspect**. Select **Apply** or press **Enter** to save both fields as one recorded step. In **Auto**, selecting **Show in legend** can display the legend for a single line. Use **Figure settings → Legend → Position** to hide the entire legend. Legend descriptions use the figure’s text renderer. **Auto** prefers inline math for `$…$` and `$$…$$`.

Use the same color picker in **Inspect** and **Figure settings**. Choose a swatch, enter a hex color, or choose **Transparent**. For new desktop color controls, reuse [`ColorField`](frontend/ColorField.tsx). Pass `opaque` only for settings that require a solid color, such as the UI accent.

The defaults use a white background, dark axes, outward ticks, and no grid. Nigiro supplies DejaVu Sans. For another font, install the same font on each machine that renders the figure.

## Export a figure

Select **File → Export Figure** and choose PNG or PDF. PNG scale increases the pixel count without changing the layout. PDF keeps vector lines and embeds the figure font. Both formats use the current figure size and zoom.

## Replay a figure

Select **File → Export Python Script** and choose the default figure format. The script records the original CSV paths, operations, and figure settings. Select **Copy raw CSV files beside the script** to export the original data as separate files in `imports/`. Keep any `imports/`, `fonts/`, `assets/`, and `plugins/` folders beside the script when you move it. Use the copy option for inputs without an original path, such as sample data. Install Chromium once to render the figure.

The script keeps its inputs and figure settings near the top. It loads Plotly and the default font from pinned Python packages.

For plugins with declared dependencies, the export puts replay scripts with exact package pins in `plugins/`. When the main script reaches one of these steps, uv runs its replay script in an isolated environment.

Run all recorded steps before you export a Python script. The script starts with the original CSV data and reruns analysis plugins to regenerate derived sources and the selected figure.

```sh
uvx --from playwright==1.65.1 playwright install chromium
uv run ./figure.py
```

The script writes a PNG or PDF beside the script. Use `--format png --scale 3` to select a PNG at three times the preview resolution. Use `--output` to change the output path. Use `--browser-executable` to select an installed Chromium or Chrome.

## Arrange panels

Drag a panel tab to the edge of another panel to place them beside or above each other. Drag it onto another tab bar to group the panels. Drag the divider between panels to resize them.

Select the collapse button on the right side of a panel header. Select the panel icon in the left sidebar to restore it.

Nigiro saves the layout on this machine. Use **Reset panel layout** at the bottom of the sidebar to return to the default layout.

## Project files

A `.nigiro` file is a ZIP archive with one versioned JSON manifest for the project and its recorded workflow. The archive stores each distinct CSV once, even when several workflow runs reuse it. The manifest keeps source names, derived tables, figure settings, and plugin versions. Nigiro checks the CSV checksums when it opens a project.

This alpha release opens project format version 3. To open an earlier project archive, use the Nigiro version that saved it.

## Tests and Qt editor

Use the optional `qt` extra to run the tests for both editors.

```sh
uv run --locked --extra qt python -m unittest discover -s tests -v
npm run build
```

To open the original Qt editor, run `uv run --locked --extra qt python -m nigiro`.

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
