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
  outputs?: string[];
}

export interface PluginRun {
  plugin_id: string;
  version: string;
  checksum: string | null;
  options: PluginOptions;
  source_id?: string | null;
}

export interface PluginSubmission {
  output: "overlay" | "separate";
  target_id: number | null;
  runs: { source_id: string | null; options: PluginOptions; target_id: number | null }[];
}

export interface OverlayInput {
  plugin: PluginRun & { source: string | null; part?: "fit" | "residual" };
  input: SourceTable | null;
  label: string;
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
  part?: "fit" | "residual";
  summary?: Record<string, number | string | boolean | null>;
  series_colors?: (string | null)[];
  series_cycle?: (number | null)[];
  overlay_inputs?: OverlayInput[];
  preserve_first?: boolean;
}

export type RecordedStep =
  | { kind: "correct_cell"; row: number; column: number; value: string; source_id?: string }
  | { kind: "linear_fit"; x: number; y: number; version: number }
  | PlotRecipe
  | ({ kind: "plugin" } & PluginRun)
  | { kind: "figure_color"; element: FigureElement; color: string }
  | ({ kind: "figure_style" } & FigureStyle)
  | { kind: "figure_appearance"; figure_id: number; style: FigureStyle }
  | { kind: "residual_figure"; fit_id: number }
  | { kind: "overlay_figure"; figure_ids: number[] }
  | { kind: "add_figure_layers"; target_id: number; figure_ids: number[] }
  | { kind: "item_edit"; target: WorkspaceItem["kind"]; item_id: WorkspaceItem["id"]; name: string | null };

export type WorkspaceItem =
  | { kind: "source"; id: string | null }
  | { kind: "figure"; id: number };

export interface SourceTable {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface ProjectSource {
  id: string | null;
  name: string;
  columns: string[];
  original_path: string | null;
  kind: "raw" | "derived";
  scalar?: boolean;
  row_count: number;
}

export interface Appearance {
  theme: "system" | "light" | "dark";
  accent: string;
}

export interface WorkflowStep {
  id: number;
  formula?: boolean;
  label: string;
  status: "done" | "pending" | "stale" | "failed";
  options: PluginOptions[];
  labels: Record<string, string>;
}

export interface Workflow {
  steps: WorkflowStep[];
  completed: number;
  error: string | null;
  has_base: boolean;
  needs_replay: boolean;
}

export interface Project {
  appearance: Appearance;
  row_count: number;
  row_offset: number;
  figure_token: string | null;
  figure_cached: boolean;
  source_name: string | null;
  file_name: string | null;
  dirty: boolean;
  workflow: Workflow;
  run_automatically: boolean;
  columns: string[];
  rows: string[][];
  original_rows: string[][];
  operations: RecordedStep[];
  figures: { id: number; name: string; token?: string }[];
  figure_id: number | null;
  figure_input: SourceTable | null;
  sources: ProjectSource[];
  source_id: string | null;
  source_table: SourceTable | null;
  source_original_rows: string[][] | null;
  figure: PluginFigure | null;
  figure_error: string | null;
  colors: Record<FigureElement, string>;
  figure_style: FigureStyle;
  default_figure_style: FigureStyle;
  global_figure_style: FigureStyle;
  factory_figure_style: FigureStyle;
  versions: { python: string; numpy: string; scipy: string };
}

export type Request =
  | { action: "state" | "run_all" | "run_next" | "new" | "sample" | "import_data" | "open" | "save" | "install_plugin" }
  | { action: "move_step"; step_id: number; direction: number }
  | { action: "edit_step"; step_id: number; options: PluginOptions[] }
  | { action: "delete_step"; step_id: number }
  | { action: "move_source"; source_id: ProjectSource["id"]; destination: number }
  | { action: "scale_column"; runs: { source_id: ProjectSource["id"]; column: number }[]; factor: number }
  | { action: "apply_formula"; source_id: ProjectSource["id"]; column: number; expression: string }
  | { action: "add_scalar"; name: string; value: number }
  | { action: "worksheet_page"; offset: number }
  | { action: "correct"; row: number; column: number; value: string }
  | ({ action: "run_plugin"; figure_id?: number } & PluginRun)
  | ({ action: "execute_plugin" } & Pick<PluginRun, "plugin_id" | "version" | "checksum"> & PluginSubmission)
  | { action: "select_source"; source_id: string | null }
  | { action: "select_figure"; figure_id: number }
  | { action: "edit_item"; item: WorkspaceItem; name: string | null }
  | { action: "color"; element: FigureElement; color: string; figure_id: number }
  | { action: "set_preferences"; style: FigureStyle; appearance: Appearance; run_automatically?: boolean }
  | { action: "set_global_style"; style: FigureStyle }
  | { action: "figure_style"; style: FigureStyle; figure_id: number }
  | { action: "save_as"; name: string };

export const elementNames: Record<FigureElement, string> = {
  fit: "Linear fit",
  observations: "Observations",
};

const figureCache = new Map<number, { token: string; figure: PluginFigure }>();
let appearance: { style: string; colors: string; project: Project } | null = null;

export async function workspace(request: Request) {
  const knownFigures = Object.fromEntries([...figureCache].map(([id, entry]) => [id, entry.token]));
  const response = await invoke<{ project: Project; plugins: PluginDefinition[] } | null>("workspace", {
    request, paged: true, knownFigures,
  });
  if (!response) return response;
  const project = response.project;
  if (request.action === "new" || request.action === "open") figureCache.clear();
  if (project.figure_id !== null && project.figure_token) {
    const cached = figureCache.get(project.figure_id);
    if (project.figure_cached && cached) project.figure = cached.figure;
    if (project.figure) {
      figureCache.delete(project.figure_id);
      figureCache.set(project.figure_id, { token: project.figure_token, figure: project.figure });
      if (figureCache.size > 4) figureCache.delete(figureCache.keys().next().value!);
    }
  }
  const style = JSON.stringify(project.figure_style);
  const colors = JSON.stringify(project.colors);
  if (appearance?.style === style) project.figure_style = appearance.project.figure_style;
  if (appearance?.colors === colors) project.colors = appearance.project.colors;
  appearance = { style, colors, project };
  return response;
}

export function formatNumber(value: number | null) {
  return value === null ? "—" : Number(value.toPrecision(6)).toString();
}
