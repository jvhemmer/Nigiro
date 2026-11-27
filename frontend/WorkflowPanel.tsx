import { stepPresentation } from "./actionIcons";
import { CircuitField } from "./CircuitDesigner";
import { FormulaEditor } from "./FormulaEditor";
import { Network } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkflowGraph, type WorkflowNodePositions } from "./WorkflowGraph";
import { StepFilterMenu, visibleWorkflowSteps, type StepFilter } from "./StepFilterMenu";
import { useListDrag } from "./useListDrag";
import { useRevealDockPanel } from "./DockWorkspace";
import type { PluginOptions, ProjectSource, Request, Workflow, WorkflowStep } from "./workspace";

export const statusLabels = { done: "Done", stale: "Stale", pending: "Queued", failed: "Failed" };

export function WorkflowPanel({ workflow, busy, run, onInspect, onEdit, selected }: {
  workflow: Workflow;
  busy: boolean;
  run: (request: Request) => Promise<boolean>;
  onInspect: (id: number) => void;
  onEdit: (step: WorkflowStep) => void;
  selected?: number;
}) {
  const reveal = useRevealDockPanel();
  const modes = useRef<HTMLDetailsElement>(null);
  const graphPositions = useRef<WorkflowNodePositions>({});
  const [graphOpen, setGraphOpen] = useState(false);
  const [action, setAction] = useState<"run_all" | "run_next">("run_all");
  const [hiddenFilters, setHiddenFilters] = useState<ReadonlySet<StepFilter>>(() => new Set(["appearance", "rename"]));
  const visibleSteps = visibleWorkflowSteps(workflow.steps, hiddenFilters);

  function toggleFilter(filter: StepFilter, shown: boolean) {
    setHiddenFilters((previous) => {
      const next = new Set(previous);
      if (shown) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  const disabled = busy || (!workflow.needs_replay
    && (!workflow.steps.length || (action === "run_next" && workflow.completed === workflow.steps.length)));
  const numberWidth = `${String(workflow.steps.length).length + 1}ch`;
  const drag = useListDrag(busy, (from, to) => {
    void run({ action: "move_step", step_id: workflow.steps[from].id, direction: to - from });
  });
  return <div className="history">
    <div className="history-actions">
      <div className="run-split">
        <button type="button" className="primary" disabled={disabled} onClick={() => {
          if (modes.current) modes.current.open = false;
          void run({ action });
        }}>{action === "run_all" ? "Run all" : "Run next"}</button>
        <details ref={modes} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary aria-label="Choose run mode" title="Choose run mode">▾</summary>
          <div className="run-modes">
            {(["run_all", "run_next"] as const).map((mode) => <button type="button" key={mode}
              aria-pressed={action === mode} onClick={() => {
                setAction(mode);
                if (modes.current) modes.current.open = false;
                modes.current?.querySelector("summary")?.focus();
              }}>{mode === "run_all" ? "Run all" : "Run next"}</button>)}
          </div>
        </details>
      </div>
      <StepFilterMenu hidden={hiddenFilters} onToggle={toggleFilter} />
      <button type="button" className="step-filter" aria-label="View as flowchart" title="View as flowchart"
        onClick={() => setGraphOpen(true)}><Network size={15} /></button>
    </div>
    {workflow.error && <p className="workflow-error" role="alert">{workflow.error}</p>}
    {!workflow.error && workflow.needs_replay
      && <p className="workflow-base muted" role="status">Run the workflow to update its results.</p>}
    {workflow.has_base && <p className="workflow-base muted">Starts from existing project data.</p>}
    {!!workflow.steps.length && !visibleSteps.length && <p className="workflow-base muted">No steps match the filters.</p>}
    <ol role="list" aria-label="Recorded steps">
      {visibleSteps.map(({ step, index }) => {
        const { Icon, text } = stepPresentation(step);
        return <li key={step.id} {...drag(index)}>
          <button className="workflow-step" type="button" disabled={busy} data-workflow-id={step.id}
            data-failed={step.status === "failed" || undefined}
            aria-haspopup="menu" aria-current={step.id === selected} title={step.label}
            aria-label={`${step.label} · ${statusLabels[step.status]}`}
            onClick={() => { onInspect(step.id); reveal("analysis"); }}>
            <span className="workflow-step-number" style={{ width: numberWidth }} aria-hidden="true">{index + 1}.</span>
            <Icon className="workflow-step-icon" size={13} aria-hidden="true" />
            <span className="workflow-step-label">{text}</span>
            <small data-status={step.status}>{statusLabels[step.status]}</small>
          </button>
        </li>;
      })}
    </ol>
    {graphOpen && createPortal(<WorkflowGraph steps={workflow.steps} statusLabels={statusLabels} busy={busy}
      hiddenFilters={hiddenFilters} onToggleFilter={toggleFilter} initialPositions={graphPositions.current} onClose={(positions) => {
        graphPositions.current = positions;
        setGraphOpen(false);
      }} onEdit={onEdit} onSelect={(step) => onInspect(step.id)} />, document.body)}
  </div>;
}

export function WorkflowStepDialog({ step, sources, busy, error, onClose, onRun }: {
  step: WorkflowStep;
  sources: ProjectSource[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onRun: (request: Request) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<PluginOptions[]>(step.options);
  const [advanced, setAdvanced] = useState(step.options.length === 0);
  const [parameters, setParameters] = useState(() => JSON.stringify(step.parameters ?? {}, null, 2));
  const [parseError, setParseError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="workflow-dialog-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (step.files?.length) return;
      let details: Record<string, unknown> | undefined;
      if (advanced) {
        try {
          const value: unknown = JSON.parse(parameters);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          details = value as Record<string, unknown>;
        } catch {
          setParseError("Enter the recorded parameters as a JSON object.");
          return;
        }
      }
      setParseError("");
      if (await onRun({ action: "edit_step", step_id: step.id, options, parameters: details })) onClose();
    }}>
      <h2 id="workflow-dialog-title">{step.array ? "Edit Array" : step.label}</h2>
      <div className="fit-settings plugin-fields">
        {step.files?.length ? step.files.map((file, slot) => <div className="recorded-import-file" key={slot}>
          <span title={file}>{file}</span>
          <button type="button" disabled={busy} onClick={async () => {
            if (await onRun({ action: "replace_import", step_id: step.id, slot })) onClose();
          }}>Replace file…</button>
        </div>) : advanced ? <label>
          <span>Recorded parameters (JSON)</span>
          <textarea rows={12} spellCheck={false} value={parameters} disabled={busy}
            onChange={(event) => { setParameters(event.target.value); setParseError(""); }} />
        </label> :
        <>
        {options.map((values, index) => <fieldset key={index}>
          {options.length > 1 && <legend>Input {index + 1}</legend>}
          {Object.entries(values).map(([key, value]) => step.editors?.[key] === "eis_circuit"
            ? <CircuitField key={key} value={String(value)} onChange={(circuit) => update(index, key, circuit)} />
            : key === "expression"
            ? <FormulaEditor key={key} array={step.array} scalar={step.scalar}
                filter={!step.formula} value={String(value)} sources={step.formula ? sources : []}
                onChange={(text) => update(index, key, text)} />
            : (
            <label key={key}><span>{step.labels[key] ?? key}</span>
              {key === "values" && step.array ? (
                <textarea rows={5} value={String(value)} onChange={(event) => update(index, key, event.target.value)} />
              ) : typeof step.options[index][key] === "boolean"
                ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => update(index, key, event.target.checked)} />
                : <input type={typeof step.options[index][key] === "number" ? "number" : "text"} step="any"
                  required={typeof step.options[index][key] === "number"}
                  value={Number.isNaN(value) ? "" : String(value)}
                  onChange={(event) => update(index, key, event.target.type === "number" ? event.target.valueAsNumber : event.target.value)} />}
            </label>
          ))}
        </fieldset>)}
        </>}
      </div>
      {(parseError || error) && <p role="alert" className="figure-settings-error">{parseError || error}</p>}
      <footer>
        {!!step.options.length && step.parameters && <button type="button" disabled={busy} onClick={() => {
          setAdvanced(!advanced);
          setParseError("");
        }}>{advanced ? "Basic options" : "Advanced options"}</button>}
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        {!step.files?.length && <button type="submit" className="primary" disabled={busy}>Save step</button>}
      </footer>
    </form>
  </dialog>;

  function update(index: number, key: string, value: PluginOptions[string]) {
    setOptions((current) => current.map((input, position) => position === index ? { ...input, [key]: value } : input));
  }
}
