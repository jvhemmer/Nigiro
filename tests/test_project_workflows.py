"""Reuse a saved project and refresh its workflow snapshot."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from nigiro.desktop import Workspace


class ProjectWorkflowTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        settings = patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(self.root / "settings.json")})
        settings.start()
        self.addCleanup(settings.stop)

    def make_template(self):
        template = Workspace()
        path = self.root / "template.csv"
        path.write_text("E,I\n1,2\n3,4\n")
        template.dispatch({"action": "import_data", "paths": [str(path)]})
        template.dispatch({"action": "add_scalar", "name": "R", "value": 2})
        template.dispatch({"action": "add_scalar", "name": "Factor", "value": 10})
        template.dispatch({"action": "add_array", "name": "Corrected", "expression": "($template:E - $template:I * $R) * $Factor"})
        return template, self.root / "Correction.nigiro"

    def import_snapshot(self, worker, path, configuration=None, refresh_id=None):
        preview = worker.dispatch({"action": "inspect_project_workflow", "path": str(path), "refresh_id": refresh_id})
        return worker.dispatch({
            "action": "import_project_workflow", "path": preview["path"], "revision": preview["revision"],
            "configuration": configuration or preview["configuration"], "refresh_id": refresh_id,
        })["project"]

    def test_saved_interface_and_refresh_keep_recorded_runs_pinned(self):
        template, path = self.make_template()
        context = template.dispatch({"action": "project_workflow_context"})
        output = next(port for port in context["outputs"] if port["name"] == "Corrected")
        configuration = {"name": "Correction", "steps": [1, 2, 3, 4],
                         "inputs": {"1/source/0": "Data", "2/source/0": "Resistance"}, "outputs": [output]}
        template.dispatch({"action": "configure_project_workflow", "configuration": configuration})
        template.dispatch({"action": "save", "path": str(path)})

        worker = Workspace()
        project = self.import_snapshot(worker, path)
        workflow, = project["saved_workflows"]
        self.assertEqual([port["name"] for port in workflow["inputs"]], ["Data", "Resistance"])
        input_path = self.root / "experiment.csv"
        input_path.write_text("E,I\n5,6\n7,8\n")
        worker.dispatch({"action": "import_data", "paths": [str(input_path)]})
        run = {"action": "run_saved_workflow", "id": workflow["id"],
               "sources": {"1/source/0": None}, "numbers": {"2/source/0": 1}}
        first = worker.dispatch({**run, "name": "First"})["project"]
        self.assertEqual(first["source_table"]["rows"], (("-10.0",), ("-10.0",)))

        template.dispatch({"action": "edit_step", "step_id": 3, "options": [{"value": 100}]})
        template.dispatch({"action": "run_all"})
        template.dispatch({"action": "save"})
        refreshed = self.import_snapshot(worker, path, refresh_id=workflow["id"])
        self.assertEqual([entry["id"] for entry in refreshed["saved_workflows"]], [workflow["id"]])
        second = worker.dispatch({**run, "name": "Second"})["project"]
        self.assertEqual(second["source_table"]["rows"], (("-100.0",), ("-100.0",)))

        recipient = self.root / "Experiment.nigiro"
        worker.dispatch({"action": "save", "path": str(recipient)})
        path.unlink()
        reopened = Workspace()
        self.assertEqual(reopened.dispatch({"action": "state"})["project"]["saved_workflows"], [])
        project = reopened.dispatch({"action": "open", "path": str(recipient)})["project"]
        self.assertEqual(project["saved_workflows"][0]["id"], workflow["id"])
        project = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(project["workflow"]["completed"], 3)
        self.assertEqual(project["source_table"]["rows"], second["source_table"]["rows"])
        first_id = next(source["id"] for source in project["sources"] if source["name"] == "First · Corrected")
        first = reopened.dispatch({"action": "select_source", "source_id": first_id})["project"]
        self.assertEqual(first["source_table"]["rows"], (("-10.0",), ("-10.0",)))

    def test_unconfigured_project_can_keep_its_imported_data_fixed(self):
        template, path = self.make_template()
        template.dispatch({"action": "run_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                           "source_id": None, "options": {"x": 0, "y": 1}})
        template.dispatch({"action": "save", "path": str(path)})
        worker = Workspace()
        preview = worker.dispatch({"action": "inspect_project_workflow", "path": str(path)})
        self.assertIsNone(preview["configuration"])
        outputs = [port for port in preview["outputs"] if port["name"] in ("Corrected", "Line 1")]
        configuration = {"name": "Fixed recipe", "steps": [1, 2, 3, 4, 5], "inputs": {}, "outputs": outputs}
        project = self.import_snapshot(worker, path, configuration=configuration)
        workflow, = project["saved_workflows"]
        self.assertEqual(workflow["inputs"], [])
        path.unlink()
        (self.root / "template.csv").unlink()
        result = worker.dispatch({"action": "run_saved_workflow", "id": workflow["id"], "name": "Fixed",
                                  "sources": {}, "numbers": {}})["project"]
        self.assertEqual([source["name"] for source in result["sources"]], ["Fixed · Corrected"])
        self.assertEqual([figure["name"] for figure in result["figures"]], ["Fixed · Line 1"])
        self.assertEqual(result["figure"]["traces"][0]["y"], [2.0, 4.0])
        self.assertEqual(result["source_table"]["rows"], (("-30.0",), ("-50.0",)))
        recipient = self.root / "Fixed run.nigiro"
        worker.dispatch({"action": "save", "path": str(recipient)})
        with ZipFile(recipient) as archive:
            workflow_record = json.loads(archive.read("manifest.json"))["workflow"]
            entry = workflow_record["imported_workflows"][workflow["id"]]["definition"]["fixed_sources"]["1/source/0"]
            self.assertNotIn("content", entry)
            self.assertEqual(archive.namelist().count(f"sources/{entry['sha256']}.csv"), 1)
        reopened = Workspace()
        reopened.dispatch({"action": "open", "path": str(recipient)})
        replayed = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(replayed["source_table"]["rows"], result["source_table"]["rows"])

    def test_import_checks_that_the_reviewed_project_has_not_changed(self):
        template, path = self.make_template()
        template.dispatch({"action": "save", "path": str(path)})
        worker = Workspace()
        preview = worker.dispatch({"action": "inspect_project_workflow", "path": str(path)})
        template.dispatch({"action": "save", "notes": "Updated since preview"})
        with self.assertRaisesRegex(ValueError, "source project changed"):
            worker.dispatch({"action": "import_project_workflow", "path": str(path), "revision": preview["revision"],
                             "configuration": {}})
        self.assertEqual(worker.workflow.imported_workflows, {})
