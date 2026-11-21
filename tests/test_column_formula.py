"""Exercise cross-source formulas through the recorded desktop workflow."""

import runpy
import tempfile
import unittest
from pathlib import Path

from nigiro.desktop import Workspace


class ColumnFormulaTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.worker = Workspace()
        self.worker.settings.run_automatically = True
        self.load("Data1.csv", "Voltage,Current,Time\n10,2,0\n20,3,1\n")
        self.load("Data2.csv", "Current\n1\n1.5\n")

    def load(self, name, content):
        path = self.root / name
        path.write_text(content)
        self.worker.dispatch({"action": "import_data", "paths": [str(path)]})

    def formula(self, column, expression, source_id=None):
        return self.worker.dispatch({
            "action": "apply_formula", "source_id": source_id, "column": column, "expression": expression,
        })["project"]

    def test_row_wise_formula_creates_new_worksheet(self):
        result = self.formula(1, "$Data1:Current - #Data2:Current")
        self.assertEqual(result["source_table"]["rows"], (("10", "1.0", "0"), ("20", "1.5", "1")))
        self.assertEqual(result["original_rows"][0][1], "2")
        self.assertEqual(result["figures"], [])
        self.assertEqual(result["workflow"]["steps"][-1]["label"], "Analysis: Column Formula")

    def test_scalar_updates_and_bindings_survive_rename_and_reopen(self):
        scalar = self.worker.dispatch({"action": "add_scalar", "name": "SolResistance", "value": 2})["project"]
        scalar_step = scalar["workflow"]["steps"][-1]["id"]
        result = self.formula(0, "$Data1:Voltage - $Data1:Current * $SolResistance")
        self.assertEqual(result["source_table"]["rows"], (("6.0", "2", "0"), ("14.0", "3", "1")))
        self.worker.dispatch({
            "action": "edit_item", "item": {"kind": "source", "id": "raw:1"}, "name": "R solution",
        })
        self.worker.dispatch({"action": "edit_step", "step_id": scalar_step, "options": [{"value": 3}]})
        archive = self.root / "formula.nigiro"
        self.worker.dispatch({"action": "save", "path": str(archive)})
        reopened = Workspace()
        reopened.dispatch({"action": "open", "path": str(archive)})
        result = reopened.dispatch({"action": "run_all"})["project"]
        self.assertEqual(result["source_table"]["rows"], (("4.0", "2", "0"), ("11.0", "3", "1")))
        self.assertIn("R solution", [source["name"] for source in result["sources"]])

    def test_export_references_the_csv_and_keeps_the_scalar_as_a_parameter(self):
        self.worker.dispatch({"action": "add_scalar", "name": "SolResistance", "value": 2})
        self.formula(0, "$Data1:Voltage - $Data1:Current * $SolResistance")
        self.worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 2, "y": 0},
        })
        recipe = self.worker.dispatch({"action": "export_recipe"})["project"]
        script = self.root / "correction.py"
        self.worker.dispatch({
            "action": "export_script", "path": str(script), "template": "import json\n# Nigiro replay payload\n",
            "payload": {"recipe": recipe["script_recipe"], "operations": recipe["operations"]},
            "copy_raw_data": False,
        })
        result = runpy.run_path(str(script))["PAYLOAD"]["recipe"]
        self.assertEqual(result["sources"][0]["path"], str(self.root / "Data1.csv"))
        self.assertEqual(result["sources"][2], {"name": "SolResistance", "scalar_value": 2})
        formula = next(step for step in result["plugins"].values() if step["plugin_id"] == "nigiro.column_formula")
        self.assertEqual(formula["references"]["$SolResistance"], {"source_id": "raw:1", "column": 0})

    def test_quoted_and_numbered_references_with_functions(self):
        self.load("Reference data.csv", "Odd label (A),Repeated,Repeated\n9,4,2\n16,9,3\n")
        result = self.formula(1, 'sqrt($"Reference data.csv":"Odd label (A)") + $"Reference data.csv":3')
        self.assertEqual(tuple(row[1] for row in result["source_table"]["rows"]), ("5.0", "7.0"))

    def test_rejects_bad_shapes_and_unsupported_code(self):
        self.load("Long.csv", "Current\n1\n2\n3\n")
        with self.assertRaisesRegex(ValueError, r"has 3 rows"):
            self.formula(1, "$Data1:Current - $Long:Current")
        with self.assertRaisesRegex(ValueError, "needs a column name"):
            self.formula(1, "$Long")
        with self.assertRaisesRegex(ValueError, "supported math function"):
            self.formula(1, "__import__(1)")

    def test_formula_reads_scaling_at_its_workflow_position(self):
        first = self.formula(1, "$Data1:Current - $Data2:Current")
        self.worker.dispatch({
            "action": "scale_column", "factor": 2, "runs": [{"source_id": "raw:0", "column": 0}],
        })
        second = self.formula(1, "$Data1:Current - $Data2:Current")
        self.assertEqual(tuple(row[1] for row in second["source_table"]["rows"]), ("0.0", "0.0"))
        original = self.worker.dispatch({"action": "select_source", "source_id": first["source_id"]})["project"]
        self.assertEqual(tuple(row[1] for row in original["source_table"]["rows"]), ("1.0", "1.5"))
