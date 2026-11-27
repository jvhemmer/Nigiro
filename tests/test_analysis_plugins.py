"""Check numerical plugin results and their recorded inputs and outputs."""

import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.special import expit

from nigiro.builtin_plugins import BUILTINS
from nigiro.desktop import Workspace
from nigiro.project import PluginStep, Project
from nigiro.source_tables import output_tables


def plugin_options(name, **changes):
    manifest, _ = BUILTINS[f"nigiro.{name}"]
    return {**{field["key"]: field["default"] for field in manifest["fields"]}, **changes}


def run_analysis(name, x, y, **changes):
    _, run = BUILTINS[f"nigiro.{name}"]
    return run(("X", "Y"), list(zip(map(str, x), map(str, y))), plugin_options(name, **changes))


class NumericalPluginsTest(unittest.TestCase):
    def test_linear_fit_force_zero_and_nonlinear_custom_model(self):
        x = np.linspace(0, 3, 41)
        linear = run_analysis("linear_fit", x, 2 + 3 * x, force_zero=True)
        self.assertEqual(linear["summary"]["Intercept"], 0)
        self.assertAlmostEqual(linear["summary"]["Slope"], np.dot(x, 2 + 3 * x) / np.dot(x, x))
        nonlinear = run_analysis("nonlinear_fit", x, 2 + 3 * np.exp(-1.2 * x), model="custom",
                                 guesses="2,, -1", lower="0,, -10", upper="inf,10,0")
        np.testing.assert_allclose([row[1] for row in nonlinear["sources"]["coefficients"]["rows"]], [2, 3, -1.2])
        with self.assertRaisesRegex(ValueError, "Use only"):
            run_analysis("nonlinear_fit", x, x, model="custom", expression="x.__class__")

    def test_fft_and_filter_modes(self):
        time = np.arange(5000) / 200
        values = 3.0 * np.sin(2 * np.pi * 10 * time)
        spectrum = run_analysis("fft", time, values)
        peak = max(spectrum["sources"]["spectrum"]["rows"], key=lambda row: row[1])
        self.assertAlmostEqual(peak[0], 10)
        self.assertAlmostEqual(peak[1], 3)
        for mode in ("bandstop", "notch", "harmonic"):
            with self.subTest(mode=mode):
                result = run_analysis("signal_filter", time, values, filter=mode, low=9, high=11,
                                      fundamental=10, half_width=1, harmonics=3)
                cleaned = [row[2] for row in result["sources"]["filtered"]["rows"]]
                self.assertLess(np.std(cleaned[600:-600]), 0.01)
        with self.assertRaisesRegex(ValueError, "sample spacing"):
            run_analysis("fft", [0, 1, 5, 6], [1, 3, 4, 6])

    def test_cv_segment_peak_area_and_ir(self):
        x = [0, 1, 2, 3, 3, 3, 2, 1, 0]
        current = [0, 1, 5, 1, 1, 1, -1, -4, -1]
        detected = run_analysis("detect_cv_segments", x, current)["sources"]["segments"]
        self.assertEqual([row[2] for row in detected["rows"]], [1] * 6 + [2] * 3)
        peaks = run_analysis("cv_peaks", x, current)["sources"]["peaks"]["rows"]
        self.assertEqual([(peak[0], peak[1], peak[4]) for peak in peaks], [(1, 3, "maxima"), (2, 8, "minima")])
        line = [0, 1, 2, 10]
        self.assertAlmostEqual(run_analysis("integrate_peak", line, line)["summary"]["Signed area"], 0)
        result = run_analysis("ir_correction", [100, 200], [2, -4], resistance=10,
                              current_units="mA", potential_units="mV")
        self.assertEqual([row[2] for row in result["sources"]["corrected"]["rows"]], [80, 240])

    def test_sigmoid_onset_and_irreversible_tafel(self):
        x = np.linspace(1, -1, 201)
        y = -8 * expit((-x - 0.2) / 0.12)
        onset = run_analysis("onset", x, y, fraction=5)["summary"]["Onset potential"]
        self.assertAlmostEqual(onset, -(0.2 + 0.12 * np.log(0.05 / 0.95)), places=6)
        density = np.geomspace(1e-3, 1e-1, 31)
        potential = 0.2 - 0.12 * np.log10(density / 1e-4)
        result = run_analysis("tafel", potential, -density, equilibrium=0.2, range="-1,0.2")
        self.assertAlmostEqual(result["summary"]["Slope (mV/dec)"], 120)
        self.assertAlmostEqual(result["summary"]["Exchange current density"], 1e-4)


class PluginContractTest(unittest.TestCase):
    def test_append_whole_sources_in_selection_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker = Workspace()
            for filename, content in (
                ("first.csv", "X,Y\n1,10\n2,20\n"),
                ("second.csv", "Y,X\n30,3\n40,4\n"),
                ("third.csv", "X,Y\n5,50\n6,60\n"),
                ("short.csv", "X,Z\n7,70\n"),
            ):
                path = root / filename
                path.write_text(content)
                worker.dispatch({"action": "import_data", "paths": [str(path)]})
            ids = {Path(source["original_path"]).stem: source["id"] for source in worker.snapshot()["project"]["sources"]}

            def submission(*names):
                return {"output": "separate", "target_id": None, "runs": [{
                    "source_id": ids[names[0]], "options": {}, "target_id": None,
                    "references": {f"source_{index}": {"source_id": ids[name], "column": None}
                                   for index, name in enumerate(names)},
                }]}

            def append(axis, *names):
                return worker.dispatch({"action": "execute_plugin", "plugin_id": f"nigiro.append_{axis}",
                                        "version": "1", "checksum": None, **submission(*names)})["project"]

            appended_rows = append("rows", "second", "first", "third")
            rows = worker.sources[appended_rows["source_id"]]
            self.assertEqual(rows.columns, ("Y", "X"))
            self.assertEqual(rows.rows, (("30", "3"), ("40", "4"), ("10", "1"), ("20", "2"), ("50", "5"), ("60", "6")))
            appended_columns = append("columns", "third", "second", "first")
            columns = worker.sources[appended_columns["source_id"]]
            self.assertEqual(columns.columns, ("X", "Y", "Y (2)", "X (2)", "X (3)", "Y (3)"))
            self.assertEqual(columns.rows[0], ("5", "50", "30", "3", "1", "10"))
            self.assertEqual(appended_columns["figures"], [])

            path = root / "append.nigiro"
            worker.dispatch({"action": "save", "path": str(path)})
            worker = Workspace()
            worker.dispatch({"action": "open", "path": str(path)})
            replay = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(worker.sources[appended_columns["source_id"]], columns)
            step_id = replay["workflow"]["steps"][-1]["id"]
            edit = worker.dispatch({"action": "plugin_step_inputs", "step_id": step_id})
            self.assertEqual(edit["submission"], submission("third", "second", "first"))
            worker.dispatch({"action": "edit_plugin_step", "step_id": step_id, "submission": submission("first", "third")})
            worker.dispatch({"action": "run_all"})
            self.assertEqual(worker.sources[appended_columns["source_id"]].rows[0], ("1", "10", "5", "50"))

            with self.assertRaisesRegex(ValueError, "same column names"):
                append("rows", "first", "short")
            with self.assertRaisesRegex(ValueError, "Expected 2"):
                append("columns", "first", "short")
            plotted = worker.dispatch({
                "action": "run_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                "source_id": appended_columns["source_id"], "options": {"x": 0, "y": 3},
            })["project"]["figure"]
            recipe = json.loads(json.dumps(worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"],
                                           sort_keys=True))
            replay_figure = runpy.run_path(str(Path(__file__).resolve().parents[1] / "frontend/replay.py"), init_globals={
                "BUILTINS": BUILTINS, "PluginStep": PluginStep, "Project": Project, "output_tables": output_tables,
                "REFERENCE_FORMULA_PLUGINS": set(),
            })["replay_figure"]
            exported = replay_figure(worker.project, {"traces": [{}], "layout": {}}, recipe)
            self.assertEqual(exported["traces"], plotted["traces"])

    def test_filter_potential_segments_keeps_columns_and_enables_peak_integration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cv.csv"
            potential = [-1.1, -1, -.9, -.8, -.7, -.6, -.7, -.8, -.9, -1, -1.1]
            current = [0, 0, 0, 0, 0, 0, -1, -3, -5, -1, 0]
            path.write_text("Time,Working Electrode (V),Current (A)\n" + "".join(
                f"{time},{x},{y}\n" for time, (x, y) in enumerate(zip(potential, current))
            ))
            with patch.dict(os.environ, {"NIGIRO_PLUGIN_DIR": str(root / "plugins")}):
                worker = Workspace()
                worker.dispatch({"action": "import_data", "paths": [str(path)]})

                def integrate(source_id, interval):
                    return worker.dispatch({
                        "action": "run_plugin", "plugin_id": "nigiro.integrate_peak", "version": "1",
                        "checksum": None, "source_id": source_id,
                        "options": plugin_options("integrate_peak", x=1, y=2, range=interval),
                    })

                with self.assertRaisesRegex(ValueError, r"Found 0 in 'Working Electrode \(V\)'\. This source spans -1.1 to -0.6"):
                    integrate(None, "-2,-1.5")
                with self.assertRaisesRegex(ValueError, "one monotonic sweep"):
                    integrate(None, "-1,-0.7")

                command = {
                    "action": "execute_plugin", "plugin_id": "nigiro.filter_segments", "version": "1",
                    "checksum": None, "output": "separate",
                    "runs": [{"source_id": None, "options": plugin_options("filter_segments", column=1, segments="2")}],
                }
                filtered = worker.dispatch(command)["project"]
                self.assertEqual(filtered["source_table"]["columns"], ("Time", "Working Electrode (V)", "Current (A)"))
                self.assertEqual([float(row[1]) for row in filtered["source_table"]["rows"]], potential[6:])
                result = integrate(filtered["source_id"], "-1,-0.7")["project"]
                self.assertAlmostEqual(result["figure"]["summary"]["Signed area"], .6)
                replay = worker.dispatch({"action": "run_all"})["project"]
                self.assertEqual(replay["figure"]["summary"], result["figure"]["summary"])

    def test_joint_table_can_feed_fit_after_reopening_and_rerunning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"NIGIRO_PLUGIN_DIR": str(root / "plugins")}):
                worker = Workspace()
                first, second = root / "a.csv", root / "b.csv"
                first.write_text("X,A\n0,1\n1,2\n2,3\n3,4\n")
                second.write_text("X,B\n1,10\n2,20\n3,30\n4,40\n")
                worker.dispatch({"action": "import_data", "paths": [str(first), str(second)]})
                reference = lambda source_id, column: {"source_id": source_id, "column": column}
                bindings = {"reference_x": reference(None, 0), "reference_y": reference(None, 1),
                            "target_x": reference("raw:0", 0), "target_y": reference("raw:0", 1)}
                result = worker.dispatch({
                    "action": "execute_plugin", "plugin_id": "nigiro.align_xy", "version": "1", "checksum": None,
                    "output": "separate", "target_id": None,
                    "runs": [{"source_id": None, "options": plugin_options("align_xy"), "references": bindings}],
                })["project"]
                self.assertEqual(result["figures"], [])
                self.assertEqual(worker.sources[result["source_id"]].rows, (
                    ("1.0", "2.0", "10.0"), ("2.0", "3.0", "20.0"), ("3.0", "4.0", "30.0"),
                ))
                worker.dispatch({"action": "run_plugin", "plugin_id": "nigiro.linear_fit", "version": "1", "checksum": None,
                                 "source_id": result["source_id"], "options": {"x": 0, "y": 2, "force_zero": True}})
                before = worker.dispatch({"action": "export_recipe"})["project"]
                path = root / "test.nigiro"
                worker.dispatch({"action": "save", "path": str(path)})
                worker = Workspace()
                worker.dispatch({"action": "open", "path": str(path)})
                after = worker.dispatch({"action": "run_all"})["project"]
                self.assertAlmostEqual(after["figure"]["summary"]["Slope"], 10)
                self.assertEqual(len(after["figures"]), 2)
                replay = worker.dispatch({"action": "export_recipe"})["project"]
                self.assertEqual(json.dumps(before["script_recipe"]), json.dumps(replay["script_recipe"]))
                alignment = next(step for step in after["workflow"]["steps"] if step["label"].endswith("Align / Resample XY"))
                worker.dispatch({"action": "edit_step", "step_id": alignment["id"],
                                 "options": [{**alignment["options"][0], "target_y": 0}]})
                rerun = worker.dispatch({"action": "run_all"})["project"]
                self.assertAlmostEqual(rerun["figure"]["summary"]["Slope"], 1)

    def test_external_joint_table_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / "joint.py"
            plugin.write_text('''
PLUGIN = {"id": "test.joint", "version": "1", "api": 1, "name": "Joint",
          "menu": "analysis", "table_only": True, "input_mode": "joint", "fields": [
              {"key": "left", "label": "Left", "type": "column", "default": 0},
              {"key": "right", "label": "Right", "type": "column", "default": 0}]}
def run(columns, rows, options, inputs):
    left, right = inputs["left"], inputs["right"]
    cells = [left["rows"][0][left["column"]], right["rows"][0][right["column"]]]
    return {"sources": {"combined": {"name": "Combined", "columns": ["Left", "Right"], "rows": [cells]}}}
''')
            with patch.dict(os.environ, {"NIGIRO_PLUGIN_DIR": str(root / "plugins")}):
                worker = Workspace()
                worker.dispatch({"action": "sample"})
                worker.dispatch({"action": "add_scalar", "name": "Constant", "value": 9})
                installed = worker.dispatch({"action": "install_plugin", "path": str(plugin)})
                manifest = next(plugin for plugin in installed["plugins"] if plugin["id"] == "test.joint")
                result = worker.dispatch({
                    "action": "execute_plugin", "plugin_id": manifest["id"], "version": "1", "checksum": manifest["checksum"],
                    "output": "separate", "runs": [{"source_id": None, "options": {"left": 1, "right": 0},
                                                   "references": {"left": {"source_id": None, "column": 1},
                                                                  "right": {"source_id": "raw:0", "column": 0}}}],
                })["project"]
                self.assertEqual(result["figures"], [])
                self.assertEqual(worker.sources[result["source_id"]].rows, (("1", "9"),))
