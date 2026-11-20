"""Check project replay and vector export through the desktop worker protocol."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from nigiro.storage import load_project


CSV = "Time,Signal µ\r\n0,1\r\n1,4\r\n2,5\r\n3,7\r\n".encode()


class DesktopWorkerTest(unittest.TestCase):
    def run_worker(self, *requests: dict) -> list[dict]:
        engine = os.environ.get("NIGIRO_TEST_ENGINE")
        command = [engine] if engine else [sys.executable, "-m", "nigiro.desktop"]
        result = subprocess.run(
            command,
            input="".join(json.dumps(request, ensure_ascii=False) + "\n" for request in requests),
            capture_output=True,
            encoding="utf-8",
            timeout=45,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(replies), len(requests))
        return replies

    def test_worker_replays_genuine_project_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "trial µ.csv"
            source.write_bytes(CSV)
            project = source.with_suffix(".nigiro")
            svg = source.with_suffix(".svg")
            pdf = source.with_suffix(".pdf")

            imported, fitted, rejected, colored, corrected, saved = self.run_worker(
                {"action": "import_csv", "path": str(source)},
                {"action": "fit", "x": 0, "y": 1},
                {"action": "fit", "x": 1, "y": 1},
                {"action": "color", "element": "fit", "color": "#9a1482"},
                {"action": "correct", "row": 1, "column": 1, "value": "3"},
                {"action": "save", "path": str(project)},
            )
            self.assertEqual(imported["state"]["project"]["source_name"], source.name)
            self.assertAlmostEqual(fitted["state"]["project"]["fit"]["slope"], 1.9)
            self.assertIn("different X and Y", rejected["error"])
            self.assertAlmostEqual(colored["state"]["project"]["fit"]["slope"], 1.9)
            self.assertAlmostEqual(corrected["state"]["project"]["fit"]["slope"], 2)
            self.assertFalse(saved["state"]["project"]["dirty"])

            self.assertEqual(source.read_bytes(), CSV)
            source.unlink()
            with ZipFile(project) as archive:
                self.assertEqual(archive.read("source.csv"), CSV)
            self.assertEqual(load_project(project).worksheet.rows[1][1], "3")

            opened, exported_svg, exported_pdf = self.run_worker(
                {"action": "open", "path": str(project)},
                {"action": "export", "path": str(svg)},
                {"action": "export", "path": str(pdf)},
            )
            state = opened["state"]["project"]
            self.assertEqual(state["original_rows"][1][1], "4")
            self.assertEqual(state["rows"][1][1], "3")
            self.assertAlmostEqual(state["fit"]["slope"], 2)
            self.assertEqual(
                [step["kind"] for step in state["operations"]],
                ["linear_fit", "figure_color", "correct_cell"],
            )
            self.assertEqual(exported_svg["state"], opened["state"])
            self.assertEqual(exported_pdf["state"], opened["state"])
            self.assertIn("#9a1482", svg.read_text())
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF-"))
