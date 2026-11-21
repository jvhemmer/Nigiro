import { useEffect, useRef, useState } from "react";
import { useListDrag } from "./useListDrag";
import type { PluginOptions, Request, Workflow, WorkflowStep } from "./workspace";

const statusLabels = { done: "Done", stale: "Stale", pending: "Queued", failed: "Failed" };

export function WorkflowPanel({ workflow, busy, run }: {
  workflow: Workflow;
  busy: boolean;
  run: (request: Request) => Promise<boolean>;
}) {
  const modes = useRef<HTMLDetailsElement>(null);
  const [action, setAction] = useState<"run_all" | "run_next">("run_all");
  const disabled = busy || !workflow.steps.length
    || (action === "run_next" && workflow.completed === workflow.steps.length);
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
    </div>
    {workflow.error && <p className="workflow-error" role="alert">{workflow.error}</p>}
    {!workflow.error && workflow.steps.some((step) => step.status === "stale")
      && <p className="workflow-base muted" role="status">Rerun stale steps to update their results.</p>}
    {workflow.has_base && <p className="workflow-base muted">Starts from existing project data.</p>}
    <ol>
      {workflow.steps.map((step, index) => <li key={step.id} {...drag(index)}>
        <button className="workflow-step" type="button" disabled={busy} data-workflow-id={step.id}
          aria-haspopup="menu" title="Step actions">
          <span>{step.label}</span><small data-status={step.status}>{statusLabels[step.status]}</small>
        </button>
      </li>)}
    </ol>
  </div>;
}

export function WorkflowStepDialog({ step, busy, error, onClose, onRun }: {
  step: WorkflowStep;
  busy: boolean;
  error: string;
  onClose: () => void;
  onRun: (request: Request) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<PluginOptions[]>(step.options);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="workflow-dialog-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (await onRun({ action: "edit_step", step_id: step.id, options })) onClose();
    }}>
      <h2 id="workflow-dialog-title">{step.label}</h2>
      <div className="fit-settings plugin-fields">
        {options.map((values, index) => <fieldset key={index}>
          {options.length > 1 && <legend>Input {index + 1}</legend>}
          {Object.entries(values).map(([key, value]) => (
            <label key={key}><span>{step.labels[key] ?? key}</span>
              {typeof step.options[index][key] === "boolean"
                ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => update(index, key, event.target.checked)} />
                : <input type={typeof step.options[index][key] === "number" ? "number" : "text"} step="any"
                  required={typeof step.options[index][key] === "number"}
                  value={Number.isNaN(value) ? "" : String(value)}
                  onChange={(event) => update(index, key, event.target.type === "number" ? event.target.valueAsNumber : event.target.value)} />}
            </label>
          ))}
        </fieldset>)}
      </div>
      {error && <p role="alert" className="figure-settings-error">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>Save step</button>
      </footer>
    </form>
  </dialog>;

  function update(index: number, key: string, value: PluginOptions[string]) {
    setOptions((current) => current.map((input, position) => position === index ? { ...input, [key]: value } : input));
  }
}
