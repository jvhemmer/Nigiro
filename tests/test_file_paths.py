"""Project and session folders used by native file dialogs."""

import json
import os
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from unittest.mock import patch

from nigiro.desktop import Workspace
from nigiro.figure_style import FigureStyle
from nigiro.settings import Settings
from nigiro.storage import load_project, save_project


class FilePathsTest(unittest.TestCase):
    def test_dialogs_keep_independent_folders_across_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "import_data": "data.csv", "replace_import": "replacement.csv",
                "save": "saved.nigiro", "open": "opened.nigiro",
                "save_workspace": "saved.nigiro-workspace", "open_workspace": "opened.nigiro-workspace",
                "save_workflow": "saved.nigiro-workflow", "import_workflow": "opened.nigiro-workflow",
                "export_rendered": "figure.png", "export_script": "figure.py", "install_plugin": "plugin.py",
            }
            paths = {purpose: root / purpose / name for purpose, name in paths.items()}
            for path in paths.values():
                path.parent.mkdir()

            with patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(root / "settings.json")}):
                worker = Workspace()
                worker.settings.run_automatically = True

                def run(purpose, **options):
                    return worker.dispatch({"action": purpose, "path": str(paths[purpose]), **options})

                for key in ("import_data", "replace_import"):
                    paths[key].write_text("X,Y\n0,1\n1,2\n")
                worker.dispatch({"action": "import_data", "paths": [str(paths["import_data"])]})
                self.assertIsNone(worker.dialog_directory("open"))
                run("save")
                paths["open"].write_bytes(paths["save"].read_bytes())
                run("open")
                worker.dispatch({"action": "new_workspace"})
                run("save")
                run("save_workspace")
                collection = json.loads(paths["save_workspace"].read_text())
                collection.update(projects=[str(paths["save"])], active=str(paths["save"]))
                paths["open_workspace"].write_text(json.dumps(collection))
                run("open_workspace")
                self.assertEqual(worker.path, paths["save"])
                self.assertEqual(worker.dialog_directory("open"), str(paths["open"].parent))

                run("save_workflow", name="Table", steps=[1], inputs={"1/source/0": "Input data"},
                    outputs=[{"kind": "source", "id": None, "name": "Table"}])
                paths["import_workflow"].write_bytes(paths["save_workflow"].read_bytes())
                run("import_workflow")
                run("replace_import", step_id=1, slot=0)
                self.assertEqual(worker.dialog_directory("import_data"), str(paths["import_data"].parent))

                with (patch("nigiro.figure_export.write_figure"),
                      patch("nigiro.script_export.write_script"),
                      patch.object(worker, "require_exportable_workflow"),
                      patch.object(worker.plugins, "install")):
                    run("export_rendered", svg="<svg/>", scale=1)
                    run("export_script", template="", payload={}, copy_raw_data=False)
                    run("install_plugin")

                reopened = Workspace()
                for purpose, path in paths.items():
                    self.assertEqual(reopened.dispatch({"action": "dialog_directory", "purpose": purpose}),
                                     {"directory": str(path.parent)})
                paths["install_plugin"].parent.rmdir()
                self.assertIsNone(reopened.dialog_directory("install_plugin"))

    def test_workspace_round_trip_switching_and_recent_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace_file = root / "ORR.nigiro-workspace"
            first = root / "Roughening CVs.nigiro"
            second = root / "Steady State.nigiro"
            settings = root / "settings.json"
            with patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(settings)}):
                worker = Workspace()
                worker.dispatch({"action": "save", "path": str(first), "notes": "First set"})
                created = worker.dispatch({"action": "new_workspace"})["project"]
                self.assertEqual(created["notes"], "First set")
                self.assertTrue(created["workspace"]["dirty"])
                worker.dispatch({"action": "new"})
                worker.dispatch({"action": "save", "path": str(second), "notes": "Second set"})
                saved = worker.dispatch({"action": "save_workspace", "path": str(workspace_file)})["project"]
                self.assertFalse(saved["workspace"]["dirty"])
                self.assertEqual(saved["workspace"]["name"], "ORR")
                self.assertEqual([item["name"] for item in saved["workspace"]["projects"]], ["Roughening CVs", "Steady State"])
                record = json.loads(workspace_file.read_text())
                self.assertEqual(record["projects"], [first.name, second.name])
                self.assertEqual(record["active"], second.name)

                reopened = Workspace()
                initial = reopened.dispatch({"action": "state"})["project"]
                self.assertEqual(initial["recent_workspaces"], [{"name": "ORR", "path": str(workspace_file)}])
                loaded = reopened.dispatch({"action": "open_recent_workspace", "path": str(workspace_file)})["project"]
                self.assertEqual(loaded["notes"], "Second set")
                switched = reopened.dispatch({"action": "switch_workspace_project", "path": str(first)})["project"]
                self.assertEqual(switched["notes"], "First set")
                self.assertFalse(switched["workspace"]["dirty"])
                with self.assertRaisesRegex(ValueError, "active workspace"):
                    reopened.dispatch({"action": "switch_workspace_project", "path": str(root / "Unlisted.nigiro")})
                second.unlink()
                recovered = reopened.dispatch({"action": "open_workspace", "path": str(workspace_file)})["project"]
                self.assertEqual(recovered["workspace"]["active_project"], str(first))
                self.assertEqual(len(recovered["workspace"]["projects"]), 2)

    def test_project_folder_takes_priority_and_session_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / "first", root / "second"
            first.mkdir()
            second.mkdir()
            a, b = first / "a.csv", second / "b.csv"
            for path in (a, b):
                path.write_text("X,Y\n0,1\n1,2\n")
            with patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(root / "settings.json")}):
                worker = Workspace()
                self.assertIsNone(worker.dialog_directory())
                worker.dispatch({"action": "import_data", "paths": [str(a)]})
                archive = root / "saved.nigiro"
                worker.dispatch({"action": "save", "path": str(archive)})
                self.assertEqual(load_project(archive).last_import_path, str(a))
                worker.dispatch({"action": "import_data", "paths": [str(b)]})
                self.assertEqual(worker.dispatch({"action": "dialog_directory"}), {"directory": str(second)})
                self.assertEqual(Workspace().dialog_directory(), str(second))
                worker.dispatch({"action": "open", "path": str(archive)})
                self.assertEqual(worker.dialog_directory(), str(first))
                worker.dispatch({"action": "new"})
                self.assertEqual(worker.dialog_directory(), str(first))
                self.assertEqual(Workspace().dialog_directory(), str(first))

    def test_missing_project_folder_and_failed_import_use_last_valid_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "good.csv"
            csv.write_text("X,Y\n0,1\n")
            with patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(root / "settings.json")}):
                worker = Workspace()
                worker.dispatch({"action": "import_data", "paths": [str(csv)]})
                missing = str(root / "missing" / "old.csv")
                saved = root / "missing-folder.nigiro"
                save_project(saved, replace(worker.project, last_import_path=missing))
                worker.dispatch({"action": "open", "path": str(saved)})
                self.assertEqual(worker.dialog_directory(), str(root))
                with self.assertRaises(OSError):
                    worker.dispatch({"action": "import_data", "paths": [missing]})
                self.assertEqual(worker.project.last_import_path, missing)
                self.assertEqual(worker.settings.last_import_path, str(csv))
                older = root / "older.nigiro"
                save_project(older, replace(worker.project, last_import_path=None))
                worker.dispatch({"action": "open", "path": str(older)})
                self.assertEqual(worker.dialog_directory(), str(root))

    def test_legacy_preferences_migrate_without_losing_style_or_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            style = FigureStyle(label_size=18)
            path.write_text(json.dumps(asdict(style)))
            settings = Settings(path)
            self.assertEqual(settings.figure_style, style)
            settings.remember(import_path="/data/a.csv", project_path="/projects/a.nigiro")
            settings.save(FigureStyle(label_size=20))
            loaded = Settings(path)
            self.assertEqual(loaded.figure_style.label_size, 20)
            self.assertEqual(loaded.last_import_path, "/data/a.csv")
            self.assertEqual(loaded.last_project_path, "/projects/a.nigiro")
