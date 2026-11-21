# Nigiro

Nigiro is a free, open-source desktop app for scientific plotting and reproducible analysis. The editor links a CSV, a worksheet, a linear fit, and a figure.

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

## Try the editor

1. Select **File → Try Sample Data** or use **File → Import Data** to add one or more CSVs to the current project. Use comma-separated UTF-8 files with a header row. **File → New** starts an empty project.
2. Select **Analysis → Linear Fit**. Choose a source and its X and Y columns on **Inputs**, then select **Run analysis**.
3. Select a point or the fit line, then apply a color in **Figure element**.
4. Double-click a value in **Working data** and press Enter to apply the edit.
5. Select **File → Save** to save the project.

The fit excludes rows with a blank X or Y value and reports how many it excluded. Other invalid values produce an error with the row number.

Import and Open dialogs start in the current project's last import folder. If it is unavailable, Nigiro uses the last remembered import folder, including from a previous session. The project archive saves its import path.

## Plot columns

Select **Plot → Scatter**, **Line**, or **Bar**. Plots, analyses, and operations use the same input dialog. In **Inputs**, each source row shows its name, original path when available, and dimensions as rows × columns. Select the sources and columns there. With multiple sources, Nigiro matches column headers from the reference source. Use the mapping table to change the columns for any source. Scatter and line plots use numeric X and Y values. Bar plots use the X column as labels.

The **Configuration** tab contains the plugin's settings. The **Output** tab lists what the plugin produces and lets you create new figures or add traces to existing figures with compatible axes. For multiple sources, you can overlay the traces or use a separate figure for each source.

## Switch sources and figures

Open **Edit → Settings → Global Figure Settings** to set defaults for new figures. Settings persist across app restarts. Each value in an individual figure's settings has a save icon to make it the global default and a restore icon to copy the current global default into that figure. Select **Apply** to save changes to the figure.

In **Edit → Settings → Appearance**, choose **System**, **Light**, or **Dark** and an accent color, then select **Save settings**. System follows the operating system's color scheme. Expand or collapse **Global Figure Settings** in the left sidebar to show its figure and axis sections.

Use the tabs in **Worksheet** to switch between imported data and analysis results. Drag entries in **Sources** to change their display order. Select a source or click a plot trace to see its details in **Inspect**. The dockable **Sources** panel lists all sources. Select an entry to open it in **Worksheet**. Linear Fit creates separate tables for coefficients and fitted values. The fitted values table includes X, observed Y, fitted Y, and residuals.

Linear Fit produces a fit and a separate residual figure. Use the tabs in **Figure** to switch between them or return to any earlier figure. Each figure has its own appearance settings. For a fit from one source, **Plugin settings** updates its fit and residual figures.

Save the project to keep the figures, their settings, and the analysis tables. Nigiro recalculates linked results after a worksheet correction.

## Run recorded steps

Nigiro records imports, plots, analyses, and worksheet changes in **Recorded Steps**. Use **Analysis → Operations → Scalar multiplication** to scale a working column in each selected source without changing the imported CSV files. **Filter** creates a new source with matching rows or matching values from one column. For example, enter `0 < value <= 10` to keep values in that interval.

1. Drag a recorded step to change the execution order. Right-click a step to edit its options or move it earlier or later.
2. Select **Run all** to rerun the workflow in order. Select **Run next** from the dropdown to run the first queued or stale step.
3. Use **Edit → Settings → Workflow** to turn off automatic execution and queue new steps for manual execution.

When you edit or move a step, Nigiro marks affected results as stale. If a step uses an output from another step, put the producer first. A project saved before this feature supplies the starting point for new steps.

## Install a plugin

1. Download a Nigiro plugin as a `.py` file.
2. Select **Plugins → Install Python Plugin**. Select the downloaded file and check the trust prompt.
3. Open a worksheet. Select the plugin from **Plot** or **Analysis** and set its options.

Linear Fit, Scatter, Line, and Bar ship with Nigiro. Use **Plugin settings** in the **Analysis** panel to edit the current plugin's options. Save the project to record the options and plugin version. Install the same plugin file on another machine to reopen a project that uses it.

## Write a plugin

Use the [Scaled XY example](examples/plugins/scaled_xy.py) as a template. Define a literal `PLUGIN` dictionary at the top of a UTF-8 Python file. Give it an `id`, a `name`, a `version` string, `api: 1`, and a `menu` of `plot` or `analysis`.

Define the plugin's `fields` as a list of controls. Each control has a `key`, `label`, `type`, and `default`. The available types are `column`, `number`, `text`, `boolean`, and `choice`. Number fields accept optional `min` and `max`. Choice fields take a `choices` list with a text `value` and `label` for each choice. Set `distinct_columns` to `True` to require different columns.

Set the optional `outputs` field to a list of labels, such as `["Fit figure", "Coefficients table"]`. Nigiro shows these labels on the **Output** tab.

Define `run(columns, rows, options)`. Nigiro passes the column names, corrected worksheet rows, and selected options. Column indices start at zero. Return a dictionary with a `traces` list of Plotly trace dictionaries. The desktop renderer supports `scatter`, `bar`, and `pie`. You can also return `layout`, `x_label`, `y_label`, and a `summary` of name-value pairs. Use JSON-compatible values.

Return `sources` to create output tables. Map each stable key, such as `fitted`, to a dictionary with `name`, `columns`, and `rows`. Nigiro makes the tables available as sources for later runs. An analysis plugin with a summary and no explicit tables supplies a results table.

Use `elements` to give each trace a style role. Set each role to `"observations"`, `"fit"`, or `None`. Use `residual_panel: True` for a residual panel with traces on `x2` and `y2`. Use `categorical_x: True` for bar positions with labels supplied in `layout.xaxis`. Nigiro applies any plugin layout overrides to its figure layout.

Install plugins as single files. The desktop worker supplies bundled modules such as NumPy and SciPy. A Python export includes the active plugin code and the current figure settings.

## Edit the figure

Use **Figure settings** in the Figure panel. Double-click an axis label to open its settings. Choose **Figure**, **X axis**, or **Y axis**. Residual figures use the regular Y-axis settings.

Enter sizes with units, such as `9 pt`, `8 cm`, or `400 px`. Bare numbers use pixels. Supported lengths are `px`, `pt`, `cm`, `mm`, `in`, `pc`, and `q`, using 96 pixels per inch. Angles accept `deg`, `°`, `rad`, or `turn`, with degrees as the default. The selected units are saved with the figure and global defaults.

- Set the title and canvas in **Figure**. Use **Legend** for position, background, and frame. Use **Traces** for markers, lines, bars, and the overlay color cycle, and **Figure** for title typography and the default text color. Set **Text renderer** to **Plain text** to use the selected system font. In **Auto**, wrap math in dollar signs. For example, enter `$i$ (A)` to show italic i followed by the unit.
- In **Text**, choose a TeX font or enter definitions in the **TeX preamble**. For example, define `\def\conc{c_{0}}`, then use `$\conc$` in a label.
- Set **Axes width** and **Axes height** in **Figure**. Leave either field blank for **Auto**. A set dimension stays fixed when you resize the window. Labels and margins sit outside the axes area.
- Set labels, scales, limits, ticks, axis line width, and hover rulers in **Axes**. The **Label** and **Ticks** groups each have their own font and text renderer. The tick renderer applies to custom tick text, such as bar categories. Use **Configure axes separately** to edit each axis. Otherwise, **Global** applies to every axis in the figure. Choose plain numbers, SI prefixes, or a shared scientific exponent for numeric ticks. Leave a limit blank for automatic scaling.
- Select **Apply** to update the figure. Save the project to keep its settings.

The defaults use a white background, dark axes, outward ticks, and no grid. Nigiro supplies DejaVu Sans. For another font, install the same font on each machine that renders the figure.

## Export a figure

Select **File → Export Figure** and choose PNG or PDF. PNG scale increases the pixel count without changing the layout. PDF keeps vector lines and embeds the figure font. Both formats use the current figure size and zoom.

## Replay a figure

Select **File → Export Python Script** and choose the default figure format. The script includes the original worksheet values, operations, and figure settings. Install Chromium once so the script can render the figure in the background.

The script keeps its inputs and figure settings near the top. It loads Plotly and the default font from pinned Python packages.

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

A `.nigiro` file is a ZIP archive with the original CSV bytes and a versioned JSON manifest. The manifest stores derived tables and records each figure's settings, source, plugin version, checksum, and options. Nigiro checks the CSV checksum and replays the operations when it opens a project.

## Tests and Qt editor

Use the optional `qt` extra to run the tests for both editors.

```sh
uv run --locked --extra qt python -m unittest discover -s tests -v
npm run build
```

To open the original Qt editor, run `uv run --locked --extra qt python -m nigiro`.

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
