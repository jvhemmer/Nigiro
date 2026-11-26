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

type ScalarOption = number | string | boolean;
export type PluginOptions = Record<string, ScalarOption | (number | string)[]>;

export interface PluginField {
  key: string;
  label: string;
  type: "column" | "columns" | "number" | "text" | "boolean" | "choice";
  default: PluginOptions[string];
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
  help?: string;
  editor?: "eis_circuit";
  required?: boolean;
  prefer_other_source?: boolean;
  visible_when?: Record<string, ScalarOption | ScalarOption[]>;
}

export interface PluginDefinition {
  id: string;
  version: string;
  checksum: string | null;
  name: string;
  description?: string;
  menu: "plot" | "analysis";
  fields: PluginField[];
  distinct_columns?: boolean;
  table_only?: boolean;
  input_mode?: "batch" | "joint";
  category?: "electrochemistry" | "signal";
  model_parameters?: Record<string, string[]>;
  outputs?: string[];
}

export interface PluginRun {
  plugin_id: string;
  version: string;
  checksum: string | null;
  options: PluginOptions;
  source_id?: string | null;
  references?: Record<string, { source_id: string | null; column: number | string }>;
}

export interface PluginSubmission {
  output: "overlay" | "separate";
  target_id: number | null;
  runs: { source_id: string | null; options: PluginOptions; target_id: number | null; references?: PluginRun["references"] }[];
}

export interface PluginStepInputs {
  plugin: PluginDefinition;
  inputs: Pick<Project, "sources" | "figures" | "source_id">;
  submission: PluginSubmission;
  updates_figure: boolean;
  warning: string | null;
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
  overlay_inputs?: { label: string }[];
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
  | { kind: "overlay_figure"; figure_ids: number[]; keep_inputs?: boolean }
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
  scalar_formula?: string;
  detail?: string;
  workflow_run?: string;
  comment?: string;
  array_step?: number;
  row_count: number;
  group_id: string | null;
  group_name?: string;
}

export type SourceGroup = { id: string; name: string; collapsed: boolean };

export interface Appearance {
  theme: "system" | "light" | "dark";
  accent: string;
}

export interface WorkflowStep {
  id: number;
  formula?: boolean;
  array?: boolean;
  label: string;
  status: "done" | "pending" | "stale" | "failed";
  options: PluginOptions[];
  labels: Record<string, string>;
  editors?: Record<string, NonNullable<PluginField["editor"]>>;
  files?: string[];
  parameters?: Record<string, unknown>;
  plugin_step?: boolean;
  scalar?: boolean;
  workflow_outputs?: string[];
  workflow_inputs?: string[];
}

export interface Workflow {
  steps: WorkflowStep[];
  completed: number;
  error: string | null;
  has_base: boolean;
  needs_replay: boolean;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  inputs: { output: string; kind: "csv" | "number"; name: string; default?: number }[];
  outputs: { kind: "source" | "figure"; name: string }[];
}

export interface WorkflowPorts {
  name: string;
  inputs: (SavedWorkflow["inputs"][number] & { exposed: boolean })[];
  outputs: {
    kind: "source" | "figure";
    name: string;
    reference: { output: string; table?: string };
    exposed: boolean;
  }[];
  warning: string | null;
  sources: { id: string | null; name: string; scalar?: boolean; array?: boolean }[];
  bindings: Record<string, string | null>;
  numbers: Record<string, number>;
}

export interface WorkflowOutput {
  kind: "source" | "figure";
  id: string | number | null;
  name: string;
}

export interface SavedPath {
  name: string;
  path: string;
}

export interface Project {
  notes: string;
  workspace: { name: string; path: string | null; dirty: boolean; active_project: string | null; projects: SavedPath[] } | null;
  recent_workspaces: SavedPath[];
  trace_styles: Record<number, TraceStyle>;
  saved_workflows: SavedWorkflow[];
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
  figures: { id: number; name: string; overlayable: boolean; token?: string }[];
  figure_id: number | null;
  figure_input: SourceTable | null;
  sources: ProjectSource[];
  source_groups: SourceGroup[];
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

export const lineDashes = {
  solid: "Solid", dash: "Dash", dot: "Dot", dashdot: "Dash dot", longdash: "Long dash", longdashdot: "Long dash dot",
} as const;

export interface TraceLineStyle {
  color: string;
  width: number;
  dash: keyof typeof lineDashes;
}

export type TraceFillStyle = { color: string; opacity: number };
export type TraceStyle = Partial<TraceLineStyle> & { fill?: TraceFillStyle; zorder?: number };
export type InspectStyleChange =
  | { action: "color"; element: FigureElement; color: string }
  | ({ action: "trace_style"; trace: number } & (
    { kind: "line"; style: TraceLineStyle | null }
    | { kind: "fill"; style: TraceFillStyle | null }
    | { kind: "order"; style: { zorder: number } | null }
  ));

export interface TextImportSettings {
  delimiter: string;
  encoding: string;
  comment: string;
  skip_rows: number;
  header_row: number;
  ignore_rows: string;
}

export interface ImportPreview {
  columns: string[];
  rows: string[][];
  raw: string[];
  error: string | null;
}

export interface ImportReview {
  paths: string[];
  settings: (TextImportSettings | null)[];
  index: number;
  suggested: TextImportSettings;
  preview: ImportPreview;
  error: string;
  replacement: { step_id: number; slot: number } | null;
}

export type Request =
  | { action: "state" | "run_all" | "run_next" | "new" | "sample" | "import_data" | "open" | "install_plugin" | "new_workspace" | "open_workspace" }
  | { action: "open_recent_workspace" | "switch_workspace_project"; path: string }
  | { action: "save_workspace"; name: string; choose_path: boolean }
  | { action: "save"; notes?: string }
  | { action: "move_step"; step_id: number; direction: number }
  | { action: "save_workflow"; name: string; steps: number[]; inputs: Record<string, string>; outputs: WorkflowOutput[] }
  | { action: "import_workflow" }
  | { action: "edit_workflow_ports"; step_id: number;
      inputs: Record<string, { exposed: boolean; name: string }>; outputs: WorkflowPorts["outputs"] }
  | { action: "edit_workflow_run"; step_id: number; name: string; sources: Record<string, string | null>; numbers: Record<string, number> }
  | { action: "run_saved_workflow"; id: string; name: string; sources: Record<string, string | null>; numbers: Record<string, number> }
  | { action: "edit_step"; step_id: number; options: PluginOptions[]; parameters?: Record<string, unknown> }
  | { action: "edit_plugin_step"; step_id: number; submission: PluginSubmission }
  | { action: "replace_import"; step_id: number; slot: number }
  | { action: "import_configured"; paths: string[]; settings: ImportReview["settings"]; replacement: ImportReview["replacement"] }
  | { action: "delete_step"; step_id: number }
  | { action: "move_source"; source_id: ProjectSource["id"]; destination: number; placement?: { group_id: string | null } }
  | { action: "source_group"; mode: "create" | "rename" | "toggle" | "delete"; group_id?: string; name?: string }
  | { action: "apply_formula"; source_id: ProjectSource["id"]; column: number; expression: string }
  | ({ action: "add_scalar"; name: string; comment?: string } & ({ value: number } | { expression: string }))
  | ({ action: "add_array"; name: string; comment?: string } & ({ values: string } | { expression: string }))
  | { action: "worksheet_page"; offset: number }
  | { action: "correct"; row: number; column: number; value: string }
  | ({ action: "run_plugin"; figure_id?: number } & PluginRun)
  | ({ action: "execute_plugin" } & Pick<PluginRun, "plugin_id" | "version" | "checksum"> & PluginSubmission)
  | { action: "select_source"; source_id: string | null }
  | { action: "select_figure"; figure_id: number }
  | { action: "overlay_figures"; figure_ids: number[] }
  | { action: "edit_item"; item: WorkspaceItem; name: string | null }
  | { action: "inspect_style"; figure_id: number; trace: number; changes: InspectStyleChange[] }
  | { action: "set_preferences"; style: FigureStyle; appearance: Appearance; run_automatically?: boolean }
  | { action: "set_global_style"; style: FigureStyle }
  | { action: "figure_style"; style: FigureStyle; figure_id: number }
  | { action: "save_as"; name: string; notes?: string };

export const elementNames: Record<FigureElement, string> = {
  fit: "Linear fit",
  observations: "Observations",
};

export function replacesProject(request: Request): boolean {
  return ["new", "open", "open_workspace", "open_recent_workspace", "switch_workspace_project"].includes(request.action);
}

const figureCache = new Map<number, { token: string; figure: PluginFigure }>();
let appearance: { style: string; colors: string; lines: string; project: Project } | null = null;

export async function workspace(request: Request) {
  const replacing = replacesProject(request);
  const knownFigures = replacing ? {} : Object.fromEntries([...figureCache].map(([id, entry]) => [id, entry.token]));
  const response = await invoke<{ project: Project; plugins: PluginDefinition[] } | { import_review: ImportReview } | null>("workspace", {
    request, paged: true, knownFigures,
  });
  if (!response || "import_review" in response) return response;
  const project = response.project;
  project.trace_styles ??= {};
  if (replacing) figureCache.clear();
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
  const lines = JSON.stringify(project.trace_styles);
  if (appearance?.style === style) project.figure_style = appearance.project.figure_style;
  if (appearance?.colors === colors) project.colors = appearance.project.colors;
  if (appearance?.lines === lines && appearance) project.trace_styles = appearance.project.trace_styles;
  appearance = { style, colors, lines, project };
  return response;
}

export function formatNumber(value: number | null) {
  return value === null ? "—" : Number(value.toPrecision(6)).toString();
}
