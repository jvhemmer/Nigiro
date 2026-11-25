"""Check project replay and vector export through the desktop worker protocol."""

import hashlib
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
                manifest = json.loads(archive.read("manifest.json"))
                source = manifest["project"]["sources"][0]
                self.assertEqual(manifest["workflow"]["steps"][0]["inputs"][0], source)
                self.assertEqual(set(archive.namelist()), {"manifest.json", f"sources/{source['sha256']}.csv"})
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
                {"action": "import_data", "paths": [str(source)]},
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
                self.assertEqual(archive.read(f"sources/{hashlib.sha256(CSV).hexdigest()}.csv"), CSV)
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
            self.assertEqual([entry["name"] for entry in fit["figures"]], ["Scatter 1", "Linear Fit 1"])
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
            self.assertIn("2:fitted", manifest["project"]["derived_sources"])
            opened, corrected, earlier = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "correct", "row": 0, "column": 1, "value": "12"},
                {"action": "select_figure", "figure_id": 0},
            )
            self.assertEqual(opened["state"]["project"]["figures"], derived["figures"])
            self.assertEqual(opened["state"]["project"]["figure"]["traces"], derived["figure"]["traces"])
            self.assertNotEqual(corrected["state"]["project"]["figure"]["traces"], derived["figure"]["traces"])
            self.assertEqual(earlier["state"]["project"]["figure_style"]["axes_height"], 250)

    def test_linear_fit_plugin_creates_linked_figures(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fit.nigiro"
            fit = {
                "action": "run_plugin", "plugin_id": "nigiro.linear_fit",
                "version": "1", "checksum": None, "options": {"x": 0, "y": 1},
            }
            _, primary, residuals, _, updated, _ = self.run_worker(
                {"action": "sample"}, fit,
                {"action": "select_figure", "figure_id": 1},
                {"action": "figure_style", "figure_id": 1, "style": {"title": "Fit error"}},
                {**fit, "figure_id": 1, "options": {"x": 1, "y": 0}},
                {"action": "save", "path": str(path)},
            )
            primary, residuals, updated = (reply["state"]["project"] for reply in (primary, residuals, updated))
            self.assertEqual([entry["name"] for entry in primary["figures"]], ["Linear Fit 1", "Residuals · Linear Fit 1"])
            self.assertEqual(len(primary["figure"]["traces"]), 2)
            self.assertEqual(residuals["figure"]["y_label"], "Residual")
            self.assertEqual(len(residuals["figure"]["traces"]), 1)
            self.assertTrue(residuals["figure_style"]["y"]["zero_line"])
            self.assertEqual(updated["figure_id"], 1)
            self.assertEqual(updated["figure_style"]["title"], "Fit error")
            self.assertNotEqual(updated["figure"]["traces"], residuals["figure"]["traces"])
            self.assertEqual(len(updated["sources"]), 3)

            reopened, selected, next_fit = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "select_figure", "figure_id": 1},
                fit,
            )
            self.assertEqual(reopened["state"]["project"]["figure_id"], 0)
            self.assertEqual(selected["state"]["project"]["figure"], updated["figure"])
            self.assertEqual(
                [entry["name"] for entry in next_fit["state"]["project"]["figures"]][-2:],
                ["Linear Fit 2", "Residuals · Linear Fit 2"],
            )

    def test_item_edits_keep_raw_data_and_analysis_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edited.nigiro"

            def edit(kind, item_id, name):
                return {"action": "edit_item", "item": {"kind": kind, "id": item_id}, "name": name}

            _, original, _, _, derived, renamed, _, raw_rejected, removed_source, removed_figure, _, _ = self.run_worker(
                {"action": "sample"},
                {
                    "action": "run_plugin", "plugin_id": "nigiro.linear_fit", "version": "1",
                    "checksum": None, "options": {"x": 0, "y": 1},
                },
                edit("source", None, "Measurements"),
                {"action": "select_source", "source_id": "0:fitted"},
                {
                    "action": "run_plugin", "plugin_id": "nigiro.line", "version": "1",
                    "checksum": None, "options": {"x": 0, "y": 2},
                },
                edit("figure", 0, "Calibration"),
                edit("source", "0:coefficients", "Parameters"),
                edit("source", None, None),
                edit("source", "0:fitted", None),
                edit("figure", 0, None),
                {"action": "select_figure", "figure_id": 0},
                {"action": "save", "path": str(path)},
            )
            original, derived, renamed, removed_source, removed_figure = (
                reply["state"]["project"] for reply in (original, derived, renamed, removed_source, removed_figure)
            )
            self.assertIn("imported source", raw_rejected["error"])
            self.assertEqual(renamed["figure_id"], derived["figure_id"])
            self.assertEqual(renamed["figures"][0]["name"], "Calibration")
            self.assertIsNone(removed_source["source_id"])
            self.assertEqual(removed_figure["figures"][0]["name"], "Residuals · Calibration")
            self.assertEqual(removed_figure["figure"]["traces"], derived["figure"]["traces"])
            self.assertEqual([item["name"] for item in removed_figure["sources"]], ["Measurements", "Parameters"])
            self.assertEqual(removed_figure["original_rows"], original["original_rows"])
            self.assertEqual(load_project(path).source.name, original["source_name"])

            reopened, unavailable, residual = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "select_source", "source_id": "0:fitted"},
                edit("figure", derived["figure_id"], None),
            )
            self.assertEqual(reopened["state"]["project"]["figure"]["traces"], derived["figure"]["traces"])
            self.assertIn("available source", unavailable["error"])
            self.assertEqual(residual["state"]["project"]["figure_id"], 1)
            self.assertEqual(residual["state"]["project"]["figure"]["part"], "residual")

    def test_batch_uses_per_source_columns_and_keeps_original_csvs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / "first.csv", root / "second.csv"
            first.write_bytes(b"Time,Signal\r\n0,1\r\n1,3\r\n2,5\r\n")
            second.write_bytes(b"Reading,Ticks\n4,0\n7,1\n10,2\n")
            path = root / "batch.nigiro"
            scatter = {
                "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
                "runs": [
                    {"source_id": None, "options": {"x": 0, "y": 1}},
                    {"source_id": "raw:0", "options": {"x": 1, "y": 0}},
                ],
            }
            fit = {**scatter, "plugin_id": "nigiro.linear_fit"}
            bad = {**scatter, "runs": [scatter["runs"][0], {"source_id": "raw:0", "options": {"x": 0, "y": 0}}]}
            imported, _, _, overlaid, rejected, unchanged, separate, _ = self.run_worker(
                {"action": "import_data", "paths": [str(first), str(second)]},
                {"action": "select_source", "source_id": "raw:0"},
                {"action": "correct", "row": 0, "column": 0, "value": "5"},
                {"action": "run_batch", "output": "overlay", "steps": [scatter]},
                {"action": "run_batch", "output": "separate", "steps": [scatter, bad]},
                {"action": "state"},
                {"action": "run_batch", "output": "separate", "steps": [scatter, fit]},
                {"action": "save", "path": str(path)},
            )
            imported, overlaid, unchanged, separate = (
                reply["state"]["project"] for reply in (imported, overlaid, unchanged, separate)
            )
            self.assertEqual([source["columns"] for source in imported["sources"]], [["Time", "Signal"], ["Reading", "Ticks"]])
            self.assertEqual(overlaid["source_original_rows"][0], ["4", "0"])
            self.assertEqual(len(overlaid["figures"]), 1)
            traces = overlaid["figure"]["traces"]
            self.assertEqual([trace["name"] for trace in traces], ["first.csv", "second.csv"])
            self.assertEqual([trace["x"] for trace in traces], [[0, 1, 2], [0, 1, 2]])
            self.assertEqual([trace["y"] for trace in traces], [[1, 3, 5], [5, 7, 10]])
            self.assertIn("different", rejected["error"])
            self.assertEqual(unchanged, overlaid)
            self.assertEqual(len(separate["figures"]), 7)
            self.assertEqual(len(separate["sources"]), 6)
            with ZipFile(path) as archive:
                self.assertEqual(archive.read(f"sources/{hashlib.sha256(first.read_bytes()).hexdigest()}.csv"), first.read_bytes())
                self.assertEqual(archive.read(f"sources/{hashlib.sha256(second.read_bytes()).hexdigest()}.csv"), second.read_bytes())
            _, replayed = self.run_worker(
                {"action": "open", "path": str(path)},
                {"action": "select_figure", "figure_id": overlaid["figure_id"]},
            )
            self.assertEqual(replayed["state"]["project"]["figure"]["traces"], traces)

    def test_import_appends_and_new_clears_the_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv_path = root / "input.csv"
            csv_path.write_bytes(CSV)
            path = root / "workspace.nigiro"
            blank_path = root / "blank.nigiro"
            import_data = {"action": "import_data", "paths": [str(csv_path)]}
            empty, _, _, _, appended, cleared, _, reopened = self.run_worker(
                {"action": "state"},
                import_data,
                {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1},
                {"action": "save", "path": str(path)},
                import_data,
                {"action": "new"},
                {"action": "save", "path": str(blank_path)},
                {"action": "open", "path": str(blank_path)},
            )
            project = appended["state"]["project"]
            self.assertEqual(project["file_name"], path.name)
            self.assertEqual(len(project["sources"]), 2)
            self.assertEqual(len(project["figures"]), 1)
            for response in (empty, cleared, reopened):
                project = response["state"]["project"]
                self.assertEqual(project["sources"], [])
                self.assertEqual(project["figures"], [])
                self.assertFalse(project["dirty"])

    def test_plugin_outputs_can_append_to_existing_figures(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "layered.nigiro"
            run = {
                "action": "execute_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                "output": "overlay", "target_id": 0, "runs": [{"source_id": "raw:0", "options": {"x": 0, "y": 1}}],
            }
            _, original, _, imported, rejected, unchanged, appended, _, reloaded = self.run_worker(
                {"action": "sample"},
                {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1},
                {"action": "figure_style", "style": {"title": "Original title"}},
                {"action": "sample"},
                {**run, "plugin_id": "nigiro.bar"},
                {"action": "state"},
                run,
                {"action": "save", "path": str(path)},
                {"action": "open", "path": str(path)},
            )
            self.assertEqual(len(imported["state"]["project"]["sources"]), 2)
            self.assertIn("different types of X axes", rejected["error"])
            original = original["state"]["project"]
            appended = appended["state"]["project"]
            self.assertEqual(unchanged["state"]["project"], imported["state"]["project"])
            self.assertEqual(appended["figures"], original["figures"])
            self.assertEqual(appended["figure_style"]["title"], "Original title")
            self.assertEqual(appended["figure"]["traces"][0], original["figure"]["traces"][0])
            self.assertEqual(appended["figure"]["traces"][1]["mode"], "lines")
            self.assertEqual(reloaded["state"]["project"]["figure"], appended["figure"])

    def test_global_style_persists_and_new_figures_record_defaults(self):
        from unittest.mock import patch
        from nigiro.desktop import Workspace

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "settings.json"),
        }):
            worker = Workspace()
            defaults = worker.snapshot()["project"]["global_figure_style"]
            style = {**defaults, "label_size": 18, "line_width": 2.5,
                     "x": {**defaults["x"], "grid": True}}
            shared = {**style, "axes_separate": False, "global_axis": style["x"]}
            worker.dispatch({"action": "sample"})
            worker.dispatch({"action": "plot", "plot_type": "scatter", "x": 0, "y": 1})
            original = worker.snapshot()["project"]["figure_style"]
            worker.dispatch({"action": "set_global_style", "style": style})
            self.assertEqual(worker.snapshot()["project"]["figure_style"], original)
            worker.dispatch({"action": "plot", "plot_type": "line", "x": 0, "y": 1})
            self.assertEqual(worker.snapshot()["project"]["figure_style"], shared)
            path = Path(directory) / "styled.nigiro"
            worker.dispatch({"action": "save", "path": str(path)})
            restored = Workspace()
            self.assertEqual(restored.settings.figure_style.label_size, 18)
            restored.dispatch({"action": "set_global_style", "style": defaults})
            restored.dispatch({"action": "open", "path": str(path)})
            self.assertEqual(restored.snapshot()["project"]["figure_style"], shared)
            with self.assertRaises(ValueError):
                restored.dispatch({"action": "set_global_style", "style": {**style, "marker_size": -1}})
            self.assertEqual(restored.settings.figure_style.label_size, defaults["label_size"])

    def test_paged_transport_keeps_full_data_for_analysis_and_export(self):
        from nigiro.desktop import Workspace

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.csv"
            path.write_text("X,Y\n" + "".join(f"{index},{index * 2}\n" for index in range(10000)))
            worker = Workspace()
            first = worker.dispatch({"action": "import_data", "paths": [str(path)], "_paged": True})["project"]
            self.assertEqual(first["row_count"], 10000)
            self.assertEqual(len(first["rows"]), 100)
            self.assertEqual(len(first["original_rows"]), 100)
            page = worker.dispatch({"action": "worksheet_page", "offset": 100, "_paged": True})["project"]
            self.assertEqual(page["rows"][0], ("100", "200"))
            worker.dispatch({"action": "correct", "row": 100, "column": 1, "value": "201", "_paged": True})
            plotted = worker.dispatch({"action": "plot", "plot_type": "line", "x": 0, "y": 1, "_paged": True})["project"]
            self.assertEqual(len(plotted["figure"]["traces"][0]["y"]), 10000)
            self.assertEqual(plotted["figure"]["traces"][0]["y"][100], 201)
            cached = worker.dispatch({
                "action": "state", "_paged": True,
                "_known_figures": {str(plotted["figure_id"]): plotted["figure_token"]},
            })["project"]
            self.assertTrue(cached["figure_cached"])
            self.assertIsNone(cached["figure"])
            full = worker.dispatch({"action": "state"})["project"]
            self.assertEqual(len(full["original_rows"]), 10000)
            self.assertIsNotNone(full["figure"])
            changed = worker.dispatch({
                "action": "correct", "row": 100, "column": 1, "value": "202", "_paged": True,
                "_known_figures": {str(plotted["figure_id"]): plotted["figure_token"]},
            })["project"]
            self.assertFalse(changed["figure_cached"])
            self.assertEqual(changed["figure"]["traces"][0]["y"][100], 202)

    def test_plot_replays_selected_columns_after_worksheet_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "measurements.csv"
            raw = b"Time,Signal,Group\n0,1,A\n1,3,A\n2,5,B\n3,,C\n"
            source.write_bytes(raw)
            project = source.with_suffix(".nigiro")
            svg = source.with_suffix(".svg")
            pdf = source.with_suffix(".pdf")
            _, fitted, scatter, line, invalid, bar, edited, saved = self.run_worker(
                {"action": "import_data", "paths": [str(source)]},
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
                self.assertEqual(archive.read(f"sources/{hashlib.sha256(raw).hexdigest()}.csv"), raw)
