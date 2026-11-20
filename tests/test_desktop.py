"""Check project replay and vector export through the desktop worker protocol."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from nigiro.storage import load_project


CSV = "Time,Signal µ\r\n0,1\r\n1,4\r\n2,5\r\n3,7\r\n".encode()


class DesktopWorkerTest(unittest.TestCase):
    def run_worker(self, *requests: dict, plugins: Path | None = None) -> list[dict]:
        engine = os.environ.get("NIGIRO_TEST_ENGINE")
        command = [engine] if engine else [sys.executable, "-m", "nigiro.desktop"]
        result = subprocess.run(
            command,
            input="".join(json.dumps(request, ensure_ascii=False) + "\n" for request in requests),
            capture_output=True,
            encoding="utf-8",
            timeout=45,
            env={**os.environ, "NIGIRO_PLUGIN_DIR": str(plugins)} if plugins else None,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(replies), len(requests))
        return replies

    def test_plugin_options_and_code_are_pinned_to_the_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugins = root / "installed"
            marker = root / "ran"
            download = root / "scaled_xy.py"
            example = Path(__file__).resolve().parents[1] / "examples" / "plugins" / "scaled_xy.py"
            download.write_text(
                example.read_text(encoding="utf-8")
                + f"\nfrom pathlib import Path\nPath({str(marker)!r}).touch()\n",
                encoding="utf-8",
            )
            installed, = self.run_worker({"action": "install_plugin", "path": str(download)}, plugins=plugins)
            self.assertFalse(marker.exists())
            (definition,) = [plugin for plugin in installed["state"]["plugins"] if plugin["id"] == "example.scaled_xy"]
            options = {field["key"]: field["default"] for field in definition["fields"]}
            request = {
                "action": "run_plugin", "plugin_id": definition["id"], "version": definition["version"],
                "checksum": definition["checksum"], "options": options,
            }
            saved = root / "saved.nigiro"
            _, result, rejected, _, after, _ = self.run_worker(
                {"action": "sample"}, request,
                {**request, "options": {**options, "factor": "two"}},
                {"action": "figure_style", "style": {"title": "Scaled result"}},
                {**request, "figure_id": 0, "options": {**options, "factor": 3}},
                {"action": "save", "path": str(saved)},
                plugins=plugins,
            )
            self.assertTrue(marker.exists())
            self.assertEqual(result["state"]["project"]["figure"]["traces"][0]["y"][0], 2)
            self.assertIn("Y multiplier", rejected["error"])
            self.assertEqual(after["state"]["project"]["figure_style"]["title"], "Scaled result")
            self.assertEqual(after["state"]["project"]["figure"]["traces"][0]["y"][0], 3)
            marker.unlink()
            download.unlink()

            opened, = self.run_worker({"action": "open", "path": str(saved)}, plugins=root / "empty")
            self.assertIsNone(opened["state"]["project"]["figure"])
            self.assertIn("Install the original example.scaled_xy", opened["state"]["project"]["figure_error"])
            self.assertFalse(marker.exists())
            with ZipFile(saved) as archive:
                self.assertEqual(set(archive.namelist()), {"manifest.json", "source.csv"})
            download.write_text(
                example.read_text(encoding="utf-8").replace('"version": "1"', '"version": "2"'),
                encoding="utf-8",
            )
            updated, replayed = self.run_worker(
                {"action": "install_plugin", "path": str(download)},
                {"action": "open", "path": str(saved)},
                plugins=plugins,
            )
            self.assertEqual(updated["state"]["plugins"][-1]["version"], "2")
            self.assertEqual(replayed["state"]["project"]["figure"], after["state"]["project"]["figure"])
            self.assertTrue(marker.exists())

    def test_worker_replays_genuine_project_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "trial µ.csv"
            source.write_bytes(CSV)
            project = source.with_suffix(".nigiro")
            svg = source.with_suffix(".svg")
            pdf = source.with_suffix(".pdf")

            imported, fitted, rejected, colored, corrected, saved = self.run_worker(
                {"action": "import_csv", "path": str(source)},
                {"action": "fit", "x": 0, "y": 1},
                {"action": "fit", "x": 1, "y": 1},
                {"action": "color", "element": "fit", "color": "#9a1482"},
                {"action": "correct", "row": 1, "column": 1, "value": "3"},
                {"action": "save", "path": str(project)},
            )
            self.assertEqual(imported["state"]["project"]["source_name"], source.name)
            self.assertAlmostEqual(fitted["state"]["project"]["fit"]["slope"], 1.9)
            self.assertIn("different X and Y", rejected["error"])
            self.assertAlmostEqual(colored["state"]["project"]["fit"]["slope"], 1.9)
            self.assertAlmostEqual(corrected["state"]["project"]["fit"]["slope"], 2)
            self.assertFalse(saved["state"]["project"]["dirty"])

            self.assertEqual(source.read_bytes(), CSV)
            source.unlink()
            with ZipFile(project) as archive:
                self.assertEqual(archive.read("source.csv"), CSV)
            self.assertEqual(load_project(project).worksheet.rows[1][1], "3")

            opened, exported_svg, exported_pdf = self.run_worker(
                {"action": "open", "path": str(project)},
                {"action": "export", "path": str(svg)},
                {"action": "export", "path": str(pdf)},
            )
            state = opened["state"]["project"]
            self.assertEqual(state["original_rows"][1][1], "4")
            self.assertEqual(state["rows"][1][1], "3")
            self.assertAlmostEqual(state["fit"]["slope"], 2)
            self.assertEqual(
                [step["kind"] for step in state["operations"]],
                ["linear_fit", "figure_color", "correct_cell"],
            )
            self.assertEqual(exported_svg["state"], opened["state"])
            self.assertEqual(exported_pdf["state"], opened["state"])
            self.assertIn("#9a1482", svg.read_text())
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF-"))

    def test_figure_settings_follow_the_saved_plot_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "styled.nigiro"
            style = {
                "title": "Signal < 10 µV",
                "line_width": 1.25,
                "x": {"label": "Time (s)", "lower": 0, "upper": 6, "step": 2, "mirror": True},
            }
            _, original, styled, rejected, saved = self.run_worker(
                {"action": "sample"},
                {"action": "fit", "x": 0, "y": 1},
                {"action": "figure_style", "style": style},
                {"action": "figure_style", "style": {"x": {"scale": "log", "lower": -1}}},
                {"action": "save", "path": str(path)},
            )
            original = original["state"]["project"]
            styled = styled["state"]["project"]
            self.assertIn("positive", rejected["error"])
            self.assertEqual(styled["fit"], original["fit"])
            self.assertEqual(styled["rows"], original["rows"])
            self.assertEqual(styled["figure_style"]["x"]["step"], 2)
            self.assertEqual(saved["state"]["project"]["figure_style"], styled["figure_style"])

            reopened, new_plot = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "plot", "plot_type": "line", "x": 0, "y": 1},
            )
            self.assertEqual(reopened["state"]["project"]["figure_style"], styled["figure_style"])
            self.assertEqual(new_plot["state"]["project"]["figure_style"], original["figure_style"])

    def test_figures_and_derived_sources_round_trip_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "multiple.nigiro"
            _, scatter, _, fit, coefficients, _, derived, earlier, saved = self.run_worker(
                {"action": "sample"},
                {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1},
                {"action": "figure_style", "figure_id": 0, "style": {"axes_width": 400, "axes_height": 250}},
                {"action": "fit", "x": 0, "y": 1},
                {"action": "select_source", "source_id": "2:coefficients"},
                {"action": "select_source", "source_id": "2:fitted"},
                {
                    "action": "run_plugin", "plugin_id": "nigiro.line", "version": "1",
                    "checksum": None, "options": {"x": 0, "y": 2},
                },
                {"action": "select_figure", "figure_id": 0},
                {"action": "save", "path": str(path)},
            )
            scatter = scatter["state"]["project"]
            fit = fit["state"]["project"]
            coefficients = coefficients["state"]["project"]
            derived = derived["state"]["project"]
            earlier = earlier["state"]["project"]
            self.assertEqual(len(fit["figures"]), 2)
            self.assertEqual(coefficients["source_table"]["columns"][:2], ["Slope", "Intercept"])
            self.assertAlmostEqual(float(coefficients["source_table"]["rows"][0][0]), fit["fit"]["slope"])
            self.assertEqual(derived["figure"]["recipe"]["source_id"], "2:fitted")
            self.assertEqual(derived["figure"]["traces"][0]["y"], fit["fit"]["fitted"])
            self.assertEqual(earlier["figure"], scatter["figure"])
            self.assertEqual(earlier["figure_style"]["axes_width"], 400)
            self.assertEqual(earlier["source_id"], "2:fitted")
            self.assertFalse(saved["state"]["project"]["dirty"])
            with ZipFile(path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
            self.assertIn("2:fitted", manifest["derived_sources"])
            opened, corrected, earlier = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "correct", "row": 0, "column": 1, "value": "12"},
                {"action": "select_figure", "figure_id": 0},
            )
            self.assertEqual(opened["state"]["project"]["figures"], derived["figures"])
            self.assertEqual(opened["state"]["project"]["figure"]["traces"], derived["figure"]["traces"])
            self.assertNotEqual(corrected["state"]["project"]["figure"]["traces"], derived["figure"]["traces"])
            self.assertEqual(earlier["state"]["project"]["figure_style"]["axes_height"], 250)

    def test_plot_replays_selected_columns_after_worksheet_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "measurements.csv"
            raw = b"Time,Signal,Group\n0,1,A\n1,3,A\n2,5,B\n3,,C\n"
            source.write_bytes(raw)
            project = source.with_suffix(".nigiro")
            svg = source.with_suffix(".svg")
            pdf = source.with_suffix(".pdf")
            _, fitted, scatter, line, invalid, bar, edited, saved = self.run_worker(
                {"action": "import_csv", "path": str(source)},
                {"action": "fit", "x": 0, "y": 1},
                {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1},
                {"action": "plot", "plot_type": "line", "x": 1, "y": 0},
                {"action": "plot", "plot_type": "line", "x": 2, "y": 1},
                {"action": "plot", "plot_type": "bar", "x": 2, "y": 1},
                {"action": "correct", "row": 1, "column": 1, "value": "9"},
                {"action": "save", "path": str(project)},
            )
            self.assertEqual(fitted["state"]["project"]["fit"]["slope"], 2)
            self.assertIsNone(scatter["state"]["project"]["fit"])
            self.assertEqual(scatter["state"]["project"]["plot"]["omitted_rows"], 1)
            self.assertEqual(line["state"]["project"]["plot"]["x_values"], [1, 3, 5])
            self.assertIn("row 1", invalid["error"])
            self.assertEqual(bar["state"]["project"]["plot"]["x_values"], ["A", "A", "B"])
            self.assertEqual(edited["state"]["project"]["plot"]["y_values"], [1, 9, 5])
            self.assertFalse(saved["state"]["project"]["dirty"])
            self.assertEqual(source.read_bytes(), raw)
            source.unlink()

            reopened, exported_svg, exported_pdf = self.run_worker(
                {"action": "open", "path": str(project)},
                {"action": "export", "path": str(svg)},
                {"action": "export", "path": str(pdf)},
            )
            self.assertEqual(reopened["state"]["project"]["plot"], edited["state"]["project"]["plot"])
            self.assertIn("state", exported_svg)
            self.assertIn("state", exported_pdf)
            self.assertIn("<svg", svg.read_text())
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF-"))
            with ZipFile(project) as archive:
                self.assertEqual(archive.read("source.csv"), raw)
