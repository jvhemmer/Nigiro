"""Regression coverage for a figure that stays editable after project replay."""

import hashlib
import json
import os
import tempfile
import unittest
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

if find_spec("PyQt6") is None:
    raise unittest.SkipTest("Install the qt extra to test the original editor.")

from PyQt6.QtCore import QPoint, Qt
from PyQt6.QtGui import QColor
from PyQt6.QtTest import QTest
from PyQt6.QtWidgets import QApplication, QColorDialog, QFileDialog, QLineEdit, QTableView

from nigiro.storage import load_project
from nigiro.ui import MainWindow


CSV = b"Time,Signal\r\n0,1\r\n1,4\r\n2,5\r\n3,7\r\n"


class WorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_edited_fit_round_trips_with_raw_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "trial.csv"
            source.write_bytes(CSV)
            project_file = source.with_suffix(".nigiro")
            figure_file = source.with_suffix(".svg")

            window = MainWindow()
            window.show()
            with patch.object(QFileDialog, "getOpenFileName", return_value=(str(source), "")):
                window.import_csv()
            QTest.mouseClick(window.fit_button, Qt.MouseButton.LeftButton)
            self.assertIsNotNone(window.result)
            original_slope = window.result.slope
            window.canvas.draw()

            line = next(artist for artist, kind in window.artists.items() if kind == "fit")
            x, y = line.axes.transData.transform((1.5, 1.5 * original_slope + window.result.intercept))
            window.element.setCurrentIndex(window.element.findData("observations"))
            QTest.mouseClick(
                window.canvas, Qt.MouseButton.LeftButton,
                pos=QPoint(round(x), round(window.canvas.height() - y)),
            )
            self.assertEqual(window.element.currentData(), "fit")
            with patch.object(QColorDialog, "getColor", return_value=QColor("#9a1482")):
                QTest.mouseClick(window.color_button, Qt.MouseButton.LeftButton)

            table = next(
                view for view in window.findChildren(QTableView)
                if view.model() is window.working_model
            )
            cell = window.working_model.index(1, 1)
            table.setCurrentIndex(cell)
            table.edit(cell)
            editor = table.findChild(QLineEdit)
            editor.selectAll()
            QTest.keyClicks(editor, "3")
            QTest.keyClick(editor, Qt.Key.Key_Return)
            self.app.processEvents()
            self.assertAlmostEqual(window.result.slope, 2)
            self.assertNotAlmostEqual(window.result.slope, original_slope)
            self.assertEqual(window.raw_model.data(window.raw_model.index(1, 1)), "4")

            with patch("nigiro.ui.QFileDialog") as save_dialog:
                save_dialog.return_value.exec.return_value = True
                save_dialog.return_value.selectedFiles.return_value = [str(project_file)]
                window.save_action.trigger()
            self.assertTrue(project_file.is_file())
            window.close()

            with ZipFile(project_file) as archive:
                self.assertEqual(archive.read(f"sources/{hashlib.sha256(CSV).hexdigest()}.csv"), CSV)
                manifest = json.loads(archive.read("manifest.json"))["project"]
                self.assertEqual(manifest["sources"][0]["sha256"], hashlib.sha256(CSV).hexdigest())
                self.assertEqual(
                    [record["kind"] for record in manifest["operations"]],
                    ["linear_fit", "figure_color", "correct_cell"],
                )
            self.assertEqual(source.read_bytes(), CSV)
            source.unlink()

            reopened = MainWindow()
            with patch.object(
                QFileDialog, "getOpenFileName", return_value=(str(project_file), "")
            ):
                reopened.open_project()
            self.assertAlmostEqual(reopened.result.slope, 2)
            self.assertEqual(reopened.project.colors["fit"], "#9a1482")
            for destination in (figure_file, figure_file.with_suffix(".pdf")):
                with patch("nigiro.ui.QFileDialog") as export_dialog:
                    export_dialog.return_value.exec.return_value = True
                    export_dialog.return_value.selectedFiles.return_value = [str(destination)]
                    reopened.export()
            self.assertIn("#9a1482", figure_file.read_text())
            self.assertTrue(figure_file.with_suffix(".pdf").read_bytes().startswith(b"%PDF-"))
            reopened.close()

    def test_rejects_source_that_does_not_match_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corrupt.nigiro"
            checksum = hashlib.sha256(CSV).hexdigest()
            with ZipFile(path, "w") as archive:
                archive.writestr("manifest.json", json.dumps({
                    "format_version": 3,
                    "project": {"sources": [{"sha256": checksum}]},
                }))
                archive.writestr(f"sources/{checksum}.csv", b"different bytes")
            with self.assertRaisesRegex(ValueError, "checksum"):
                load_project(path)
