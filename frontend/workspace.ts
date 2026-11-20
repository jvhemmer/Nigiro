import { invoke } from "@tauri-apps/api/core";
import type { Data, Layout } from "plotly.js";
import type { FigureStyle } from "./figureStyle";

export type FigureElement = "fit" | "observations";

export const plotNames = { scatter: "Scatter", line: "Line", bar: "Bar" } as const;
export type PlotKind = keyof typeof plotNames;

interface PlotRecipe {
  kind: "plot";
  plot_type: PlotKind;
  x: number;
  y: number;
}

export type PluginOptions = Record<string, number | string | boolean>;

export interface PluginField {
  key: string;
  label: string;
  type: "column" | "number" | "text" | "boolean" | "choice";
  default: PluginOptions[string];
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
}

export interface PluginDefinition {
  id: string;
  version: string;
  checksum: string | null;
  name: string;
  menu: "plot" | "analysis";
  fields: PluginField[];
  distinct_columns?: boolean;
}

export interface PluginRun {
  plugin_id: string;
  version: string;
  checksum: string | null;
  options: PluginOptions;
}

export interface PluginFigure {
  definition: PluginDefinition;
  recipe: PluginRun;
  source: string | null;
  traces: Data[];
  layout?: Partial<Layout>;
  elements?: (FigureElement | null)[];
  x_label?: string;
  y_label?: string;
  categorical_x?: boolean;
  residual_panel?: boolean;
  summary?: Record<string, number | string | boolean | null>;
}

export type RecordedStep =
  | { kind: "correct_cell"; row: number; column: number; value: string }
  | { kind: "linear_fit"; x: number; y: number; version: number }
  | PlotRecipe
  | ({ kind: "plugin" } & PluginRun)
  | { kind: "figure_color"; element: FigureElement; color: string }
  | ({ kind: "figure_style" } & FigureStyle);

export interface Project {
  source_name: string;
  file_name: string | null;
  dirty: boolean;
  columns: string[];
  rows: string[][];
  original_rows: string[][];
  operations: RecordedStep[];
  figure: PluginFigure | null;
  figure_error: string | null;
  colors: Record<FigureElement, string>;
  figure_style: FigureStyle;
  default_figure_style: FigureStyle;
  versions: { python: string; numpy: string; scipy: string };
}

export type Request =
  | { action: "state" | "sample" | "import_csv" | "open" | "save" | "install_plugin" }
  | { action: "correct"; row: number; column: number; value: string }
  | ({ action: "run_plugin" } & PluginRun)
  | { action: "color"; element: FigureElement; color: string }
  | { action: "figure_style"; style: FigureStyle }
  | { action: "save_as"; name: string };

export const elementNames: Record<FigureElement, string> = {
  fit: "Linear fit",
  observations: "Observations",
};

export function workspace(request: Request) {
  return invoke<{ project: Project | null; plugins: PluginDefinition[] } | null>("workspace", { request });
}

export function formatNumber(value: number | null) {
  return value === null ? "—" : Number(value.toPrecision(6)).toString();
}
