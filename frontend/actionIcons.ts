import {
  Brackets, Calculator, ChartColumn, ChartLine, ChartNoAxesCombined, ChartScatter, Columns3, FileInput,
  Filter, History, Layers, ListFilter, ListPlus, Pencil, Settings2, SquareFunction, Trash2, Variable,
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
  "nigiro.append_rows": ListPlus,
  "nigiro.append_columns": Columns3,
  "nigiro.filter_segments": ListFilter,
};

export function pluginIcon(id: string, menu?: PluginDefinition["menu"]) {
  return pluginIcons[id] ?? (menu === "plot" ? ChartNoAxesCombined : SquareFunction);
}

export function stepPresentation({ action, plugin, parameters, files, label }: WorkflowStep): {
  Icon: LucideIcon;
  text: string;
} {
  if (plugin || action === "plot" || action === "overlay_figures" || action === "fit" || action === "apply_formula") {
    const plot = plugin?.menu === "plot" || action === "plot" || action === "overlay_figures" || label.startsWith("Plot: ");
    return { Icon: plot ? ChartLine : SquareFunction, text: label.replace(/^(Plot|Analysis): /, "") };
  }

  const name = typeof parameters?.name === "string" ? parameters.name : undefined;
  switch (action) {
    case "import_data":
      return { Icon: FileInput, text: files?.map((file) => file.split(/[/\\]/).at(-1)).join(", ") || label.replace(/^Import /, "") };
    case "add_scalar":
      return { Icon: Variable, text: name ?? label.replace(/^Add variable /, "") };
    case "add_array":
      return { Icon: Brackets, text: name ?? label.replace(/^Add array /, "") };
    case "invoke_workflow":
      return { Icon: WorkflowIcon, text: name ?? label.replace(/^Workflow: /, "") };
    case "edit_item": {
      const item = parameters?.item as { kind?: unknown } | undefined;
      if (parameters?.name !== null) return { Icon: Pencil, text: name ?? label };
      return { Icon: Trash2, text: item?.kind === "figure" ? "Figure" : "Source" };
    }
    case "correct":
      return { Icon: Pencil, text: "Worksheet cell" };
    case "color":
      return { Icon: Settings2, text: "Trace color" };
    case "figure_style":
      return { Icon: Settings2, text: "Figure settings" };
    case "trace_style":
      return { Icon: Settings2, text: parameters?.kind === "fill" ? "Area fill"
        : parameters?.kind === "order" ? "Draw order" : "Line style" };
    case "inspect_style":
      return { Icon: Settings2, text: "Trace appearance" };
    case "run_batch":
      return { Icon: SquareFunction, text: "Batch" };
    default:
      return { Icon: (actionIcons as Record<string, LucideIcon>)[action] ?? History, text: label };
  }
}
