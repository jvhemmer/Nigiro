import { ListFilter } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { WorkflowStep } from "./workspace";

const stepFilters = {
  rename: "Renames",
  appearance: "Figure and trace settings",
  analysis: "Analyses",
  plot: "Plots",
  workflow: "Workflows",
} as const;
export type StepFilter = keyof typeof stepFilters;

function stepFilter({ action, parameters, plugin }: WorkflowStep): StepFilter | undefined {
  switch (action) {
    case "edit_item":
      return typeof parameters?.name === "string" ? "rename" : undefined;
    case "figure_style":
    case "trace_style":
    case "inspect_style":
    case "color":
      return "appearance";
    case "plot":
    case "overlay_figures":
      return "plot";
    case "fit":
    case "apply_formula":
    case "scale_column":
    case "run_batch":
      return "analysis";
    case "execute_plugin":
    case "run_plugin":
      return plugin?.menu ?? "analysis";
    case "invoke_workflow":
      return "workflow";
  }
}

export function visibleWorkflowSteps(steps: WorkflowStep[], hidden: ReadonlySet<StepFilter>) {
  return steps.flatMap((step, index) => {
    const filter = stepFilter(step);
    return step.status !== "failed" && filter && hidden.has(filter) ? [] : [{ step, index }];
  });
}

export function StepFilterMenu({ hidden, onToggle, portalContainer }: {
  hidden: ReadonlySet<StepFilter>;
  onToggle: (filter: StepFilter, shown: boolean) => void;
  portalContainer?: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLFieldSetElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current || !popup.current) return;
    const anchor = button.current.getBoundingClientRect();
    const menu = popup.current;
    menu.style.left = `${Math.max(0, Math.min(anchor.left, window.innerWidth - menu.offsetWidth))}px`;
    menu.style.top = `${anchor.bottom + menu.offsetHeight <= window.innerHeight
      ? anchor.bottom : Math.max(0, anchor.top - menu.offsetHeight)}px`;
    menu.querySelector("input")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !button.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return <>
    <button ref={button} type="button" className="step-filter" data-active={hidden.size > 0 || undefined}
      aria-label="Filter recorded steps" title="Filter recorded steps" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}><ListFilter size={15} /></button>
    {open && createPortal(
      <fieldset ref={popup} id={id} className="step-filter-options" onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}>
        <legend>Show steps</legend>
        {(Object.keys(stepFilters) as StepFilter[]).map((filter) => <label key={filter}>
          <input type="checkbox" checked={!hidden.has(filter)} onChange={(event) => onToggle(filter, event.target.checked)} />
          <span>{stepFilters[filter]}</span>
        </label>)}
      </fieldset>,
      portalContainer?.current ?? document.body,
    )}
  </>;
}
