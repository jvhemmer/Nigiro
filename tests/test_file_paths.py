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
