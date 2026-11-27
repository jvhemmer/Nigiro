"""Recorded command replay, ordering, and persisted progress."""

import runpy
import tempfile
import unittest
from dataclasses import replace
from json import dumps, loads
from pathlib import Path

from nigiro.batch_figure import overlay_figures
from nigiro.builtin_plugins import BUILTINS, linear_fit_view
from nigiro.desktop import Workspace
from nigiro.project import PluginStep
from nigiro.source_tables import output_tables
from nigiro.settings import ProjectStorage


class WorkflowTest(unittest.TestCase):
    def test_group_batch_replays_current_members_even_when_the_group_is_empty(self):
        from unittest.mock import patch

        def split_peaks(_columns, rows, _options):
            count = int(rows[0][0])
            return {"sources": {
                f"peak-{index + 1}": {
                    "name": f"Peak {index + 1}",
                    "columns": ["Y", "X"] if index % 2 else ["X", "Y"],
                    "rows": [[2 * index + 2, index]] if index % 2 else [[index, 2 * index + 2]],
                } for index in range(count)
            }}

        producer = {"id": "test.split_peaks", "name": "Split Peaks", "menu": "analysis", "version": "1",
                    "table_only": True, "fields": []}
        with tempfile.TemporaryDirectory() as directory, patch.dict(BUILTINS, {producer["id"]: (producer, split_peaks)}):
            root = Path(directory)
            initial = root / "initial.csv"
            initial.write_text("Count\n1\n")
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "import_data", "paths": [str(initial)]})
            base = {"action": "execute_plugin", "checksum": None, "version": "1", "output": "separate"}
            worker.dispatch({**base, "plugin_id": "test.split_peaks", "runs": [{"source_id": None, "options": {}}],
                             "output_group": {"mode": "new", "name": "Peaks"}})
            worker.dispatch({**base, "plugin_id": "nigiro.filter_columns", "runs": [],
                             "input_group": {"id": "step:2", "options": {"columns": ["Y"]}},
                             "output_group": {"mode": "new", "name": "Processed peaks"}})

            for count in (3, 0, 2):
                replacement = root / f"peaks-{count}.csv"
                replacement.write_text(f"Count\n{count}\n")
                worker.dispatch({"action": "replace_import", "step_id": 1, "slot": 0, "path": str(replacement)})
                state = worker.dispatch({"action": "run_all"})["project"]
                self.assertIsNone(state["workflow"]["error"])
                self.assertEqual({group["name"] for group in state["source_groups"]}, {"Peaks", "Processed peaks"})
                results = [source for source in state["sources"] if source["group_id"] == "step:3"]
                self.assertEqual(len(results), count)
                self.assertTrue(all(source["columns"] == ("Y",) for source in results))
                self.assertEqual([worker.sources[source["id"]].rows for source in results],
                                 [((str(2 * index + 2),),) for index in range(count)])

            path = root / "peaks.nigiro"
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            edit = reopened.dispatch({"action": "plugin_step_inputs", "step_id": 3})
            self.assertEqual(edit["submission"]["input_group"], {"id": "step:2", "options": {"columns": ["Y"]}})
            self.assertEqual([group["id"] for group in edit["inputs"]["source_groups"]], ["step:2"])
            reopened.dispatch({"action": "edit_plugin_step", "step_id": 3, "submission": edit["submission"]})
            state = reopened.dispatch({"action": "run_all"})["project"]
            self.assertIsNone(state["workflow"]["error"])
            self.assertEqual(sum(source["group_id"] == "step:3" for source in state["sources"]), 2)

    def test_analysis_sources_can_join_an_existing_group_or_stay_ungrouped(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.dispatch({"action": "sample"})
        grouped = worker.dispatch({"action": "source_group", "mode": "create", "name": "Results"})["project"]
        group, = grouped["source_groups"]
        command = {
            "action": "execute_plugin", "plugin_id": "nigiro.integrate_peak", "version": "1", "checksum": None,
            "output": "separate", "runs": [{"source_id": None,
                "options": {"x": 0, "y": 1, "range": "1,5", "baseline": "endpoints"}}],
        }
        first = worker.dispatch({**command, "output_group": {"mode": "existing", "id": group["id"]}})["project"]
        self.assertEqual([source["group_id"] for source in first["sources"][1:]], [group["id"]] * 2)
        worker.dispatch({**command, "output_group": {"mode": "ungrouped"}})
        replay = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual([source["group_id"] for source in replay["sources"][1:]], [group["id"]] * 2 + [None] * 2)

    def test_reusable_workflow_restores_manual_input_group_members(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "settings.json"),
        }):
            root = Path(directory)
            a, b = root / "a.csv", root / "b.csv"
            a.write_text("X,Y\n1,2\n")
            b.write_text("Y,X\n3,4\n")
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "import_data", "paths": [str(a), str(b)]})
            state = worker.dispatch({"action": "source_group", "mode": "create", "name": "Inputs"})["project"]
            group, = state["source_groups"]
            for index, item in enumerate(state["sources"]):
                worker.dispatch({"action": "move_source", "source_id": item["id"], "destination": index,
                                 "placement": {"group_id": group["id"]}})
            state = worker.dispatch({"action": "execute_plugin", "plugin_id": "nigiro.filter_columns", "version": "1",
                                     "checksum": None, "output": "separate", "runs": [],
                                     "input_group": {"id": group["id"], "options": {"columns": ["Y"]}}})["project"]
            path = root / "group.nigiro-workflow"
            state = worker.dispatch({
                "action": "save_workflow", "path": str(path), "name": "Group",
                "inputs": {"1/source/0": "First", "1/source/1": "Second"},
                "outputs": [{"kind": "source", "id": source["id"], "name": f"Result {index}"}
                            for index, source in enumerate(state["sources"][2:])],
            })["project"]
            run = worker.dispatch({
                "action": "run_saved_workflow", "id": state["saved_workflows"][0]["id"], "name": "Grouped",
                "sources": {"1/source/0": None, "1/source/1": "raw:0"}, "numbers": {},
            })["project"]
            published = [source for source in run["sources"] if source["name"].startswith("Grouped · Result")]
            self.assertEqual([worker.sources[source["id"]].rows for source in published], [(("2",),), (("3",),)])

    def test_filter_rows_uses_one_based_inclusive_ranges_and_replays(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.dispatch({"action": "sample"})
        original = worker.project.worksheet.rows
        _, filter_rows = BUILTINS["nigiro.filter_rows"]
        for expression, expected in (("1:3", original[:3]), ("3:", original[2:]), ("3:end", original[2:]),
                                     ("3:-1", original[2:]), ("-2:-1", original[-2:]),
                                     ("end", original[-1:]), (":", original)):
            with self.subTest(expression=expression):
                result = filter_rows(worker.project.worksheet.columns, original, {"range": expression})
                self.assertEqual(result["sources"]["selected"]["rows"], expected)
        for expression in ("0:2", "9:", "4:2", "1:2:3"):
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                filter_rows(worker.project.worksheet.columns, original, {"range": expression})

        result = worker.dispatch({"action": "execute_plugin", "plugin_id": "nigiro.filter_rows", "version": "1",
                                  "checksum": None, "output": "separate",
                                  "runs": [{"source_id": None, "options": {"range": "2:4"}}]})["project"]
        self.assertFalse(result["figures"])
        self.assertEqual(result["source_table"]["rows"], original[1:4])
        self.assertEqual(result["source_table"]["columns"], worker.project.worksheet.columns)
        replayed = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(replayed["source_table"]["rows"], original[1:4])
        self.assertEqual(worker.project.worksheet.rows, original)

    def test_filter_columns_keeps_all_rows_and_replays_headers_by_name(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "input.csv"
            reordered = Path(directory) / "reordered.csv"
            first.write_text("A,B,C\n1,skip,2\n3,,4\n")
            reordered.write_text("C,B,A\n2,skip,1\n4,,3\n")
            worker.dispatch({"action": "import_data", "paths": [str(first)]})
            command = {"action": "execute_plugin", "plugin_id": "nigiro.filter_columns", "version": "1",
                       "checksum": None, "output": "separate",
                       "runs": [{"source_id": None, "options": {"columns": [2, 0]}}]}
            result = worker.dispatch(command)["project"]
            self.assertEqual(result["figures"], [])
            self.assertEqual(tuple(result["source_table"]["columns"]), ("A", "C"))
            self.assertEqual(result["source_table"]["rows"], (("1", "2"), ("3", "4")))
            self.assertEqual(worker.project.worksheet.columns, ("A", "B", "C"))
            step = worker.dispatch({"action": "plugin_step_inputs", "step_id": 2})
            self.assertEqual(step["submission"]["runs"][0]["options"]["columns"], ["C", "A"])
            worker.dispatch({"action": "replace_import", "step_id": 1, "slot": 0, "path": str(reordered)})
            replayed = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(tuple(replayed["source_table"]["columns"]), ("C", "A"))
            self.assertEqual(replayed["source_table"]["rows"], (("2", "1"), ("4", "3")))

    def test_plugin_edit_sees_only_earlier_sources_and_replays_named_columns(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        with tempfile.TemporaryDirectory() as directory:
            first, second, reordered = (Path(directory) / name for name in ("first.csv", "second.csv", "reordered.csv"))
            first.write_text("Potential,Current\n0,0\n1,2\n2,0\n")
            second.write_text("Current,Potential\n0,0\n5,1\n0,2\n")
            reordered.write_text("Spare,Potential,Current\n6,0,0\n7,1,8\n8,2,0\n")
            worker.dispatch({"action": "import_data", "paths": [str(first)]})
            worker.dispatch({
                "action": "execute_plugin", "plugin_id": "nigiro.integrate_peak", "version": "1", "checksum": None,
                "output": "overlay", "runs": [{"source_id": None,
                    "options": {"x": 0, "y": 1, "range": "0,2", "baseline": "endpoints"}}],
            })
            worker.dispatch({"action": "import_data", "paths": [str(second)]})
            inspect = {"action": "plugin_step_inputs", "step_id": 2}
            context = worker.dispatch(inspect)
            self.assertEqual([source["name"] for source in context["inputs"]["sources"]], ["first.csv"])
            self.assertEqual(context["submission"]["runs"][0]["options"]["x"], "Potential")

            worker.dispatch({"action": "move_step", "step_id": 2, "direction": 1})
            context = worker.dispatch(inspect)
            self.assertEqual([source["name"] for source in context["inputs"]["sources"]], ["first.csv", "second.csv"])
            submission = context["submission"]
            run = submission["runs"][0]
            run.update(source_id="raw:0", options={**run["options"], "x": 1, "y": 0})
            edited = worker.dispatch({"action": "edit_plugin_step", "step_id": 2, "submission": submission})["project"]
            self.assertTrue(edited["workflow"]["needs_replay"])
            self.assertEqual(edited["figure"]["summary"]["Signed area"], 2)
            saved = worker.workflow.steps[-1].request["runs"][0]
            self.assertEqual(saved["source_id"], {"output": "3/source/0"})
            self.assertEqual((saved["options"]["x"], saved["options"]["y"]), ("Potential", "Current"))

            worker.dispatch({"action": "replace_import", "step_id": 3, "slot": 0, "path": str(reordered)})
            result = worker.dispatch({"action": "run_all"})["project"]
            self.assertIsNone(result["workflow"]["error"])
            self.assertEqual(result["figure"]["summary"]["Signed area"], 8)
            recipe = worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]
            self.assertEqual(next(iter(recipe["plugins"].values()))["named_columns"], ["x", "y"])

    def test_peak_source_group_and_trace_edits_survive_replay(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.dispatch({"action": "sample"})
        peak = worker.dispatch({
            "action": "execute_plugin", "plugin_id": "nigiro.integrate_peak", "version": "1", "checksum": None,
            "output": "overlay", "runs": [{"source_id": None,
                "options": {"x": 0, "y": 1, "range": "1,5", "baseline": "endpoints"}}],
        })["project"]
        group, = peak["source_groups"]
        self.assertEqual(group["name"], "Integrate Peak 1")
        self.assertEqual([source["group_name"] for source in peak["sources"] if source["group_id"] == group["id"]],
                         ["Peak area", "Baseline"])
        worker.dispatch({"action": "source_group", "mode": "create", "name": "Results"})
        project = worker.dispatch({"action": "source_group", "mode": "toggle", "group_id": group["id"]})["project"]
        custom, = [entry for entry in project["source_groups"] if entry["name"] == "Results"]
        area = next(source for source in project["sources"] if source.get("group_name") == "Peak area")
        worker.dispatch({"action": "move_source", "source_id": area["id"], "destination": 2,
                         "placement": {"group_id": custom["id"]}})
        base = {"action": "trace_style", "figure_id": peak["figure_id"]}
        fill = {"color": "transparent", "opacity": 0.35}
        worker.dispatch({**base, "trace": 1, "style": {"color": "#224466", "width": 2, "dash": "dot"}})
        worker.dispatch({**base, "trace": 1, "style": None})
        batch = {"action": "inspect_style", "figure_id": peak["figure_id"], "trace": 1}
        fill_change = {"action": "trace_style", "trace": 1, "kind": "fill", "style": fill}
        order_change = {"action": "trace_style", "trace": 0, "kind": "order", "style": {"zorder": -1}}
        with self.assertRaisesRegex(ValueError, "draw order"):
            worker.dispatch({**batch, "changes": [fill_change, {**order_change, "style": {"zorder": 10001}}]})
        self.assertEqual(worker.project.figures[peak["figure_id"]].trace_styles, {})
        line_change = {"action": "trace_style", "trace": 1, "kind": "line", "style": {"color": "#224466", "width": 3}}
        legend = {"name": "Peak $$i_1$$", "showlegend": False}
        legend_change = {"action": "trace_style", "trace": 1, "kind": "legend", "style": legend}
        worker.dispatch({**batch, "changes": [line_change]})
        edited = worker.dispatch({
            **batch, "changes": [fill_change, order_change, {**line_change, "style": {"width": 3}}, legend_change],
        })["project"]
        repeated = worker.dispatch({**batch, "changes": []})["project"]
        self.assertEqual(repeated["trace_styles"], edited["trace_styles"])
        self.assertEqual(len(repeated["workflow"]["steps"]), len(edited["workflow"]["steps"]) + 1)
        self.assertEqual(repeated["workflow"]["steps"][-1]["status"], "done")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "peak.nigiro"
            worker.settings.project_storage = ProjectStorage(embed_calculated_sources=True)
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            for request in ({"action": "open", "path": str(path)}, {"action": "run_all"}):
                project = reopened.dispatch(request)["project"]
                self.assertEqual(project["trace_styles"], {1: {"fill": fill, "width": 3, "legend": legend}, 0: {"zorder": -1}})
                self.assertTrue(project["source_groups"][0]["collapsed"])
                self.assertEqual(next(source for source in project["sources"] if source["id"] == area["id"])["group_id"],
                                 custom["id"])
            project = reopened.dispatch({"action": "source_group", "mode": "delete", "group_id": custom["id"]})["project"]
            self.assertIsNone(next(source for source in project["sources"] if source["id"] == area["id"])["group_id"])
            project = reopened.dispatch({"action": "source_group", "mode": "delete", "group_id": group["id"]})["project"]
            self.assertEqual(project["source_groups"], [])
            self.assertEqual(len(project["sources"]), 3)

    def test_replace_import_and_edit_rename_keep_downstream_references(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        with tempfile.TemporaryDirectory() as directory:
            first, second = (Path(directory) / name for name in ("before.csv", "after.csv"))
            first.write_text("X,Y\n0,1\n1,2\n")
            second.write_text("X,Y\n0,3\n1,4\n")
            worker.dispatch({"action": "import_data", "paths": [str(first)]})
            worker.dispatch({"action": "edit_item", "item": {"kind": "source", "id": None}, "name": "Before"})
            worker.dispatch({
                "action": "execute_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                "output": "overlay", "runs": [{"source_id": None, "options": {"x": 0, "y": 1}}],
            })
            worker.dispatch({"action": "edit_step", "step_id": 2, "options": [{"name": "After"}]})
            stale = worker.dispatch({"action": "replace_import", "step_id": 1, "slot": 0, "path": str(second)})["project"]
            self.assertEqual(stale["workflow"]["steps"][0]["files"], [str(second)])
            self.assertEqual(stale["workflow"]["steps"][2]["status"], "stale")
            self.assertEqual(stale["sources"][0]["name"], "Before")
            replay = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replay["sources"][0]["name"], "After")
            self.assertEqual(replay["sources"][0]["original_path"], str(second))
            self.assertEqual(replay["figure"]["traces"][0]["y"], [3, 4])

    def test_overlay_keeps_input_figures_and_replays_with_one_pair_of_axes(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.dispatch({"action": "sample"})
        plot = {"action": "execute_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                "output": "overlay", "runs": [{"source_id": None, "options": {"x": 0, "y": 1}}]}
        first = worker.dispatch(plot)["project"]["figure_id"]
        second = worker.dispatch({**plot, "plugin_id": "nigiro.scatter"})["project"]["figure_id"]
        worker.dispatch({"action": "figure_style", "figure_id": second, "style": {"x": {"label": "Common X"}}})
        overlay = worker.dispatch({"action": "overlay_figures", "figure_ids": [second, first]})["project"]
        self.assertEqual([figure["id"] for figure in overlay["figures"]], [first, second, overlay["figure_id"]])
        self.assertEqual([trace["name"] for trace in overlay["figure"]["traces"]], ["Scatter 1", "Line 1"])
        self.assertEqual([trace["mode"] for trace in overlay["figure"]["traces"]], ["markers", "lines"])
        self.assertEqual(overlay["figure_style"]["x"]["label"], "Common X")
        self.assertEqual(overlay["workflow"]["steps"][-1]["label"], "Plot: Overlay")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "overlay.nigiro"
            combined = worker.dispatch({"action": "overlay_figures", "figure_ids": [overlay["figure_id"], first]})["project"]
            self.assertEqual(combined["figure"]["series_cycle"], [0, 1, 2])
            worker.settings.project_storage = ProjectStorage(embed_calculated_sources=True)
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            self.assertEqual(reopened.dispatch({"action": "open", "path": str(path)})["project"]["figure"], combined["figure"])
            replay = reopened.dispatch({"action": "run_all"})["project"]["figure"]
            traces = combined["figure"]["traces"]
            self.assertEqual(replay["traces"], traces)
            recipe = loads(dumps(reopened.dispatch({"action": "export_recipe"})["project"]["script_recipe"]))
            replay_figure = runpy.run_path(str(Path(__file__).resolve().parents[1] / "frontend/replay.py"), init_globals={
                "BUILTINS": BUILTINS, "PluginStep": PluginStep, "output_tables": output_tables,
                "REFERENCE_FORMULA_PLUGINS": set(), "linear_fit_view": linear_fit_view, "overlay_figures": overlay_figures,
            })["replay_figure"]
            self.assertEqual(replay_figure(reopened.project, {"traces": [{}, {}, {}], "layout": {}}, recipe)["traces"], traces)

        bar = worker.dispatch({**plot, "plugin_id": "nigiro.bar"})["project"]["figure_id"]
        with self.assertRaisesRegex(ValueError, "different types of X axes"):
            worker.dispatch({"action": "overlay_figures", "figure_ids": [first, bar]})
        self.assertEqual(worker.figure_id, bar)

    def test_line_style_persists_for_only_the_selected_trace(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lines.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "sample"})
            plot = {"action": "execute_plugin", "plugin_id": "nigiro.line", "version": "1", "checksum": None,
                    "output": "overlay", "runs": [{"source_id": None, "options": {"x": 0, "y": 1}}]}
            first = worker.dispatch(plot)["project"]["figure_id"]
            layered = worker.dispatch({**plot, "target_id": first})["project"]
            self.assertEqual(len(layered["figure"]["traces"]), 2)
            style = {"color": "#3548a0", "width": 2.5, "dash": "dashdot"}
            command = {"action": "trace_style", "figure_id": first, "trace": 1, "style": style}
            self.assertEqual(worker.dispatch(command)["project"]["trace_styles"], {1: style})
            worker.settings.project_storage = ProjectStorage(embed_calculated_sources=True)
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            self.assertEqual(reopened.dispatch({"action": "open", "path": str(path)})["project"]["trace_styles"], {1: style})
            self.assertEqual(reopened.dispatch({"action": "run_all"})["project"]["trace_styles"], {1: style})
            self.assertEqual(reopened.dispatch({**command, "style": None})["project"]["trace_styles"], {})

    def test_project_notes_survive_save_and_workflow_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "sample"})
            notes = "# Procedure\n\n- [x] Import measurements"
            worker.dispatch({"action": "save", "path": str(path), "notes": notes})
            reopened = Workspace()
            self.assertEqual(reopened.dispatch({"action": "open", "path": str(path)})["project"]["notes"], notes)
            self.assertEqual(reopened.dispatch({"action": "run_all"})["project"]["notes"], notes)
            self.assertEqual(reopened.dispatch({"action": "new"})["project"]["notes"], "")

    def test_source_comments_survive_open_and_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "comments.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "add_scalar", "name": "R", "value": 2, "comment": "Solution resistance"})
            worker.dispatch({"action": "add_array", "name": "Current", "values": "1,2,3", "comment": "Measured in A"})
            worker.dispatch({"action": "add_array", "name": "Drop", "expression": "$Current:Value * $R",
                             "comment": "Calculated in V\nUses measured current"})
            worker.dispatch({"action": "add_scalar", "name": "Blank", "value": 1, "comment": "  "})
            worker.settings.project_storage = ProjectStorage(embed_calculated_sources=True)
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            expected = {"R": "Solution resistance", "Current": "Measured in A",
                        "Drop": "Calculated in V\nUses measured current", "Blank": None}
            for request in ({"action": "open", "path": str(path)}, {"action": "run_all"}):
                sources = reopened.dispatch(request)["project"]["sources"]
                self.assertEqual({source["name"]: source.get("comment") for source in sources}, expected)

    def test_reusable_workflow_rebinds_inputs_and_keeps_runs_separate(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "settings.json"),
        }):
            root = Path(directory)
            example, other = root / "example.csv", root / "other.csv"
            example.write_text("E,I\n1,2\n3,4\n")
            other.write_text("E,I\n5,6\n7,8\n")
            template = Workspace()
            template.dispatch({"action": "import_data", "paths": [str(example)]})
            template.dispatch({"action": "add_scalar", "name": "R", "value": 2})
            template.dispatch({"action": "scale_column", "runs": [{"source_id": None, "column": 1}], "factor": 10})
            template.dispatch({"action": "add_array", "name": "Corrected", "expression": "$example:E - $example:I * $R"})
            path = root / "correction.nigiro-workflow"
            template.dispatch({
                "action": "save_workflow", "path": str(path), "name": "Correction", "steps": [1, 2, 3, 4],
                "inputs": {"1/source/0": "Data", "2/source/0": "Resistance"},
                "outputs": [{"kind": "source", "id": template.source_id, "name": "Potential"}],
            })
            self.assertNotIn(str(example), path.read_text())

            worker = Workspace()
            imported = worker.dispatch({"action": "import_workflow", "path": str(path)})["project"]
            worker.dispatch({"action": "import_data", "paths": [str(other)]})
            run = {"action": "run_saved_workflow", "id": imported["saved_workflows"][0]["id"],
                   "sources": {"1/source/0": None}}
            first = worker.dispatch({**run, "name": "First", "numbers": {"2/source/0": 1}})["project"]
            self.assertEqual(first["source_table"]["rows"], (("-55.0",), ("-73.0",)))
            second = worker.dispatch({**run, "name": "Second", "numbers": {"2/source/0": 2}})["project"]
            self.assertEqual(second["source_table"]["rows"], (("-115.0",), ("-153.0",)))
            self.assertEqual([source["name"] for source in second["sources"]],
                             ["other.csv", "First · Potential", "Second · Potential"])
            self.assertEqual([source.get("workflow_run") for source in second["sources"]], [None, "First", "Second"])
            self.assertEqual(second["sources"][-1]["detail"], "= $example:E - $example:I * $R")
            self.assertEqual(worker.project.working_worksheets[None].rows[0], ("5", "6"))
            saved = root / "runs.nigiro"
            worker.dispatch({"action": "save", "path": str(saved)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(saved)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["source_table"]["rows"], second["source_table"]["rows"])
            self.assertEqual(replayed["sources"][-1]["workflow_run"], "Second")
            self.assertEqual(replayed["workflow"]["completed"], 3)

    def test_workflow_exposure_keeps_internal_steps_and_stable_output_references(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {
            "NIGIRO_SETTINGS_PATH": str(Path(directory) / "settings.json"),
        }):
            root = Path(directory)
            data = root / "data.csv"
            data.write_text("E,I\n1,2\n3,4\n")
            template = Workspace()
            template.settings.run_automatically = True
            template.dispatch({"action": "import_data", "paths": [str(data)]})
            template.dispatch({"action": "add_scalar", "name": "R", "value": 2})
            template.dispatch({"action": "add_array", "name": "First", "expression": "$data:E"})
            first = template.source_id
            template.dispatch({"action": "add_array", "name": "Second", "expression": "$data:I * $R"})
            second = template.source_id
            outputs = [{"kind": "source", "id": first, "name": "First"},
                       {"kind": "source", "id": second, "name": "Second"}]
            for name in ("Correction", "Alternate"):
                template.dispatch({"action": "save_workflow", "path": str(root / f"{name}.nigiro-workflow"),
                                   "name": name, "inputs": {"1/source/0": "Data"}, "outputs": outputs})

            with patch.dict("os.environ", {"NIGIRO_SETTINGS_PATH": str(root / "worker" / "settings.json")}):
                worker = Workspace()
            worker.settings.run_automatically = True
            imported = worker.dispatch({"action": "import_workflow", "paths": [
                str(root / f"{name}.nigiro-workflow") for name in ("Correction", "Alternate")
            ]})["project"]["saved_workflows"]
            self.assertEqual({record["name"] for record in imported}, {"Correction", "Alternate"})
            correction = next(record for record in imported if record["name"] == "Correction")
            self.assertEqual([port["name"] for port in correction["inputs"]], ["Data"])
            worker.dispatch({"action": "import_data", "paths": [str(data)]})
            result = worker.dispatch({"action": "run_saved_workflow", "id": correction["id"], "name": "Run",
                                      "sources": {"1/source/0": None}, "numbers": {}})["project"]
            self.assertEqual(result["source_table"]["rows"], (("4.0",), ("8.0",)))
            worker.dispatch({"action": "edit_item", "item": {"kind": "source", "id": worker.source_id}, "name": "Kept"})
            ports = worker.dispatch({"action": "workflow_step_ports", "step_id": 2})
            self.assertIsNone(ports["warning"])
            self.assertEqual({port["name"]: port["exposed"] for port in ports["inputs"]}, {"Data": True, "R": False})
            worker.dispatch({"action": "edit_workflow_ports", "step_id": 2,
                             "inputs": {"1/source/0": {"name": "Data", "exposed": False},
                                        "2/source/0": {"name": "Resistance", "exposed": True}},
                             "outputs": [port for port in ports["outputs"] if port["name"] == "Second"]})
            worker.dispatch({"action": "edit_workflow_run", "step_id": 2, "name": "Adjusted",
                             "sources": {}, "numbers": {"2/source/0": 3}})
            replay = worker.dispatch({"action": "run_all"})["project"]
            self.assertIsNone(replay["workflow"]["error"])
            self.assertEqual(replay["workflow"]["steps"][1]["label"], "Workflow: Adjusted")
            self.assertEqual(replay["workflow"]["steps"][1]["workflow_inputs"], ["Resistance"])
            self.assertEqual([source["name"] for source in replay["sources"]], ["data.csv", "Kept"])
            self.assertEqual(replay["source_table"]["rows"], (("6.0",), ("12.0",)))
            self.assertEqual([port["name"] for port in worker.saved_workflows[correction["id"]]["outputs"]], ["First", "Second"])

            project = root / "edited-run.nigiro"
            worker.dispatch({"action": "save", "path": str(project)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(project)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertIsNone(replayed["workflow"]["error"])
            self.assertEqual(replayed["source_table"]["rows"], replay["source_table"]["rows"])

            parent = root / "parent.nigiro-workflow"
            worker.dispatch({"action": "save_workflow", "path": str(parent), "name": "Parent",
                             "inputs": {"1/source/0": "Data"},
                             "outputs": [{"kind": "source", "id": worker.source_id, "name": "Nested result"}]})
            catalog = worker.dispatch({"action": "state"})["project"]["saved_workflows"]
            parent_id = next(record["id"] for record in catalog if record["name"] == "Parent")
            nested = worker.dispatch({"action": "run_saved_workflow", "id": parent_id, "name": "Combined",
                                      "sources": {"1/source/0": None}, "numbers": {}})["project"]
            self.assertEqual(nested["sources"][-1]["name"], "Combined · Nested result")
            self.assertEqual(nested["source_table"]["rows"], (("6.0",), ("12.0",)))

    def test_plot_paired_arrays_and_replay_export(self):
        import json
        from nigiro.builtin_plugins import BUILTINS
        from nigiro.project import PluginStep
        from nigiro.source_tables import output_tables

        worker = Workspace()
        worker.settings.run_automatically = True
        worker.dispatch({"action": "add_array", "name": "Time", "values": "1,2,3"})
        worker.dispatch({"action": "add_array", "name": "Signal", "expression": "$Time:Value * 2"})
        command = {
            "action": "execute_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "output": "overlay", "runs": [{
                "source_id": None, "options": {"x": 0, "y": 1},
                "references": {"x": {"source_id": None, "column": 0},
                               "y": {"source_id": worker.source_id, "column": 0}},
            }],
        }
        result = worker.dispatch(command)["project"]["figure"]
        self.assertEqual((result["x_label"], result["y_label"]), ("Time", "Signal"))
        trace = result["traces"][0]
        self.assertEqual((trace["x"], trace["y"]), ([1, 2, 3], [2, 4, 6]))
        replay = worker.dispatch({"action": "run_all"})["project"]["figure"]
        self.assertEqual(replay["traces"][0], trace)
        recipe = json.loads(json.dumps(worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]))
        replay_figure = runpy.run_path(str(Path(__file__).resolve().parents[1] / "frontend/replay.py"), init_globals={
            "BUILTINS": BUILTINS, "PluginStep": PluginStep, "output_tables": output_tables,
            "REFERENCE_FORMULA_PLUGINS": {"nigiro.array_formula"},
        })["replay_figure"]
        exported = replay_figure(worker.project, {"traces": [{}], "layout": {}}, recipe)
        self.assertEqual(exported["traces"][0], trace)
        worker.dispatch({"action": "add_array", "name": "Short", "values": "1,2"})
        command["runs"][0]["references"]["y"]["source_id"] = worker.source_id
        with self.assertRaisesRegex(ValueError, "same number of rows"):
            worker.dispatch(command)

    def test_filter_segments_preserves_all_matching_rows_in_source_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cv.csv"
            path.write_text("Segment,Potential,Current\n2,0.2,1\n3,0.3,2\n1.0,0.4,3\n2,0.5,4\n")
            worker = Workspace()
            worker.settings.run_automatically = True
            worker.dispatch({"action": "import_data", "paths": [str(path)]})
            command = {
                "action": "execute_plugin", "plugin_id": "nigiro.filter_segments", "version": "1",
                "checksum": None, "output": "separate",
                "runs": [{"source_id": None, "options": {"column": 0, "segments": "1, 2, 2, 5"}}],
            }
            result = worker.dispatch(command)["project"]
            expected = (("2", "0.2", "1"), ("1.0", "0.4", "3"), ("2", "0.5", "4"))
            self.assertEqual(result["source_table"]["columns"], ("Segment", "Potential", "Current"))
            self.assertEqual(result["source_table"]["rows"], expected)
            self.assertEqual(result["figures"], [])
            replayed = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["source_table"]["rows"], expected)

    def test_array_values_and_row_offsets_replay_after_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "arrays.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = True
            entered = worker.dispatch({"action": "add_array", "name": "Data", "values": "1, 2\n4 8"})["project"]
            self.assertEqual(entered["sources"][0]["detail"], "= [1.0, 2.0, 4.0, 8.0]")
            expression = "$Data:Value(i) - $Data:Value(i+1)"
            calculated = worker.dispatch({"action": "add_array", "name": "Difference", "expression": expression})["project"]
            self.assertEqual(calculated["sources"][-1]["array_step"], calculated["workflow"]["steps"][-1]["id"])
            self.assertEqual(calculated["source_table"]["rows"], (("-1.0",), ("-2.0",), ("-4.0",), ("",)))
            self.assertEqual(calculated["source_table"]["name"], "Difference")
            self.assertEqual(calculated["sources"][-1]["detail"], f"= {expression}")
            recipe = worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]
            self.assertEqual(next(iter(recipe["plugins"].values()))["options"]["expression"], expression)
            step = entered["workflow"]["steps"][0]["id"]
            self.assertEqual(entered["sources"][0]["array_step"], step)
            worker.dispatch({"action": "edit_item", "item": {"kind": "source", "id": None}, "name": "Renamed"})
            renamed = worker.dispatch({"action": "run_all"})["project"]
            self.assertEqual(renamed["sources"][0]["name"], "Renamed")
            self.assertEqual(renamed["source_table"]["rows"], calculated["source_table"]["rows"])
            worker.dispatch({"action": "edit_step", "step_id": step, "options": [{"values": "2,4,8"}]})
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["source_table"]["rows"], (("-2.0",), ("-4.0",), ("",)))

    def test_delete_only_executed_step_then_save_and_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deleted.nigiro"
            worker = Workspace()
            imported = worker.dispatch({"action": "sample"})["project"]
            step_id = imported["workflow"]["steps"][0]["id"]
            deleted = worker.dispatch({"action": "delete_step", "step_id": step_id})["project"]
            self.assertEqual(deleted["workflow"]["steps"], [])
            self.assertTrue(deleted["workflow"]["needs_replay"])
            worker.dispatch({"action": "save", "path": str(path)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(path)})
            replayed = reopened.dispatch({"action": "run_next"})["project"]
            self.assertFalse(replayed["sources"])
            self.assertFalse(replayed["workflow"]["needs_replay"])

    def test_delete_import_removes_its_renames_and_allows_a_fresh_import(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "replacement.csv"
            path.write_text("X,Y\n1,2\n")
            worker = Workspace()
            initial = worker.dispatch({"action": "sample"})["project"]
            producer = initial["workflow"]["steps"][0]["id"]
            for name in ("First name", "Second name"):
                worker.dispatch({"action": "edit_item", "item": {"kind": "source", "id": None}, "name": name})
            deleted = worker.dispatch({"action": "delete_step", "step_id": producer})["project"]
            self.assertEqual(deleted["workflow"]["steps"], [])
            replayed = worker.dispatch({"action": "run_all"})["project"]
            self.assertIsNone(replayed["workflow"]["error"])
            self.assertEqual(replayed["sources"], [])
            imported = worker.dispatch({"action": "import_data", "paths": [str(path)]})["project"]
            self.assertEqual(imported["workflow"]["steps"][0]["status"], "done")
            self.assertEqual(imported["sources"][0]["name"], path.name)

    def test_deleted_producer_does_not_rebind_to_a_new_step(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        plotted = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        producer = plotted["workflow"]["steps"][0]["id"]
        deleted = worker.dispatch({"action": "delete_step", "step_id": producer})["project"]
        self.assertEqual(deleted["workflow"]["steps"][0]["status"], "stale")
        replacement = worker.dispatch({"action": "sample"})["project"]["workflow"]["steps"][-1]
        worker.dispatch({"action": "move_step", "step_id": replacement["id"], "direction": -1})
        replayed = worker.dispatch({"action": "run_all"})["project"]
        self.assertIn("deleted step", replayed["workflow"]["error"])

    def test_recorded_labels_describe_the_action_and_plugin(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        for identifier in ("nigiro.scatter", "nigiro.linear_fit"):
            worker.dispatch({
                "action": "run_plugin", "plugin_id": identifier, "version": "1", "checksum": None,
                "options": {"x": 0, "y": 1},
            })
        figure_id = worker.snapshot()["project"]["figure_id"]
        for name in ("Fit", None):
            result = worker.dispatch({
                "action": "edit_item", "item": {"kind": "figure", "id": figure_id}, "name": name,
            })["project"]
        steps = result["workflow"]["steps"][1:]
        self.assertEqual([step["label"] for step in steps],
                         ["Plot: Scatter", "Analysis: Linear Fit", "Rename item", "Remove item"])
        self.assertEqual(steps[0]["plugin"], {"id": "nigiro.scatter", "menu": "plot"})
        self.assertEqual(steps[1]["plugin"], {"id": "nigiro.linear_fit", "menu": "analysis"})
        self.assertEqual(steps[3]["action"], "edit_item")
        project = worker.dispatch({"action": "add_scalar", "name": "Resistance", "value": 3})["project"]
        step = project["workflow"]["steps"][-1]
        self.assertEqual((step["action"], step["label"]), ("add_scalar", "Add variable Resistance"))

    def test_python_script_references_original_paths_or_copied_csvs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "input.csv"
            original = b"X,Y\n0,123456.789\n1,987654.321\n"
            csv.write_bytes(original)
            worker = Workspace()
            worker.dispatch({"action": "import_data", "paths": [str(csv)]})
            worker.dispatch({"action": "plot", "plot_type": "scatter", "x": 0, "y": 1})
            recipe = worker.dispatch({"action": "export_recipe"})["project"]
            self.assertNotIn("figure", recipe)
            self.assertNotIn("sources", recipe["script_recipe"])
            script = root / "figure.py"
            export = {
                "action": "export_script", "path": str(script), "template": "import json\n# Nigiro replay payload\n",
                "payload": {"recipe": recipe["script_recipe"], "operations": recipe["operations"]},
                "copy_raw_data": False,
            }
            worker.dispatch(export)
            source = runpy.run_path(str(script))["PAYLOAD"]["recipe"]["sources"][0]
            self.assertEqual(source["path"], str(csv))
            self.assertNotIn("content", source)
            self.assertNotIn("123456.789", script.read_text())
            self.assertFalse((root / "imports").exists())

            # Re-export with copies after the original input changes.
            csv.write_bytes(b"X,Y\n0,1\n1,2\n")
            (root / "imports").mkdir()
            (root / "imports/source-001.csv").write_text("existing")
            worker.dispatch({**export, "copy_raw_data": True})
            source = runpy.run_path(str(script))["PAYLOAD"]["recipe"]["sources"][0]
            self.assertEqual(source["path"], "imports/source-001-2.csv")
            self.assertEqual((root / source["path"]).read_bytes(), original)
            self.assertNotIn(str(csv), script.read_text())
            self.assertNotIn("123456.789", script.read_text())

    def test_python_script_without_an_original_path_requires_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Workspace()
            worker.dispatch({"action": "sample"})
            script = Path(directory) / "sample.py"
            with self.assertRaisesRegex(ValueError, "Enable Copy raw data files"):
                worker.dispatch({
                    "action": "export_script", "path": str(script), "template": "import json\n# Nigiro replay payload\n",
                    "payload": {"recipe": {}}, "copy_raw_data": False,
                })
            self.assertFalse(script.exists())

    def test_batch_scaling_and_source_order_survive_replay_and_save(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second, archive = (Path(directory) / name for name in ("a.csv", "b.csv", "project.nigiro"))
            first.write_text("X,Y\n1,2\n2,3\n")
            second.write_text("Y,X\n3,1\n4,2\n")
            worker = Workspace()
            worker.dispatch({"action": "import_data", "paths": [str(first), str(second)]})
            scaled = worker.dispatch({"action": "scale_column", "factor": 2, "runs": [
                {"source_id": None, "column": 1}, {"source_id": "raw:0", "column": 0},
            ]})["project"]
            self.assertEqual(scaled["rows"][0], ("1", "4.0"))
            reordered = worker.dispatch({"action": "move_source", "source_id": "raw:0", "destination": 0})["project"]
            self.assertEqual(reordered["workflow"]["completed"], 2)
            self.assertEqual(reordered["sources"][0]["name"], second.name)
            worker.dispatch({"action": "save", "path": str(archive)})
            reopened = Workspace()
            reopened.dispatch({"action": "open", "path": str(archive)})
            replayed = reopened.dispatch({"action": "run_all"})["project"]
            self.assertEqual(replayed["sources"][0]["original_path"], str(second))
            result = reopened.dispatch({"action": "select_source", "source_id": "raw:0"})["project"]
            self.assertEqual(result["source_table"]["rows"][0], ("6.0", "1"))

    def test_replay_keeps_recorded_figure_defaults(self):
        worker = Workspace()
        worker.settings.run_automatically = True
        worker.settings.figure_style = replace(worker.settings.figure_style, font_family="Liberation Sans")
        worker.dispatch({"action": "sample"})
        worker.dispatch({"action": "plot", "plot_type": "scatter", "x": 0, "y": 1})
        worker.settings.figure_style = replace(worker.settings.figure_style, font_family="DejaVu Serif")
        result = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(result["figure_style"]["font_family"], "Liberation Sans")

    def test_filter_outputs_a_source_and_replays_its_dependents(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        command = {
            "action": "execute_plugin", "plugin_id": "nigiro.filter", "version": "1", "checksum": None,
            "output": "separate", "runs": [{"source_id": None, "options": {
                "column": 1, "expression": "value > 6", "output": "rows",
            }}],
        }
        filtered = worker.dispatch(command)["project"]
        self.assertEqual(filtered["figures"], [])
        self.assertEqual(len(filtered["source_table"]["columns"]), 2)
        self.assertEqual(filtered["row_count"], 5)
        plotted = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        self.assertEqual(plotted["figure"]["traces"][0]["y"], [6.5, 8.9, 10.2, 13.4, 14.5])
        replay = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(replay["figure"]["traces"], plotted["figure"]["traces"])
        values = worker.dispatch({**command, "runs": [{"source_id": None, "options": {
            "column": 1, "expression": "value < 3", "output": "values",
        }}]})["project"]
        self.assertEqual(values["source_table"]["columns"], ("Signal",))
        self.assertEqual(values["source_table"]["rows"], (("1",), ("2.9",)))

    def test_edit_and_move_a_scale_step(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        scatter = {"action": "plot", "plot_type": "scatter", "x": 0, "y": 1}
        worker.dispatch(scatter)
        worker.dispatch({"action": "scale_column", "column": 1, "factor": 2})
        initial = worker.dispatch(scatter)["project"]
        self.assertEqual(initial["figure"]["traces"][0]["y"][0], 2)
        earlier_id = initial["figures"][0]["id"]
        earlier = worker.dispatch({"action": "select_figure", "figure_id": earlier_id})["project"]
        self.assertEqual(earlier["figure"]["traces"][0]["y"][0], 1)
        scale_id = initial["workflow"]["steps"][2]["id"]
        edited = worker.dispatch({"action": "edit_step", "step_id": scale_id, "options": [{"factor": 3}]})["project"]
        self.assertEqual([step["status"] for step in edited["workflow"]["steps"]], ["done", "done", "stale", "stale"])
        next_step = worker.dispatch({"action": "run_next"})["project"]
        self.assertEqual(next_step["workflow"]["completed"], 3)
        self.assertEqual(next_step["rows"][0][1], "3.0")
        worker.dispatch({"action": "move_step", "step_id": scale_id, "direction": -1})
        rerun = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(rerun["workflow"]["completed"], 4)
        first = worker.dispatch({"action": "select_figure", "figure_id": rerun["figures"][0]["id"]})["project"]
        self.assertEqual(first["figure"]["traces"][0]["y"][0], 3)
        self.assertEqual(first["original_rows"][0][1], "1")

    def test_queued_import_survives_save_and_original_csv_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "data.csv"
            csv.write_text("X,Y\n0,1\n1,2\n")
            path = root / "pending.nigiro"
            worker = Workspace()
            worker.settings.run_automatically = False
            pending = worker.dispatch({"action": "import_data", "paths": [str(csv)]})["project"]
            self.assertFalse(pending["sources"])
            self.assertEqual(pending["workflow"]["steps"][0]["status"], "pending")
            worker.settings.project_storage = ProjectStorage(embed_files=True)
            worker.dispatch({"action": "set_project_properties", "overrides": {}, "run_on_open": False})
            worker.dispatch({"action": "save", "path": str(path)})
            csv.unlink()
            other = Workspace()
            reopened = other.dispatch({"action": "open", "path": str(path)})["project"]
            self.assertEqual(reopened["workflow"]["completed"], 0)
            restored = other.dispatch({"action": "run_next"})["project"]
            self.assertEqual(restored["rows"][0], ("0", "1"))
            self.assertEqual(restored["workflow"]["steps"][0]["status"], "done")

    def test_dependencies_survive_move_and_replay(self):
        worker = Workspace()
        worker.dispatch({"action": "sample"})
        worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.linear_fit", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })
        source = worker.snapshot()["project"]["sources"][-1]
        worker.dispatch({"action": "select_source", "source_id": source["id"]})
        created = worker.dispatch({
            "action": "run_plugin", "plugin_id": "nigiro.scatter", "version": "1", "checksum": None,
            "options": {"x": 0, "y": 1},
        })["project"]
        expected = created["figure"]["traces"][0]["y"]
        consumer = created["workflow"]["steps"][-1]["id"]
        worker.dispatch({"action": "move_step", "step_id": consumer, "direction": -1})
        failed = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(failed["workflow"]["completed"], 1)
        self.assertEqual(failed["workflow"]["steps"][1]["status"], "failed")
        self.assertIn("later step", failed["workflow"]["error"])
        worker.dispatch({"action": "move_step", "step_id": consumer, "direction": 1})
        recovered = worker.dispatch({"action": "run_all"})["project"]
        self.assertEqual(recovered["figure"]["traces"][0]["y"], expected)
        self.assertIsNone(recovered["workflow"]["error"])
        self.assertEqual(worker.dispatch({"action": "export_recipe"})["project"]["script_recipe"]["figure_id"], recovered["figure_id"])
