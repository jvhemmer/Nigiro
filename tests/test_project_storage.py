"""Project data can be linked, embedded, or restored by replay."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from nigiro.desktop import Workspace
from nigiro.settings import ProjectStorage


class ProjectStorageTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.csv = self.root / "data.csv"
        self.content = b"X,Y\n0,1\n1,2\n"
        self.csv.write_bytes(self.content)
        settings = patch.dict(os.environ, {"NIGIRO_SETTINGS_PATH": str(self.root / "settings.json")})
        settings.start()
        self.addCleanup(settings.stop)

    def make_project(self):
        worker = Workspace()
        worker.dispatch({"action": "import_data", "paths": [str(self.csv)]})
        derived = worker.dispatch({
            "action": "apply_formula", "source_id": None, "column": 1, "expression": "value * 3",
        })["project"]["source_id"]
        worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
            "source_id": derived, "options": {"x": 0, "y": 1},
        })
        return worker, derived

    def save(self, worker, name):
        path = self.root / f"{name}.nigiro"
        worker.dispatch({"action": "save", "path": str(path), "notes": "Experiment notes"})
        return path

    def test_default_archive_links_data_and_can_defer_replay(self):
        worker, derived = self.make_project()
        self.assertEqual(worker.settings.project_storage, ProjectStorage())
        worker.dispatch({"action": "set_project_properties", "overrides": {}, "run_on_open": False})
        path = self.save(worker, "linked")
        with ZipFile(path) as archive:
            self.assertEqual(archive.namelist(), ["manifest.json"])
            record = json.loads(archive.read("manifest.json"))["project"]
            self.assertEqual(record["sources"][0]["external_path"], self.csv.name)
            self.assertEqual(record["derived_sources"][derived], {"name": "Y"})

        self.csv.unlink()
        reopened = Workspace()
        project = reopened.dispatch({"action": "open", "path": str(path)})["project"]
        self.assertEqual(project["notes"], "Experiment notes")
        self.assertEqual(project["sources"], [])
        self.assertEqual(project["figures"], [])
        self.assertEqual(project["workflow"]["completed"], 0)
        self.assertTrue(project["workflow"]["needs_replay"])
        failed = reopened.dispatch({"action": "run_all"})["project"]["workflow"]
        self.assertEqual(failed["steps"][0]["status"], "failed")
        self.assertIn("linked file is unavailable", failed["error"])

        self.csv.write_bytes(self.content.replace(b"1,2", b"1,5"))
        changed = reopened.dispatch({"action": "run_all"})["project"]["workflow"]
        self.assertIn("linked file changed", changed["error"])
        self.csv.write_bytes(self.content)
        result = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(result["workflow"]["completed"], 3)
        self.assertEqual(result["figure"]["traces"][0]["y"], [3.0, 6.0])

    def test_embedded_files_still_wait_for_replay_without_processed_data(self):
        worker, _ = self.make_project()
        worker.settings.project_storage = ProjectStorage(embed_files=True)
        worker.dispatch({"action": "set_project_properties", "overrides": {}, "run_on_open": False})
        path = self.save(worker, "embedded input")
        self.csv.unlink()
        reopened = Workspace()
        self.assertEqual(reopened.dispatch({"action": "open", "path": str(path)})["project"]["sources"], [])
        result = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(result["figure"]["traces"][0]["y"], [3.0, 6.0])

    def test_project_overrides_persist_and_follow_the_project(self):
        worker, _ = self.make_project()
        defaults = ProjectStorage(embed_files=True)
        worker.settings.save_preferences(worker.settings.figure_style, worker.settings.appearance,
                                         project_storage=defaults)
        overrides = {"embed_files": False, "embed_figures": True}
        changed = worker.dispatch({"action": "set_project_storage", "overrides": overrides})["project"]
        self.assertTrue(changed["dirty"])
        self.assertTrue(changed["project_storage"]["embed_files"])
        path = self.save(worker, "with overrides")
        with ZipFile(path) as archive:
            self.assertFalse(any(entry.startswith("sources/") for entry in archive.namelist()))
            self.assertTrue(any(entry.startswith("figures/") for entry in archive.namelist()))

        reopened = Workspace()
        opened = reopened.dispatch({"action": "open", "path": str(path)})["project"]
        self.assertEqual(opened["project_storage_overrides"], overrides)
        replayed = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(replayed["project_storage_overrides"], overrides)
        self.assertEqual(reopened.settings.project_storage, defaults)

        reopened.dispatch({"action": "set_project_storage", "overrides": {}})
        path = self.save(reopened, "using defaults")
        with ZipFile(path) as archive:
            self.assertTrue(any(entry.startswith("sources/") for entry in archive.namelist()))
            self.assertFalse(any(entry.startswith("figures/") for entry in archive.namelist()))
        reopened.dispatch({"action": "open", "path": str(path)})
        self.assertEqual(reopened.workflow.project_storage_overrides, {})
        reopened.dispatch({"action": "open", "path": str(self.root / "with overrides.nigiro")})
        self.assertEqual(reopened.workflow.project_storage_overrides, overrides)
        fresh = reopened.dispatch({"action": "new"})["project"]
        self.assertEqual(fresh["project_storage_overrides"], {})

    def test_calculated_sources_and_figures_can_each_be_embedded(self):
        worker, derived = self.make_project()
        for options, entry_prefix in (
            (ProjectStorage(embed_calculated_sources=True), "tables/"),
            (ProjectStorage(embed_figures=True), "figures/"),
        ):
            with self.subTest(options=options):
                worker.settings.save_preferences(worker.settings.figure_style, worker.settings.appearance,
                                                 project_storage=options)
                path = self.save(worker, entry_prefix.rstrip("/"))
                with ZipFile(path) as archive:
                    entries = [entry for entry in archive.namelist() if entry != "manifest.json"]
                    self.assertTrue(entries and all(entry.startswith(entry_prefix) for entry in entries))
                reopened = Workspace()
                self.assertEqual(reopened.settings.project_storage, options)
                with patch.object(reopened, "execute", side_effect=ValueError("Plugin unavailable.")):
                    result = reopened.dispatch({"action": "open", "path": str(path)})["project"]
                if options.embed_figures:
                    self.assertEqual(result["figure"]["traces"][0]["y"], [3.0, 6.0])
                else:
                    self.assertEqual(reopened.sources[derived].rows, (("0", "3.0"), ("1", "6.0")))
