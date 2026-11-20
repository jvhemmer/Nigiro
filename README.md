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

1. Select **File → Try Sample Data**. To import your own data, select **File → Import CSV**. Use a comma-separated UTF-8 file with a header row.
2. Choose the X and Y columns in the **Analysis** panel. Select **Analysis → Linear Fit** in the menu bar.
3. Select a point or the fit line, then apply a color in **Figure element**.
4. Double-click a value in **Working data** and press Enter to apply the edit.
5. Select **File → Save** to save the project.

The fit excludes rows with a blank X or Y value and reports how many it excluded. Other invalid values produce an error with the row number.

## Plot columns

Select **Plot → Scatter**, **Line**, or **Bar**. Choose one X column and one Y column, then select **Create plot**. Scatter and line plots use numeric X and Y values. Bar plots use the X column as labels.

The new plot becomes the active figure. Nigiro records the plot type and column choices in the project and redraws the figure after worksheet edits.

## Edit the figure

Open **Plot → Figure Settings**. Double-click an axis label to open its settings. Choose **Figure**, **X axis**, **Y axis**, or **Residual Y axis** on a linear fit.

- Set the title, font, legend position, and trace appearance in **Figure**.
- Set labels, scales, limits, ticks, axis lines, and hover rulers in the axis settings. Leave a limit blank for automatic scaling.
- Select **Apply** to update the figure. Save the project to keep its settings.

The defaults use a white background, dark axes, outward ticks, and no grid. Nigiro supplies DejaVu Sans. For another font, install the same font on each machine that renders the figure.

## Export a figure

Select **File → Export Figure** and choose PNG or PDF. PNG scale increases the pixel count without changing the layout. PDF keeps vector lines and embeds the figure font. Both formats use the current figure size and zoom.

## Replay a figure

Select **File → Export Python Script** and choose the default figure format. The script includes the original worksheet values, operations, and figure settings. Install Chromium once so the script can render the figure in the background.

The script keeps its inputs and figure settings near the top. It loads Plotly and the default font from pinned Python packages.

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

A `.nigiro` file is a ZIP archive with the original CSV bytes and a versioned JSON manifest. The manifest stores a checksum, import settings, corrections, fit settings, figure colors, and software versions. Nigiro checks the checksum and replays the operations when it opens a project.

## Tests and Qt editor

Use the optional `qt` extra to run the tests for both editors.

```sh
uv run --locked --extra qt python -m unittest discover -s tests -v
npm run build
```

To open the original Qt editor, run `uv run --locked --extra qt python -m nigiro`.

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
