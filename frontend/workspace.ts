import { invoke } from "@tauri-apps/api/core";

export type FigureElement = "fit" | "observations";
export type ExportFormat = "svg" | "pdf";

export type RecordedStep =
  | { kind: "correct_cell"; row: number; column: number; value: string }
  | { kind: "linear_fit"; x: number; y: number; version: number }
  | { kind: "figure_color"; element: FigureElement; color: string };

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
  colors: Record<FigureElement, string>;
}

export type Request =
  | { action: "state" | "sample" | "import_csv" | "open" | "save" }
  | { action: "correct"; row: number; column: number; value: string }
  | { action: "fit"; x: number; y: number }
  | { action: "color"; element: FigureElement; color: string }
  | { action: "save_as"; name: string }
  | { action: "export"; name: string; format: ExportFormat };

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
