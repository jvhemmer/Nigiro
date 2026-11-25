"""Recorded command replay, ordering, and persisted progress."""

import runpy
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from nigiro.desktop import Workspace


class WorkflowTest(unittest.TestCase):
    def test_filter_segments_preserves_all_matching_rows_in_source_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cv.csv"
            path.write_text("Segment,Potential,Current\n2,0.2,1\n3,0.3,2\n1.0,0.4,3\n2,0.5,4\n")
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "import_data", "paths": [str(path)]})
            command = {
                "action": "execute_plugin", "plugin_id": "nigiro.filter_segments", "version": "1",
                "checksum": None, "output": "separate",
                "runs": [{"source_id": None, "options": {"column": 0, "segments": "1, 2, 2, 5"}}],
            }
            result = worker.dispatch(command)["project"]
            expected = (("2", "0.2", "1"), ("1.0", "0.4", "3"), ("2", "0.5", "4"))
            self.assertEqual(result["source_table"]["columns"], ("Segment", "Potential", "Current"))
            self.assertEqual(result["source_table"]["rows"], expected)
            self.assertEqual(result["figures"], [])
            replayed = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["source_table"]["rows"], expected)

    def test_array_values_and_row_offsets_replay_after_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "arrays.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = True
            entered = worker.dispatch({"action": "add_array", "name": "Data", "values": "1, 2\n4 8"})["project"]
            self.assertEqual(entered["sources"][0]["detail"], "= [1.0, 2.0, 4.0, 8.0]")
            expression = "$Data:Value(i) - $Data:Value(i+1)"
            calculated = worker.dispatch({"action": "add_array", "name": "Difference", "expression": expression})["project"]
            self.assertEqual(calculated["sources"][-1]["array_step"], calculated["workflow"]["steps"][-1]["id"])
            self.assertEqual(calculated["source_table"]["rows"], (("-1.0",), ("-2.0",), ("-4.0",), ("",)))
            self.assertEqual(calculated["source_table"]["name"], "Difference")
            self.assertEqual(calculated["sources"][-1]["detail"], f"= {expression}")
            recipe = worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]
            self.assertEqual(next(iter(recipe["plugins"].values()))["options"]["expression"], expression)
            step = entered["workflow"]["steps"][0]["id"]
            self.assertEqual(entered["sources"][0]["array_step"], step)
            worker.dispatch({"action": "edit_item", "item": {"kind": "source", "id": None}, "name": "Renamed"})
            renamed = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(renamed["sources"][0]["name"], "Renamed")
            self.assertEqual(renamed["source_table"]["rows"], calculated["source_table"]["rows"])
            worker.dispatch({"action": "edit_step", "step_id": step, "options": [{"values": "2,4,8"}]})
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["source_table"]["rows"], (("-2.0",), ("-4.0",), ("",)))

    def test_delete_only_executed_step_then_save_and_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deleted.nigiro"
            worker = Workspace()
            imported = worker.dispatch({"action": "sample"})["project"]
            step_id = imported["workflow"]["steps"][0]["id"]
            deleted = worker.dispatch({"action": "delete_step", "step_id": step_id})["project"]
            self.assertEqual(deleted["workflow"]["steps"], [])
            self.assertTrue(deleted["workflow"]["needs_replay"])
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            replayed = reopened.dispatch({"action": "run_next"})["project"]
            self.assertFalse(replayed["sources"])
            self.assertFalse(replayed["workflow"]["needs_replay"])

    def test_deleted_producer_does_not_rebind_to_a_new_step(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        plotted = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        producer = plotted["workflow"]["steps"][0]["id"]
        deleted = worker.dispatch({"action": "delete_step", "step_id": producer})["project"]
        self.assertEqual(deleted["workflow"]["steps"][0]["status"], "stale")
        replacement = worker.dispatch({"action": "sample"})["project"]["workflow"]["steps"][-1]
        worker.dispatch({"action": "move_step", "step_id": replacement["id"], "direction": -1})
        replayed = worker.dispatch({"action": "run_all"})["project"]
        self.assertIn("deleted step", replayed["workflow"]["error"])

    def test_recorded_labels_describe_the_action_and_plugin(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        for identifier in ("nigiro.scatter", "nigiro.linear_fit"):
            worker.dispatch({
                "action": "run_plugin", "plugin_id": identifier, "version": "1", "checksum": None,
                "options": {"x": 0, "y": 1},
            })
        figure_id = worker.snapshot()["project"]["figure_id"]
        for name in ("Fit", None):
            result = worker.dispatch({
                "action": "edit_item", "item": {"kind": "figure", "id": figure_id}, "name": name,
            })["project"]
        self.assertEqual([step["label"] for step in result["workflow"]["steps"][1:]],
                         ["Plot: Scatter", "Analysis: Linear Fit", "Rename item", "Remove item"])

    def test_python_script_references_original_paths_or_copied_csvs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "input.csv"
            original = b"X,Y\n0,123456.789\n1,987654.321\n"
            csv.write_bytes(original)
            worker = Workspace()
            worker.dispatch({"action": "import_data", "paths": [str(csv)]})
            worker.dispatch({"action": "plot", "plot_type": "scatter", "x": 0, "y": 1})
            recipe = worker.dispatch({"action": "export_recipe"})["project"]
            self.assertNotIn("figure", recipe)
            self.assertNotIn("sources", recipe["script_recipe"])
            script = root / "figure.py"
            export = {
                "action": "export_script", "path": str(script), "template": "import json\n# Nigiro replay payload\n",
                "payload": {"recipe": recipe["script_recipe"], "operations": recipe["operations"]},
                "copy_raw_data": False,
            }
            worker.dispatch(export)
            source = runpy.run_path(str(script))["PAYLOAD"]["recipe"]["sources"][0]
            self.assertEqual(source["path"], str(csv))
            self.assertNotIn("content", source)
            self.assertNotIn("123456.789", script.read_text())
            self.assertFalse((root / "imports").exists())

            # Re-export with copies after the original input changes.
            csv.write_bytes(b"X,Y\n0,1\n1,2\n")
            (root / "imports").mkdir()
            (root / "imports/source-001.csv").write_text("existing")
            worker.dispatch({**export, "copy_raw_data": True})
            source = runpy.run_path(str(script))["PAYLOAD"]["recipe"]["sources"][0]
            self.assertEqual(source["path"], "imports/source-001-2.csv")
            self.assertEqual((root / source["path"]).read_bytes(), original)
            self.assertNotIn(str(csv), script.read_text())
            self.assertNotIn("123456.789", script.read_text())

    def test_python_script_without_an_original_path_requires_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Workspace()
            worker.dispatch({"action": "sample"})
            script = Path(directory) / "sample.py"
            with self.assertRaisesRegex(ValueError, "Enable Copy raw CSV files"):
                worker.dispatch({
                    "action": "export_script", "path": str(script), "template": "import json\n# Nigiro replay payload\n",
                    "payload": {"recipe": {}}, "copy_raw_data": False,
                })
            self.assertFalse(script.exists())

    def test_batch_scaling_and_source_order_survive_replay_and_save(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second, archive = (Path(directory) / name for name in ("a.csv", "b.csv", "project.nigiro"))
            first.write_text("X,Y\n1,2\n2,3\n")
            second.write_text("Y,X\n3,1\n4,2\n")
            worker = Workspace()
            worker.dispatch({"action": "import_data", "paths": [str(first), str(second)]})
            scaled = worker.dispatch({"action": "scale_column", "factor": 2, "runs": [
                {"source_id": None, "column": 1}, {"source_id": "raw:0", "column": 0},
            ]})["project"]
            self.assertEqual(scaled["rows"][0], ("1", "4.0"))
            reordered = worker.dispatch({"action": "move_source", "source_id": "raw:0", "destination": 0})["project"]
            self.assertEqual(reordered["workflow"]["completed"], 2)
            self.assertEqual(reordered["sources"][0]["name"], second.name)
            worker.dispatch({"action": "save", "path": str(archive)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(archive)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["sources"][0]["original_path"], str(second))
            result = reopened.dispatch({"action": "select_source", "source_id": "raw:0"})["project"]
            self.assertEqual(result["source_table"]["rows"][0], ("6.0", "1"))

    def test_replay_keeps_recorded_figure_defaults(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.settings.figure_style = replace(worker.settings.figure_style, font_family="Liberation Sans")
        worker.dispatch({"action": "sample"})
        worker.dispatch({"action": "plot", "plot_type": "scatter", "x": 0, "y": 1})
        worker.settings.figure_style = replace(worker.settings.figure_style, font_family="DejaVu Serif")
        result = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(result["figure_style"]["font_family"], "Liberation Sans")

    def test_filter_outputs_a_source_and_replays_its_dependents(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        command = {
            "action": "execute_plugin", "plugin_id": "nigiro.filter", "version": "1", "checksum": None,
            "output": "separate", "runs": [{"source_id": None, "options": {
                "column": 1, "expression": "value > 6", "output": "rows",
            }}],
        }
        filtered = worker.dispatch(command)["project"]
        self.assertEqual(filtered["figures"], [])
        self.assertEqual(len(filtered["source_table"]["columns"]), 2)
        self.assertEqual(filtered["row_count"], 5)
        plotted = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        self.assertEqual(plotted["figure"]["traces"][0]["y"], [6.5, 8.9, 10.2, 13.4, 14.5])
        replay = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(replay["figure"]["traces"], plotted["figure"]["traces"])
        values = worker.dispatch({**command, "runs": [{"source_id": None, "options": {
            "column": 1, "expression": "value < 3", "output": "values",
        }}]})["project"]
        self.assertEqual(values["source_table"]["columns"], ("Signal",))
        self.assertEqual(values["source_table"]["rows"], (("1",), ("2.9",)))

    def test_edit_and_move_a_scale_step(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        scatter = {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1}
        worker.dispatch(scatter)
        worker.dispatch({"action": "scale_column", "column": 1, "factor": 2})
        initial = worker.dispatch(scatter)["project"]
        self.assertEqual(initial["figure"]["traces"][0]["y"][0], 2)
        earlier_id = initial["figures"][0]["id"]
        earlier = worker.dispatch({"action": "select_figure", "figure_id": earlier_id})["project"]
        self.assertEqual(earlier["figure"]["traces"][0]["y"][0], 1)
        scale_id = initial["workflow"]["steps"][2]["id"]
        edited = worker.dispatch({"action": "edit_step", "step_id": scale_id, "options": [{"factor": 3}]})["project"]
        self.assertEqual([step["status"] for step in edited["workflow"]["steps"]], ["done", "done", "stale", "stale"])
        next_step = worker.dispatch({"action": "run_next"})["project"]
        self.assertEqual(next_step["workflow"]["completed"], 3)
        self.assertEqual(next_step["rows"][0][1], "3.0")
        worker.dispatch({"action": "move_step", "step_id": scale_id, "direction": -1})
        rerun = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(rerun["workflow"]["completed"], 4)
        first = worker.dispatch({"action": "select_figure", "figure_id": rerun["figures"][0]["id"]})["project"]
        self.assertEqual(first["figure"]["traces"][0]["y"][0], 3)
        self.assertEqual(first["original_rows"][0][1], "1")

    def test_queued_import_survives_save_and_original_csv_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "data.csv"
            csv.write_text("X,Y\n0,1\n1,2\n")
            path = root / "pending.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = False
            pending = worker.dispatch({"action": "import_data", "paths": [str(csv)]})["project"]
            self.assertFalse(pending["sources"])
            self.assertEqual(pending["workflow"]["steps"][0]["status"], "pending")
            worker.dispatch({"action": "save", "path": str(path)})
            csv.unlink()
            other = Workspace()
            reopened = other.dispatch({"action": "open", "path": str(path)})["project"]
            self.assertEqual(reopened["workflow"]["completed"], 0)
            restored = other.dispatch({"action": "run_next"})["project"]
            self.assertEqual(restored["rows"][0], ("0", "1"))
            self.assertEqual(restored["workflow"]["steps"][0]["status"], "done")

    def test_dependencies_survive_move_and_replay(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.linear_fit", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })
        source = worker.snapshot()["project"]["sources"][-1]
        worker.dispatch({"action": "select_source", "source_id": source["id"]})
        created = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        expected = created["figure"]["traces"][0]["y"]
        consumer = created["workflow"]["steps"][-1]["id"]
        worker.dispatch({"action": "move_step", "step_id": consumer, "direction": -1})
        failed = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(failed["workflow"]["completed"], 1)
        self.assertEqual(failed["workflow"]["steps"][1]["status"], "failed")
        self.assertIn("later step", failed["workflow"]["error"])
        worker.dispatch({"action": "move_step", "step_id": consumer, "direction": 1})
        recovered = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(recovered["figure"]["traces"][0]["y"], expected)
        self.assertIsNone(recovered["workflow"]["error"])
        self.assertEqual(worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]["figure_id"], recovered["figure_id"])
