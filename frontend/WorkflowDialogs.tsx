import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Project, Request, SavedWorkflow, WorkflowOutput } from "./workspace";

interface DialogProps {
  project: Project;
  busy: boolean;
  error: string;
  onClose: () => void;
  onRun: (request: Request) => Promise<boolean>;
}

function WorkflowDialog({ title, submit, busy, valid, error, onClose, onSubmit, children }: {
  title: string; submit: string; busy: boolean; valid: boolean; error: string;
  onClose: () => void; onSubmit: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog workflow-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && valid) onSubmit(); }}>
      <h2 id={titleId}>{title}</h2>
      <div className="fit-settings plugin-fields">{children}</div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !valid}>{submit}</button>
      </footer>
    </form>
  </dialog>;
}

export function SaveWorkflowDialog({ project, busy, error, onClose, onRun }: DialogProps) {
  const steps = project.workflow.steps;
  const choices: WorkflowOutput[] = [
    ...project.sources.map(({ id, name }) => ({ kind: "source" as const, id, name })),
    ...project.figures.map(({ id, name }) => ({ kind: "figure" as const, id, name })),
  ];
  const outputKey = ({ kind, id }: WorkflowOutput) => JSON.stringify([kind, id]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(() => new Set(steps.filter(({ status }) => status === "done").map(({ id }) => id)));
  const [portNames, setPortNames] = useState<Record<string, string>>({});
  const [published, setPublished] = useState<Record<string, string>>({});
  const inputs = Object.fromEntries(steps.filter(({ id }) => selected.has(id)).flatMap((step): [string, string][] => {
    const imports = (step.files ?? []).map((file, index): [string, string] => {
      const key = `${step.id}/source/${index}`;
      return [key, portNames[key] ?? (file.split(/[/\\]/).pop() || "CSV data")];
    });
    const key = `${step.id}/source/0`;
    return step.scalar && key in portNames ? [...imports, [key, portNames[key]]] : imports;
  }));
  const outputs = choices.filter((choice) => outputKey(choice) in published)
    .map((choice) => ({ ...choice, name: published[outputKey(choice)].trim() }));
  const valid = Boolean(name.trim() && selected.size && outputs.length
    && outputs.every(({ name }) => name) && Object.values(inputs).every((input) => input.trim()));

  function setPort(key: string, value?: string) {
    setPortNames((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function setOutput(key: string, value?: string) {
    setPublished((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  return <WorkflowDialog title="Save as Workflow" submit="Save workflow" {...{ busy, error, onClose, valid }}
    onSubmit={async () => {
      if (await onRun({ action: "save_workflow", name: name.trim(), steps: [...selected], inputs, outputs })) onClose();
    }}>
    <label><span>Workflow name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
    <fieldset>
      <legend>Recorded steps and inputs</legend>
      <p className="muted">Include the steps that produce your outputs. CSV imports become inputs. Select the variables that can change between runs.</p>
      {steps.map((step) => {
        const key = `${step.id}/source/0`;
        const include = selected.has(step.id);
        return <div className="workflow-port" key={step.id}>
          <label className="workflow-check"><input type="checkbox" disabled={step.status !== "done"} checked={include} onChange={(event) => {
            setSelected((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(step.id);
              else next.delete(step.id);
              return next;
            });
          }} /><span>{step.label}</span></label>
          {include && step.files?.map((file, index) => {
            const importKey = `${step.id}/source/${index}`;
            return <label key={importKey}><span>CSV input name</span>
              <input title={file} value={inputs[importKey]} onChange={(event) => setPort(importKey, event.target.value)} />
            </label>;
          })}
          {include && step.scalar && <>
            <label className="workflow-check"><input type="checkbox" checked={key in portNames}
              onChange={(event) => setPort(key, event.target.checked ? step.label.replace(/^Add variable /, "") : undefined)} />
              <span>Expose as a number input</span></label>
            {key in portNames && <label><span>Number input name</span>
              <input value={portNames[key]} onChange={(event) => setPort(key, event.target.value)} />
            </label>}
          </>}
        </div>;
      })}
    </fieldset>
    <fieldset>
      <legend>Outputs</legend>
      {choices.map((choice) => {
        const key = outputKey(choice);
        return <div className="workflow-port" key={key}>
          <label className="workflow-check"><input type="checkbox" checked={key in published}
            onChange={(event) => setOutput(key, event.target.checked ? choice.name : undefined)} />
            <span>{choice.name} · {choice.kind}</span></label>
          {key in published && <label><span>Output name</span>
            <input value={published[key]} onChange={(event) => setOutput(key, event.target.value)} />
          </label>}
        </div>;
      })}
    </fieldset>
  </WorkflowDialog>;
}

export function RunWorkflowDialog(props: DialogProps) {
  const workflows = props.project.saved_workflows;
  const [id, setId] = useState(workflows[0]?.id);
  const workflow = workflows.find((record) => record.id === id);
  if (!workflow) return null;
  return <WorkflowRunForm key={id} {...props} workflow={workflow}
    choose={<label><span>Workflow</span><select value={id} onChange={(event) => setId(event.target.value)}>
      {workflows.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
    </select></label>} />;
}

function WorkflowRunForm({ project, workflow, choose, busy, error, onClose, onRun }: DialogProps & {
  workflow: SavedWorkflow; choose: ReactNode;
}) {
  const [name, setName] = useState(workflow.name);
  const available = project.sources.filter((source) => source.kind === "raw" && !source.scalar && source.array_step === undefined);
  const variables = project.sources.filter(({ scalar }) => scalar);
  const defaultSource = available.find(({ id }) => id === project.source_id) ?? available[0];
  const [sources, setSources] = useState<Record<string, string | null>>(() => Object.fromEntries(workflow.inputs
    .filter((port) => port.kind === "csv" && defaultSource).map((port) => [port.output, defaultSource.id])));
  const [numbers, setNumbers] = useState<Record<string, number>>(() => Object.fromEntries(workflow.inputs
    .filter((port) => port.kind === "number").map((port) => [port.output, port.default ?? NaN])));
  const valid = Boolean(name.trim() && workflow.inputs.every((port) => port.kind === "number"
    ? port.output in sources || Number.isFinite(numbers[port.output]) : port.output in sources));
  return <WorkflowDialog title="Run Workflow" submit="Run workflow" {...{ busy, error, onClose, valid }}
    onSubmit={async () => {
      if (await onRun({ action: "run_saved_workflow", id: workflow.id, name: name.trim(), numbers, sources })) onClose();
    }}>
    {choose}
    <label><span>Run name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
    {workflow.inputs.length > 0 && <fieldset>
      <legend>Inputs</legend>
      {workflow.inputs.map((port) => {
        const numeric = port.kind === "number";
        const hasSource = port.output in sources;
        return <div className="workflow-port" key={port.output}>
          {(!numeric || variables.length > 0) && <label><span>{port.name}</span>
            <select value={hasSource ? JSON.stringify(sources[port.output]) : ""} onChange={(event) => {
              const value = event.target.value;
              setSources((current) => {
                const next = { ...current };
                if (value) next[port.output] = JSON.parse(value);
                else delete next[port.output];
                return next;
              });
            }}>
              {numeric ? <option value="">Enter a value</option>
                : !available.length && <option value="">Import a CSV first</option>}
              {(numeric ? variables : available).map(({ id, name }) => (
                <option key={JSON.stringify(id)} value={JSON.stringify(id)}>{name}</option>
              ))}
            </select>
          </label>}
          {numeric && !hasSource && <label><span>{variables.length ? `${port.name} value` : port.name}</span>
            <input type="number" step="any" value={Number.isFinite(numbers[port.output]) ? numbers[port.output] : ""}
              onChange={(event) => setNumbers({ ...numbers, [port.output]: event.target.valueAsNumber })} />
          </label>}
        </div>;
      })}
    </fieldset>}
    <fieldset><legend>Outputs</legend><ul>
      {workflow.outputs.map((port, index) => <li key={index}>{port.name} · {port.kind}</li>)}
    </ul></fieldset>
  </WorkflowDialog>;
}
