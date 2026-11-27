import {
  Brackets, Calculator, ChartColumn, ChartLine, ChartNoAxesCombined, ChartScatter, FileInput,
  Filter, History, Layers, ListFilter, Pencil, Settings2, SquareFunction, Trash2, Variable,
  Workflow as WorkflowIcon, type LucideIcon,
} from "lucide-react";
import type { PluginDefinition, WorkflowStep } from "./workspace";

export const actionIcons = {
  import_data: FileInput,
  add_scalar: Variable,
  add_array: Brackets,
  invoke_workflow: WorkflowIcon,
  overlay_figures: Layers,
  apply_formula: SquareFunction,
  scale_column: Calculator,
  run_batch: SquareFunction,
  fit: ChartLine,
  correct: Pencil,
  color: Settings2,
  figure_style: Settings2,
  inspect_style: Settings2,
  trace_style: Settings2,
} satisfies Record<string, LucideIcon>;

const pluginIcons: Record<string, LucideIcon> = {
  "nigiro.scatter": ChartScatter,
  "nigiro.bar": ChartColumn,
  "nigiro.line": ChartLine,
  "nigiro.linear_fit": ChartLine,
  "nigiro.filter": Filter,
  "nigiro.filter_columns": Filter,
  "nigiro.filter_rows": Filter,
  "nigiro.filter_segments": ListFilter,
};

export function pluginIcon(id: string, menu?: PluginDefinition["menu"]) {
  return pluginIcons[id] ?? (menu === "plot" ? ChartNoAxesCombined : SquareFunction);
}

export function stepIcon({ action, plugin, parameters }: WorkflowStep): LucideIcon {
  if (plugin) return pluginIcon(plugin.id, plugin.menu);
  if (action === "plot") return pluginIcon(`nigiro.${parameters?.plot_type}`, "plot");
  if (action === "edit_item") return parameters?.name === null ? Trash2 : Pencil;
  return (actionIcons as Record<string, LucideIcon>)[action] ?? History;
}
