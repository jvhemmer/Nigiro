import { invoke } from "@tauri-apps/api/core";
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

export interface Plot extends PlotRecipe {
  x_values: (number | string)[];
  y_values: number[];
  omitted_rows: number;
}

export type RecordedStep =
  | { kind: "correct_cell"; row: number; column: number; value: string }
  | { kind: "linear_fit"; x: number; y: number; version: number }
  | PlotRecipe
  | { kind: "figure_color"; element: FigureElement; color: string }
  | ({ kind: "figure_style" } & FigureStyle);

export interface Fit {
  slope: number;
  intercept: number;
  r_squared: number | null;
  omitted_rows: number;
  x: number[];
  y: number[];
  fitted: number[];
  residuals: number[];
}

export interface Project {
  source_name: string;
  file_name: string | null;
  dirty: boolean;
  columns: string[];
  rows: string[][];
  original_rows: string[][];
  operations: RecordedStep[];
  fit: Fit | null;
  fit_error: string | null;
  plot: Plot | null;
  plot_error: string | null;
  colors: Record<FigureElement, string>;
  figure_style: FigureStyle;
  default_figure_style: FigureStyle;
  versions: { python: string; numpy: string; scipy: string };
}

export type Request =
  | { action: "state" | "sample" | "import_csv" | "open" | "save" }
  | { action: "correct"; row: number; column: number; value: string }
  | { action: "plot"; plot_type: PlotKind; x: number; y: number }
  | { action: "fit"; x: number; y: number }
  | { action: "color"; element: FigureElement; color: string }
  | { action: "figure_style"; style: FigureStyle }
  | { action: "save_as"; name: string };

export const elementNames: Record<FigureElement, string> = {
  fit: "Linear fit",
  observations: "Observations",
};

export function workspace(request: Request) {
  return invoke<{ project: Project | null } | null>("workspace", { request });
}

export function formatNumber(value: number | null) {
  return value === null ? "—" : Number(value.toPrecision(6)).toString();
}
