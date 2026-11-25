"""Exercise EIS fitting, saved circuit options, and replay dependency pins."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from nigiro.builtin_plugins import BUILTINS
from nigiro.desktop import Workspace


class EISPluginTest(unittest.TestCase):
    def test_fit_saved_circuit_with_instrument_sign_and_lin_kk(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict("os.environ", {"NIGIRO_PLUGIN_DIR": str(Path(directory) / "plugins")}):
                folder = Path(directory)
                f = np.geomspace(0.1, 1e5, 70)
                z = 5 + 100 / (1 + 1j * 2 * np.pi * f * 100 * 20e-6)
                source = folder / "spectrum.csv"
                source.write_text("Hz,Zprime,negative_Zdoubleprime\n" +
                                  "".join(f"{hz},{value.real},{-value.imag}\n" for hz, value in zip(f, z)))
                workspace = Workspace()
                workspace.dispatch({"action": "import_data", "paths": [str(source)]})
                manifest, _ = BUILTINS["nigiro.eis_fit"]
                options = {field["key"]: field["default"] for field in manifest["fields"]}
                circuit = json.loads(options["circuit"])
                circuit["blocks"][0]["parameters"][0]["name"] = "solution"
                options.update(circuit=json.dumps(circuit), sign="negative_imaginary", lin_kk=True, starts=1)
                state = workspace.dispatch({"action": "execute_plugin", "plugin_id": "nigiro.eis_fit",
                                            "version": "1", "checksum": None, "output": "overlay",
                                            "runs": [{"source_id": None, "options": options}]})["project"]
                self.assertTrue(state["figure"]["summary"]["Solver converged"])
                self.assertEqual(state["figure"]["summary"]["Jacobian rank"], 3)
                self.assertLess(state["figure"]["summary"]["Lin-KK RMS residual (%)"], 0.1)
                parameters = next(table for key, table in workspace.sources.items() if key.endswith(":parameters"))
                self.assertEqual([line[0] for line in parameters.rows], ["solution", "Rct", "Cdl"])
                np.testing.assert_allclose([float(line[1]) for line in parameters.rows], [5, 100, 20e-6], rtol=1e-8)
                step = state["workflow"]["steps"][-1]
                self.assertEqual(step["editors"], {"circuit": "eis_circuit"})
                saved = folder / "fit.nigiro"
                workspace.dispatch({"action": "save", "path": str(saved)})
                reopened = Workspace()
                state = reopened.dispatch({"action": "open", "path": str(saved)})["project"]
                self.assertEqual(json.loads(state["figure"]["recipe"]["options"]["circuit"]), circuit)
                result = reopened.dispatch({"action": "run_all"})["project"]
                self.assertEqual(json.loads(result["figure"]["recipe"]["options"]["circuit"]), circuit)
                exported = reopened.dispatch({"action": "export_recipe"})["project"]["script_recipe"]
                self.assertEqual(exported["builtin_dependencies"]["impydance"], "0.1.0")
