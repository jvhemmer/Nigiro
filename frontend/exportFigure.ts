import mathJaxUrl from "mathjax/es5/tex-svg.js?url";
import { invoke } from "@tauri-apps/api/core";
import columnFormula from "../src/nigiro/column_formula.py?raw";
import figureStyle from "../src/nigiro/figure_style.py?raw";
import sourceTables from "../src/nigiro/source_tables.py?raw";
import batchFigure from "../src/nigiro/batch_figure.py?raw";
import model from "../src/nigiro/project.py?raw";
import analysis from "../src/nigiro/analysis.py?raw";
import analysisPlugins from "../src/nigiro/analysis_plugins.py?raw";
import electrochemistry from "../src/nigiro/electrochemistry.py?raw";
import eis from "../src/nigiro/eis.py?raw";
import analysisCatalog from "../src/nigiro/analysis_catalog.py?raw";
import builtinPlugins from "../src/nigiro/builtin_plugins.py?raw";
import pluginSource from "../src/nigiro/plugin_source.py?raw";
import pluginReplay from "./pluginReplay.py?raw";
import figureExport from "../src/nigiro/figure_export.py?raw";
import replay from "./replay.py?raw";
import tickFormatter from "./plotText.mjs?raw";
import type { CaptureFigure, FigureSnapshot } from "./FitPlot";
import type { Project } from "./workspace";

export interface ExportSettings {
  format: "png" | "pdf";
  scale: number;
  embedFonts?: boolean;
  copyRawData?: boolean;
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

type ScriptRecipe = Pick<Project, "versions" | "operations"> & { script_recipe: { builtin_dependencies?: Record<string, string> } };

async function script(project: ScriptRecipe, figure: FigureSnapshot, settings: ExportSettings, fonts: EmbeddedFont[]) {
  const record = {
    recipe: project.script_recipe,
    operations: project.operations,
    figure,
    export_settings: { format: settings.format, scale: settings.scale },
    ...(fonts.length ? { fonts } : {}),
    ...(Object.keys(figure.tick_renderers).length ? { tick_formatter: tickFormatter.replace(/^export /gm, "") } : {}),
  };
  const hasMath = (value: unknown): boolean => typeof value === "string"
    ? value.length > 2 && value.startsWith("$") && value.endsWith("$")
    : value !== null && typeof value === "object" && Object.values(value).some(hasMath);
  let mathjax: string | undefined;
  if (figure.uses_math || hasMath(figure)) {
    const response = await fetch(mathJaxUrl);
    if (!response.ok) throw new Error("Could not read MathJax for export.");
    const compressed = new Blob([await response.arrayBuffer()]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    mathjax = btoa(binary);
  }
  // These wheels supply the same Plotly.js version and font as the desktop app.
  const { python, numpy, scipy } = project.versions;
  const payload = { ...record, mathjax, plugin_python: python, plugin_runner: `${sourceBody(pluginSource)}\n${pluginReplay}` };
  const extraPins = Object.entries(project.script_recipe.builtin_dependencies ?? {})
    .filter(([name]) => !["numpy", "scipy", "plotly", "matplotlib", "playwright", "typst"].includes(name))
    .map(([name, version]) => `#   ${JSON.stringify(`${name}==${version}`)},\n`).join("");
  const template = `# /// script
# requires-python = "==${python}.*"
# dependencies = [
#   "numpy==${numpy}",
#   "scipy==${scipy}",
#   "plotly==7.1.0",
#   "matplotlib==3.10.8",
#   "playwright==1.65.1",
#   "typst==0.15.2",
${extraPins}# ]
# ///
"""Replay a Nigiro analysis and write a PNG or PDF."""

from __future__ import annotations

import argparse
import json
from base64 import b64encode

# Nigiro replay payload

${sourceBody(figureStyle)}
${sourceBody(columnFormula)}
${sourceBody(sourceTables).replace(/^from \.column_formula import .*\n/m, "")}
${sourceBody(batchFigure)}
${sourceBody(model).replace(/^from \.(figure_style|source_tables) import .*\n/gm, "")}
${sourceBody(analysis).replace(/^from \.project import .*\n/m, "")}
${sourceBody(analysisPlugins)}
${sourceBody(electrochemistry).replace(/^from \.analysis_plugins import .*\n/m, "")}
${sourceBody(eis).replace(/^from \.analysis_plugins import .*\n/m, "")}
${sourceBody(analysisCatalog).replace(/^from \.(analysis_plugins|eis|electrochemistry) import .*\n/gm, "")}
${sourceBody(builtinPlugins).replace(/^from \.(analysis|analysis_catalog|column_formula|project) import .*\n/gm, "")}
${sourceBody(pluginSource)}
${sourceBody(figureExport)}
${replay}

if __name__ == "__main__":
    main()
`;
  return { template, payload };
}

export async function saveFigure(name: string, target: ExportTarget, settings: ExportSettings, capture: CaptureFigure) {
  if (target === "script") {
    const { project } = await invoke<{ project: ScriptRecipe }>("workspace", {
      request: { action: "export_recipe" },
    });
    const fonts = settings.embedFonts
      ? (await invoke<{ fonts: EmbeddedFont[] }>("workspace", { request: { action: "export_fonts" } })).fonts
      : [];
    const document = await script(project, capture.snapshot(), settings, fonts);
    await invoke("save_python_script", { name, ...document, copyRawData: settings.copyRawData ?? false });
  } else {
    await invoke("save_rendered_figure", { name, format: settings.format, content: await capture.svg(), scale: settings.scale });
  }
}
