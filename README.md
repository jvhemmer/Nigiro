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

1. Select **Try sample data** or import a comma-separated UTF-8 CSV with a header row.
2. Choose the X and Y columns and run the linear fit.
3. Select a point or the fit line, then apply a color in **Figure element**.
4. Double-click a value in **Working data** and press Enter to apply the edit.
5. Save the project or export the figure as SVG or PDF.

The fit excludes rows with a blank X or Y value and reports how many it excluded. Other invalid values produce an error with the row number.

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
