"""Appearance preferences stay separate from project figure styles."""

import os
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

from nigiro.desktop import Workspace
from nigiro.figure_style import FigureStyle
from nigiro.settings import Appearance, Settings


class AppearanceTest(unittest.TestCase):
    def test_preferences_survive_style_and_path_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            settings = Settings(path)
            appearance = Appearance(theme="dark", accent="#a044dd")
            settings.save_preferences(FigureStyle(label_size=17), appearance)
            settings.remember(import_path="/data/measurements.csv")
            settings.save(FigureStyle(label_size=18))
            saved = Settings(path)
            self.assertEqual(saved.appearance, appearance)
            self.assertEqual(saved.figure_style.label_size, 18)
            self.assertEqual(saved.last_import_path, "/data/measurements.csv")

    def test_invalid_preferences_do_not_partially_save(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "settings.json"),
        }):
            worker = Workspace()
            original = worker.snapshot()["project"]
            with self.assertRaises(ValueError):
                worker.dispatch({
                    "action": "set_preferences",
                    "style": {**original["global_figure_style"], "label_size": 18},
                    "appearance": {"theme": "dark", "accent": "invalid"},
                })
            self.assertEqual(worker.settings.figure_style.label_size, 13)
            self.assertEqual(worker.settings.appearance.theme, "system")
            worker.dispatch({
                "action": "set_preferences", "style": original["global_figure_style"],
                "appearance": asdict(Appearance(theme="dark", accent="#008866")),
            })
            self.assertEqual(Workspace().snapshot()["project"]["appearance"]["theme"], "dark")
            self.assertFalse(worker.dirty)

    def test_themes_and_colors_are_validated(self):
        for values in ({"theme": "other"}, {"accent": "#abc"}, {"accent": "red"}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                Appearance(**values)
