import { invoke } from "@tauri-apps/api/core";
import figureStyle from "../src/nigiro/figure_style.py?raw";
import sourceTables from "../src/nigiro/source_tables.py?raw";
import batchFigure from "../src/nigiro/batch_figure.py?raw";
import model from "../src/nigiro/project.py?raw";
import analysis from "../src/nigiro/analysis.py?raw";
import builtinPlugins from "../src/nigiro/builtin_plugins.py?raw";
import pluginSource from "../src/nigiro/plugin_source.py?raw";
import figureExport from "../src/nigiro/figure_export.py?raw";
import replay from "./replay.py?raw";
import type { CaptureFigure, FigureSnapshot } from "./FitPlot";
import type { Project } from "./workspace";

export interface ExportSettings {
  format: "png" | "pdf";
  scale: number;
  embedFonts?: boolean;
}

export type ExportTarget = "figure" | "script";

function sourceBody(source: string) {
  return source.replace(/^"""[^\n]*"""\n\n/, "")
    .replace(/^from __future__ import annotations\n\n/m, "");
}

interface EmbeddedFont {
  family: string;
  extension: string;
  data: string;
  weight: string;
  style: string;
}

function script(project: Project & { script_recipe: unknown }, figure: FigureSnapshot, settings: ExportSettings, fonts: EmbeddedFont[]) {
  const payload = JSON.stringify({
    recipe: project.script_recipe,
    operations: project.operations,
    figure,
    export_settings: settings,
    ...(fonts.length ? { fonts } : {}),
  }, null, 2);
  // These wheels supply the same Plotly.js version and font as the desktop app.
  const { python, numpy, scipy } = project.versions;
  return `# /// script
# requires-python = "==${python}.*"
# dependencies = [
#   "numpy==${numpy}",
#   "scipy==${scipy}",
#   "plotly==7.1.0",
#   "matplotlib==3.10.8",
#   "playwright==1.65.1",
#   "typst==0.15.2",
# ]
# ///
"""Replay a Nigiro analysis and write a PNG or PDF."""

from __future__ import annotations

import argparse
import json
from base64 import b64decode, b64encode

PAYLOAD = json.loads(r"""
${payload}
""")

${sourceBody(figureStyle)}
${sourceBody(sourceTables)}
${sourceBody(batchFigure)}
${sourceBody(model).replace(/^from \.(figure_style|source_tables) import .*\n/gm, "")}
${sourceBody(analysis).replace(/^from \.project import .*\n/m, "")}
${sourceBody(builtinPlugins).replace(/^from \.(analysis|project) import .*\n/gm, "")}
${sourceBody(pluginSource)}
${sourceBody(figureExport)}
${replay}

if __name__ == "__main__":
    main()
`;
}

export async function saveFigure(name: string, target: ExportTarget, settings: ExportSettings, capture: CaptureFigure) {
  const format = target === "script" ? "py" : settings.format;
  let content: string;
  if (target === "script") {
    const response = await invoke<{ project: Project & { script_recipe: unknown } }>("workspace", {
      request: { action: "export_recipe" },
    });
    const fonts = settings.embedFonts
      ? (await invoke<{ fonts: EmbeddedFont[] }>("workspace", { request: { action: "export_fonts" } })).fonts
      : [];
    content = script(response.project, capture.snapshot(), settings, fonts);
  } else {
    content = await capture.svg();
  }
  await invoke("save_rendered_figure", { name, format, content, scale: settings.scale });
}
