# Nigiro

Nigiro is a free, open-source desktop app for scientific plotting and reproducible analysis. The first workflow links a CSV, a working worksheet, a linear fit, and an editable figure.

## Run

Use Python 3.10 or newer. From this directory, create and activate a virtual environment, then install the app.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m nigiro
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1`.

## Try it

Save this sample as `trial.csv` and choose **File → Import CSV**.

```csv
Time,Signal
0,1
1,4
2,5
3,7
```

1. Choose **Time** for X and **Signal** for Y, then run the linear fit.
2. Click the fitted line to select it, then choose **Change color**. Double-clicking the line opens the color picker directly.
3. In the **Working worksheet**, double-click the second Signal value and change it from 4 to 3. The slope updates to 2 and the fit keeps its new color. The **Original CSV** tab still shows 4.
4. Save a `.nigiro` project and reopen it to replay the steps. Use **File → Export Figure** to save SVG or PDF.

This version supports comma-separated UTF-8 files with a header row and one active linear fit per project. The fit omits rows with a blank X or Y value and reports the number omitted. Other invalid X or Y values produce a worksheet row error.

## Project files

A `.nigiro` file is a ZIP archive with the exact imported CSV bytes and a versioned JSON manifest. The manifest records the source checksum, import settings, worksheet corrections, fit settings, figure colors, and software versions at save time. Nigiro verifies the checksum on open and derives the working worksheet and figure from the saved operations. The file is self-contained.

## Tests

```sh
python -m unittest discover -s tests -v
```

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
