"""Recorded command replay, ordering, and persisted progress."""

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from nigiro.desktop import Workspace


class WorkflowTest(unittest.TestCase):
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
