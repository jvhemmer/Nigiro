import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Project, ProjectWorkflowConfiguration, ProjectWorkflowContext, ProjectWorkflowOutput, Request, SavedWorkflow, WorkflowPorts } from "./workspace";

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

export function ProjectWorkflowDialog({ context, mode, busy, error, onClose, onSave }: Omit<DialogProps, "project" | "onRun"> & {
  context: ProjectWorkflowContext;
  mode: "configure" | "import" | "refresh";
  onSave: (configuration: ProjectWorkflowConfiguration) => Promise<boolean>;
}) {
  const { steps, outputs: choices, configuration } = context;
  const outputKey = ({ reference }: ProjectWorkflowOutput) => JSON.stringify([reference.output, reference.table]);
  const [name, setName] = useState(configuration?.name ?? context.name);
  const [selected, setSelected] = useState(() => new Set(steps.filter(({ id, status }) =>
    status === "done" && (!configuration || configuration.steps.includes(id))).map(({ id }) => id)));
  const [portNames, setPortNames] = useState<Record<string, string>>(() => configuration?.inputs ?? Object.fromEntries(
    steps.flatMap((step) => (step.files ?? []).map((file, index) =>
      [`${step.id}/source/${index}`, file.split(/[/\\]/).pop() || "Imported data"])),
  ));
  const [published, setPublished] = useState<Record<string, string>>(() => Object.fromEntries(
    (configuration?.outputs ?? []).map((choice) => [outputKey(choice), choice.name]),
  ));
  const eligibleSteps = steps.filter(({ id }) => selected.has(id));
  const outputChoices = choices.filter(({ reference }) => selected.has(Number(reference.output.split("/")[0])));
  const inputs = Object.fromEntries(eligibleSteps.flatMap((step): [string, string][] => {
    const keys = step.files?.map((_, index) => `${step.id}/source/${index}`) ??
      (step.scalar && !step.formula ? [`${step.id}/source/0`] : []);
    return keys.filter((key) => key in portNames).map((key) => [key, portNames[key].trim()]);
  }));
  const outputs = outputChoices.filter((choice) => outputKey(choice) in published)
    .map((choice) => ({ ...choice, name: published[outputKey(choice)].trim() }));
  const valid = Boolean(name.trim() && selected.size && outputs.length
    && outputs.every((output) => output.name) && Object.values(inputs).every(Boolean));

  function toggleStep(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setPort(key: string, value?: string) {
    const update = (current: Record<string, string>) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    };
    setPortNames(update);
  }

  function setOutput(key: string, value?: string) {
    setPublished((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  return <WorkflowDialog title={{ configure: "Configure Project Workflow", import: "Import Project as Workflow", refresh: "Refresh Project Workflow" }[mode]}
    submit={{ configure: "Save configuration", import: "Import workflow", refresh: "Refresh workflow" }[mode]}
    {...{ busy, error, onClose, valid }} onSubmit={async () => {
      if (await onSave({ name: name.trim(), steps: [...selected], inputs, outputs })) onClose();
    }}>
    {mode === "configure" && <p className="muted">Save the project to keep this configuration.</p>}
    {mode === "refresh" && <p className="muted">The refreshed workflow applies to future runs. Recorded runs keep their snapshots.</p>}
    <label><span>Workflow name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
    <details>
      <summary>Workflow steps · {selected.size} included</summary>
      <p className="muted">Include the steps that produce each selected output and its inputs.</p>
      {steps.map((step) => <label className="workflow-check" key={step.id}>
        <input type="checkbox" disabled={step.status !== "done"} checked={selected.has(step.id)}
          onChange={(event) => toggleStep(step.id, event.target.checked)} />
        <span>{step.label}</span>
      </label>)}
    </details>
    <fieldset>
      <legend>Inputs</legend>
      <p className="muted">Select the data and variables that callers can replace. Other inputs keep the values from this project.</p>
      {eligibleSteps.map((step) => {
        const ports = (step.files ?? []).map((file, index) => ({
          key: `${step.id}/source/${index}`, name: file.split(/[/\\]/).pop() || "Imported data", kind: "Data",
        }));
        if (step.scalar && !step.formula) ports.push({
          key: `${step.id}/source/0`, name: step.label.replace(/^Add variable /, ""), kind: "Number",
        });
        return ports.map(({ key, name, kind }) => <div className="workflow-port" key={key}>
          <label className="workflow-check">
            <input type="checkbox" checked={key in portNames}
              onChange={(event) => setPort(key, event.target.checked ? name : undefined)} />
            <span>{name} · {kind.toLowerCase()}</span>
          </label>
          {key in portNames && <label><span>{kind} input name</span>
            <input required value={portNames[key]} onChange={(event) => setPort(key, event.target.value)} />
          </label>}
        </div>);
      })}
    </fieldset>
    <fieldset>
      <legend>Outputs</legend>
      <p className="muted">Select the sources and figures to publish to the receiving project.</p>
      {outputChoices.map((choice) => {
        const key = outputKey(choice);
        return <div className="workflow-port" key={key}>
          <label className="workflow-check"><input type="checkbox" checked={key in published}
            onChange={(event) => setOutput(key, event.target.checked ? choice.name : undefined)} />
            <span>{choice.name} · {choice.kind}</span></label>
          {key in published && <label><span>Output name</span>
            <input required value={published[key]} onChange={(event) => setOutput(key, event.target.value)} />
          </label>}
        </div>;
      })}
    </fieldset>
  </WorkflowDialog>;
}

function WorkflowPortEditor({ label, port, onChange }: {
  label: string;
  port: { name: string; exposed: boolean };
  onChange: (port: { name: string; exposed: boolean }) => void;
}) {
  return <div className="workflow-port">
    <label className="workflow-check">
      <input type="checkbox" checked={port.exposed} onChange={(event) => onChange({ ...port, exposed: event.target.checked })} />
      <span>{label}</span>
    </label>
    {port.exposed && <label><span>Display name</span>
      <input required value={port.name} onChange={(event) => onChange({ ...port, name: event.target.value })} />
    </label>}
  </div>;
}

export function EditWorkflowPortsDialog({ context, stepId, busy, error, onClose, onRun }: Omit<DialogProps, "project"> & {
  context: WorkflowPorts;
  stepId: number;
}) {
  const [inputs, setInputs] = useState(context.inputs);
  const [outputs, setOutputs] = useState(context.outputs);
  const published = outputs.filter(({ exposed }) => exposed);
  const valid = published.length > 0 && published.every(({ name }) => !!name.trim())
    && inputs.every(({ name, exposed }) => !exposed || !!name.trim());
  return <WorkflowDialog title={`Workflow inputs and outputs · ${context.name}`} submit="Save changes"
    {...{ busy, error, onClose, valid }} onSubmit={async () => {
      const settings = Object.fromEntries(inputs.map(({ output, exposed, name }, index) =>
        [output, { exposed, name: name.trim() || context.inputs[index].name }]));
      if (await onRun({ action: "edit_workflow_ports", step_id: stepId, inputs: settings, outputs: published })) onClose();
    }}>
    {context.warning && <p className="muted" role="status">{context.warning}</p>}
    <fieldset>
      <legend>Inputs</legend>
      <p className="muted">Hidden inputs keep their current values or source assignments.</p>
      {inputs.map((port, index) => <WorkflowPortEditor key={port.output} port={port}
        label={`${context.inputs[index].name} · ${port.kind === "csv" ? "data" : "number"}`}
        onChange={(value) => setInputs((current) => current.map((item, i) => i === index ? { ...item, ...value } : item))} />)}
    </fieldset>
    <fieldset>
      <legend>Outputs</legend>
      <p className="muted">Select the results to publish to this project.</p>
      {outputs.map((port, index) => <WorkflowPortEditor key={JSON.stringify(port.reference)} port={port}
        label={`${context.outputs[index].name} · ${port.kind}`}
        onChange={(value) => setOutputs((current) => current.map((item, i) => i === index ? { ...item, ...value } : item))} />)}
    </fieldset>
  </WorkflowDialog>;
}

export function RunWorkflowDialog(props: DialogProps & { onRefresh: (workflow: SavedWorkflow) => void }) {
  const workflows = props.project.saved_workflows;
  const [id, setId] = useState(workflows[0]?.id);
  const workflow = workflows.find((record) => record.id === id);
  if (!workflow) return null;
  const sources = props.project.sources.filter((source) => source.kind === "raw")
    .map((source) => ({ ...source, array: source.array_step !== undefined }));
  return <WorkflowRunForm key={id} {...props} workflow={workflow} availableSources={sources} selectedSource={props.project.source_id}
    choose={<><label><span>Workflow</span><select value={id} onChange={(event) => setId(event.target.value)}>
      {workflows.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
    </select></label>
    {workflow.project_path && <button type="button" disabled={props.busy} title={workflow.project_path}
      onClick={() => props.onRefresh(workflow)}>Refresh from project…</button>}</>} />;
}

export function EditWorkflowRunDialog({ context, stepId, ...props }: Omit<DialogProps, "project"> & {
  context: WorkflowPorts; stepId: number;
}) {
  const workflow = { id: "", name: context.name, inputs: context.inputs.filter(({ exposed }) => exposed),
    outputs: context.outputs.filter(({ exposed }) => exposed) };
  return <WorkflowRunForm {...props} workflow={workflow} availableSources={context.sources} selectedSource={null}
    editing={{ stepId, bindings: context.bindings, numbers: context.numbers }}
    choose={context.warning && <p className="muted" role="status">{context.warning}</p>} />;
}

function WorkflowRunForm({ availableSources, selectedSource, workflow, choose, editing, busy, error, onClose, onRun }: Omit<DialogProps, "project"> & {
  workflow: SavedWorkflow;
  choose: ReactNode;
  availableSources: WorkflowPorts["sources"];
  selectedSource: Project["source_id"];
  editing?: { stepId: number; bindings: WorkflowPorts["bindings"]; numbers: WorkflowPorts["numbers"] };
}) {
  const [name, setName] = useState(workflow.name);
  const available = availableSources.filter((source) => !source.scalar && !source.array);
  const variables = availableSources.filter(({ scalar }) => scalar);
  const defaultSource = available.find(({ id }) => id === selectedSource) ?? available[0];
  const [sources, setSources] = useState<Record<string, string | null>>(() => editing?.bindings ?? Object.fromEntries(workflow.inputs
    .filter((port) => port.kind === "csv" && defaultSource).map((port) => [port.output, defaultSource.id])));
  const [numbers, setNumbers] = useState<Record<string, number>>(() => Object.fromEntries(workflow.inputs
    .filter((port) => port.kind === "number").map((port) => [port.output, editing?.numbers[port.output] ?? port.default ?? NaN])));
  const valid = Boolean(name.trim() && workflow.inputs.every((port) => port.kind === "number"
    ? port.output in sources || Number.isFinite(numbers[port.output]) : port.output in sources));
  return <WorkflowDialog title={editing ? "Edit Workflow Run" : "Run Workflow"} submit={editing ? "Save changes" : "Run workflow"} {...{ busy, error, onClose, valid }}
    onSubmit={async () => {
      const values = { name: name.trim(), numbers, sources };
      if (await onRun(editing ? { action: "edit_workflow_run", step_id: editing.stepId, ...values }
        : { action: "run_saved_workflow", id: workflow.id, ...values })) onClose();
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
                : <option value="">{available.length ? "Choose an imported source" : "Import a data file first"}</option>}
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
