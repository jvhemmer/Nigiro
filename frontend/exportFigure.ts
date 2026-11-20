import { invoke } from "@tauri-apps/api/core";
import figureStyle from "../src/nigiro/figure_style.py?raw";
import model from "../src/nigiro/project.py?raw";
import analysis from "../src/nigiro/analysis.py?raw";
import figureExport from "../src/nigiro/figure_export.py?raw";
import replay from "./replay.py?raw";
import type { CaptureFigure, FigureSnapshot } from "./FitPlot";
import type { Project } from "./workspace";

export interface ExportSettings {
  format: "png" | "pdf";
  scale: number;
}

export type ExportTarget = "figure" | "script";

function sourceBody(source: string) {
  return source.replace(/^"""[^\n]*"""\n\n/, "")
    .replace(/^from __future__ import annotations\n\n/m, "");
}

function script(project: Project, figure: FigureSnapshot, settings: ExportSettings) {
  const payload = JSON.stringify({
    source_name: project.source_name,
    columns: project.columns,
    rows: project.original_rows,
    operations: project.operations,
    figure,
    export_settings: settings,
  }, null, 2);
  // These wheels supply the same Plotly.js version and font as the desktop app.
  const { python, numpy, scipy } = project.versions;
  return `# /// script
# requires-python = "==${python}.*"
# dependencies = [
#   "numpy==${numpy}",
#   "scipy==${scipy}",
#   "plotly==6.9.0",
#   "matplotlib==3.10.8",
#   "playwright==1.65.1",
#   "typst==0.15.2",
# ]
# ///
"""Replay a Nigiro analysis and write a PNG or PDF."""

from __future__ import annotations

import argparse
import json
from base64 import b64encode
from html import escape

PAYLOAD = json.loads(r"""
${payload}
""")

${sourceBody(figureStyle)}
${sourceBody(model).replace(/^from \.figure_style import .*\n/m, "")}
${sourceBody(analysis).replace(/^from \.project import .*\n/m, "")}
${sourceBody(figureExport)}
${replay}

if __name__ == "__main__":
    main()
`;
}

export async function saveFigure(name: string, target: ExportTarget, settings: ExportSettings, capture: CaptureFigure, project: Project) {
  const format = target === "script" ? "py" : settings.format;
  const content = target === "script"
    ? script(project, capture.snapshot(), settings)
    : await capture.svg();
  await invoke("save_rendered_figure", { name, format, content, scale: settings.scale });
}
