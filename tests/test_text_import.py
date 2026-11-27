"""Exercise text import detection, review, and recorded settings."""

import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from nigiro.desktop import Workspace
from nigiro.text_import import TextImport, decode_table, guess_import, import_preview, text_table
from nigiro.settings import ProjectStorage


class TextImportTests(unittest.TestCase):
    def test_detects_headerless_matrices_and_common_delimiters(self):
        examples = (
            (b"1  2\n3\t4\n", "whitespace", ("Column 1", "Column 2"), (("1", "2"), ("3", "4"))),
            ("Time\tVoltage\n0\t2\n1\t4\n".encode("utf-16"), "\t", ("Time", "Voltage"), (("0", "2"), ("1", "4"))),
            (b"# Sensor data\r\nTime;Voltage\r\n0;2\r\n", ";", ("Time", "Voltage"), (("0", "2"),)),
            (b"1,5;2,4\n3,6;4,9\n", ";", ("Column 1", "Column 2"), (("1,5", "2,4"), ("3,6", "4,9"))),
            (b'Time,Notes\n0,"a,b"\n', ",", ("Time", "Notes"), (("0", "a,b"),)),
        )
        for content, delimiter, columns, rows in examples:
            with self.subTest(content=content):
                settings, confident = guess_import(content)
                self.assertTrue(confident)
                self.assertEqual(settings.delimiter, delimiter)
                self.assertEqual(text_table(decode_table(content, settings.encoding), settings), (columns, rows))

    def test_preview_is_bounded_and_keeps_quoted_multiline_cells(self):
        content = b'# Header\nX,Text\n1,"hello\n\n# This is part of the cell"\n' + b"2,world\n" * 30
        settings = TextImport(comment="#", header_row=2)
        preview = import_preview(content, settings)
        self.assertIsNone(preview["error"])
        self.assertEqual(preview["rows"][0][1], "hello\n\n# This is part of the cell")
        self.assertEqual(len(preview["rows"]), 20)
        self.assertEqual(len(preview["raw"]), 20)
        with self.assertRaisesRegex(ValueError, "not a text table"):
            decode_table(b"PK\x03\x04data", "utf-8-sig")

    def test_review_keeps_multi_file_import_atomic_and_saves_settings(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "preferences.json"),
        }):
            root = Path(directory)
            automatic, manual = root / "numbers.txt", root / "instrument.dat"
            automatic.write_text("1 2\n3 4\n")
            original = b"Instrument export\n# note\nversion 1\nTime^Signal\n0^1\nCalibration\n1^3\n"
            manual.write_bytes(original)
            worker = Workspace()
            worker.settings.run_automatically = True
            request = {"action": "import_data", "paths": [str(automatic), str(manual)], "interactive": True}
            review = worker.dispatch(request)["import_review"]
            self.assertEqual(review["index"], 1)
            self.assertIsNotNone(review["settings"][0])
            self.assertFalse(worker.project.raw_sources)
            self.assertFalse(worker.workflow.steps)
            settings = {**review["suggested"], "delimiter": "^", "comment": "#", "header_row": 4,
                        "skip_rows": 1, "ignore_rows": "6"}
            preview = worker.dispatch({"action": "import_preview", "path": str(manual), "settings": settings})
            self.assertEqual(preview["rows"], [("0", "1"), ("1", "3")])
            result = worker.dispatch({**request, "settings": [review["settings"][0], settings]})["project"]
            self.assertEqual([source["name"] for source in result["sources"]], ["numbers.txt", "instrument.dat"])
            path = root / "project.nigiro"
            worker.settings.project_storage = ProjectStorage(embed_files=True)
            worker.dispatch({"action": "save", "path": str(path)})
            manual.unlink()
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            reopened.dispatch({"action": "run_all"})
            source = next(source for source in reopened.project.raw_sources.values() if source.name == manual.name)
            self.assertEqual(source.content, original)
            self.assertEqual(source.worksheet.rows, (("0", "1"), ("1", "3")))

            script = root / "example.py"
            reopened.dispatch({"action": "export_script", "path": str(script), "copy_raw_data": True,
                               "template": "import json\n# Nigiro replay payload\n", "payload": {"recipe": {}}})
            record = runpy.run_path(str(script))["PAYLOAD"]["recipe"]["sources"][1]
            self.assertEqual(record["text_import"], settings)
            self.assertTrue(record["path"].endswith(".dat"))
            self.assertEqual((root / record["path"]).read_bytes(), original)
