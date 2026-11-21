import { SourceChecklist, type SourceChoice } from "./SourceChecklist";
import { useEffect, useId, useRef, useState } from "react";
import type { PluginDefinition, PluginField, PluginOptions, PluginSubmission, Project } from "./workspace";

export function columnFields(plugin: PluginDefinition) {
  return plugin.fields.filter((field) => field.type === "column");
}

function PluginOptionField({ field, columns, value, onChange }: {
  field: PluginField;
  columns: string[];
  value: PluginOptions[string];
  onChange: (value: PluginOptions[string]) => void;
}) {
  return (
    <label>
      <span>{field.label}</span>
      {field.type === "column" && (
        <select aria-label={field.label} value={Number(value)}
          onChange={(event) => onChange(Number(event.target.value))}>
          {(Number(value) < 0 || Number(value) >= columns.length) && <option value={Number(value)} disabled>Choose a column</option>}
          {columns.map((name, index) => (
            <option key={index} value={index}>{name || `Column ${index + 1}`}</option>
          ))}
        </select>
      )}
      {field.type === "choice" && (
        <select aria-label={field.label} value={String(value)}
          onChange={(event) => onChange(event.target.value)}>
          {field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      )}
      {field.type === "boolean" && (
        <input type="checkbox" checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)} />
      )}
      {field.type === "number" && (
        <input type="number" required step="any" min={field.min} max={field.max}
          value={Number.isNaN(value) ? "" : Number(value)}
          onChange={(event) => onChange(event.target.valueAsNumber)} />
      )}
      {field.type === "text" && (
        <input value={String(value)} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

type SourceId = SourceChoice["id"];
const tabs = ["Inputs", "Configuration", "Output"] as const;
const sourceKey = (id: SourceId) => id ?? "primary";
const columnName = (name: string, index: number) => name || `Column ${index + 1}`;

function matchColumn(source: SourceChoice, reference: SourceChoice, index: number) {
  if (source.id === reference.id) return index < source.columns.length ? index : -1;
  const name = reference.columns[index]?.trim().toLowerCase();
  if (!name) return -1;
  const matches = source.columns.flatMap((column, i) => column.trim().toLowerCase() === name ? [i] : []);
  return matches.length === 1 ? matches[0] : -1;
}

function Destination({ label, figures, value, onChange }: {
  label: string;
  figures: Project["figures"];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return <label><span>{label}</span>
    <select aria-label={label} value={value ?? ""} onChange={(event) => {
      const value = event.target.value;
      onChange(value === "" ? null : Number(value));
    }}>
      <option value="">New figure</option>
      {figures.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}

export function PluginDialog({ plugin, project, previous, editingSource, configuring, busy, error, onClose, onRun }: {
  plugin: PluginDefinition;
  project: Project;
  previous?: PluginOptions;
  editingSource?: SourceChoice;
  configuring: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onRun: (submission: PluginSubmission) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const initialSource = editingSource ?? project.sources.find((source) => source.id === project.source_id) ?? project.sources[0];
  const sources = editingSource ? [editingSource] : project.sources;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Inputs");
  const [picked, setPicked] = useState(() => new Set(initialSource ? [initialSource.id] : []));
  const [referenceId, setReferenceId] = useState<SourceId>(initialSource?.id ?? null);
  const [options, setOptions] = useState<PluginOptions>(() => Object.fromEntries(plugin.fields.map((field) => {
    const value = previous?.[field.key] ?? field.default;
    return [field.key, field.type === "column" ? Math.min(Number(value), (initialSource?.columns.length ?? 0) - 1) : value];
  })));
  const [overrides, setOverrides] = useState(new Map<SourceId, Record<string, number>>());
  const [mode, setMode] = useState<PluginSubmission["output"]>("overlay");
  const [destination, setDestination] = useState<number | null>(null);
  const [destinations, setDestinations] = useState(new Map<SourceId, number | null>());
  const inputs = sources.filter(({ id }) => picked.has(id));
  const reference = inputs.find(({ id }) => id === referenceId) ?? inputs[0];
  const fields = columnFields(plugin);
  const filter = plugin.id === "nigiro.filter";
  const outputField = filter ? plugin.fields.find(({ key }) => key === "output") : undefined;
  const config = plugin.fields.filter((field) => field.type !== "column" && field !== outputField);
  const output = filter ? "separate" : inputs.length > 1 ? mode : "overlay";
  const runs = reference ? inputs.map((source) => {
    const mapped = { ...options };
    for (const { key } of fields) {
      const override = inputs.length > 1 ? overrides.get(source.id)?.[key] : undefined;
      mapped[key] = override ?? matchColumn(source, reference, Number(options[key]));
    }
    const values = fields.map(({ key }) => Number(mapped[key]));
    return {
      source_id: source.id, options: mapped, target_id: output === "separate" ? destinations.get(source.id) ?? null : null,
      valid: values.every((index) => index >= 0 && index < source.columns.length)
        && (!plugin.distinct_columns || new Set(values).size === values.length),
    };
  }) : [];
  const inputError = !runs.length ? "Select a source." : runs.some((run) => !run.valid) ? "Choose valid columns for each source." : "";
  const configError = config.some(({ type, key, min, max }) =>
    type === "number" && (!Number.isFinite(options[key]) || Number(options[key]) < (min ?? -Infinity)
      || Number(options[key]) > (max ?? Infinity))) ? "Check the values on the Configuration tab." : "";
  const targets = runs.flatMap(({ target_id }) => target_id === null ? [] : [target_id]);
  const outputError = new Set(targets).size !== targets.length ? "Choose a different figure for each source." : "";
  const problem = inputError || configError || outputError;

  useEffect(() => { dialog.current?.showModal(); }, []);

  function change(key: string, value: PluginOptions[string]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <dialog ref={dialog} className="settings-dialog plugin-dialog" aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!problem && !busy) onRun({
          output, target_id: output === "overlay" ? destination : null,
          runs: runs.map(({ source_id, options, target_id }) => ({ source_id, options, target_id })),
        });
      }}>
        <h2 id={`${id}-title`}>{plugin.menu === "plot" ? `${plugin.name} plot` : plugin.name}</h2>
        <div className="plugin-body">
        <div className="plugin-tabs" role="tablist" aria-label="Plugin setup" aria-orientation="vertical">
          {tabs.map((name, index) => (
            <button key={name} id={`${id}-tab-${name}`} role="tab" aria-selected={tab === name}
              aria-controls={`${id}-panel-${name}`} tabIndex={tab === name ? 0 : -1} type="button"
              onClick={() => setTab(name)} onKeyDown={(event) => {
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : event.key === "ArrowDown" ? (index + 1) % tabs.length
                  : event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(tabs[next]);
                event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
              }}>{name}</button>
          ))}
        </div>
        <section role="tabpanel" id={`${id}-panel-Inputs`} aria-labelledby={`${id}-tab-Inputs`} hidden={tab !== "Inputs"}>
          <SourceChecklist sources={sources} picked={picked} disabled={configuring || busy} onChange={setPicked} />
          {reference && fields.length > 0 && <>
            <div className="batch-controls fit-settings plugin-fields">
              {inputs.length > 1 && <label><span>Match columns from</span>
                <select aria-label="Match columns from" value={sourceKey(reference.id)} onChange={(event) => {
                  const source = inputs.find(({ id }) => sourceKey(id) === event.target.value);
                  if (source) {
                    setReferenceId(source.id);
                    setOptions((current) => {
                      const next = { ...current };
                      for (const { key } of fields) {
                        const matched = matchColumn(source, reference, Number(current[key]));
                        next[key] = matched >= 0 ? matched : Math.min(Number(current[key]), source.columns.length - 1);
                      }
                      return next;
                    });
                  }
                }}>
                  {inputs.map(({ id, name }) => <option key={sourceKey(id)} value={sourceKey(id)}>{name}</option>)}
                </select>
              </label>}
              {fields.map((field) => <PluginOptionField key={field.key} field={field} columns={reference.columns}
                value={options[field.key]} onChange={(value) => change(field.key, value)} />)}
            </div>
            {inputs.length > 1 && <div className="batch-mappings">
              <table aria-label="Column mappings">
                <thead><tr><th scope="col">Source</th>
                  {fields.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}</tr></thead>
                <tbody>{inputs.map((source) => <tr key={sourceKey(source.id)}>
                  <th scope="row">{source.name}</th>
                  {fields.map(({ key, label }) => {
                    const matched = matchColumn(source, reference, Number(options[key]));
                    return <td key={key}>
                      <select aria-label={`${label} for ${source.name}`} value={overrides.get(source.id)?.[key] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setOverrides((current) => {
                            const next = new Map(current);
                            const columns = { ...current.get(source.id) };
                            if (value === "") delete columns[key];
                            else columns[key] = Number(value);
                            next.set(source.id, columns);
                            return next;
                          });
                        }}>
                        <option value="">{matched < 0 ? "Choose a column" : `Match · ${columnName(source.columns[matched], matched)}`}</option>
                        {source.columns.map((name, index) => <option key={index} value={index}>{columnName(name, index)}</option>)}
                      </select>
                    </td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div>}
          </>}
        </section>
        <section role="tabpanel" id={`${id}-panel-Configuration`} aria-labelledby={`${id}-tab-Configuration`} hidden={tab !== "Configuration"}>
          {config.length ? <div className="fit-settings plugin-fields">
            {filter && <p className="muted">Use value to refer to the selected column. For example, 0 &lt; value &lt;= 10.</p>}
            {config.map((field) => <PluginOptionField key={field.key} field={field} columns={[]}
              value={options[field.key]} onChange={(value) => change(field.key, value)} />)}
          </div> : <p className="muted">This plugin has no additional settings.</p>}
        </section>
        <section role="tabpanel" id={`${id}-panel-Output`} aria-labelledby={`${id}-tab-Output`} hidden={tab !== "Output"}>
          <fieldset>
            <legend>Plugin outputs</legend>
            <ul>{(plugin.outputs?.length ? plugin.outputs : ["Figure", ...(plugin.menu === "analysis" ? ["Plugin results, if available"] : [])])
              .map((label, index) => <li key={index}>{label}</li>)}</ul>
          </fieldset>
          {outputField ? <div className="fit-settings">
            <PluginOptionField field={outputField} columns={[]} value={options[outputField.key]}
              onChange={(value) => change(outputField.key, value)} />
            <p className="muted">Each input produces a new source in the Sources panel.</p>
          </div> : configuring ? <p className="muted">Update the current figure.</p> : <div className="fit-settings">
            {inputs.length > 1 && <label><span>Combine inputs</span>
              <select aria-label="Combine inputs" value={mode} onChange={(event) => setMode(event.target.value === "separate" ? "separate" : "overlay")}>
                <option value="overlay">Overlay in one figure</option>
                <option value="separate">One figure per source</option>
              </select>
            </label>}
            {output === "overlay" ? <Destination label="Destination" figures={project.figures} value={destination} onChange={setDestination} />
              : inputs.map(({ id, name }) => <Destination key={sourceKey(id)} label={`Destination for ${name}`}
                figures={project.figures} value={destinations.get(id) ?? null}
                onChange={(value) => setDestinations((current) => new Map(current).set(id, value))} />)}
            {plugin.id === "nigiro.linear_fit" && <p className="muted">Residuals go to a separate figure. Result tables appear in Sources.</p>}
          </div>}
        </section>
        </div>
        {problem && <p className="muted">{problem}</p>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!!problem || busy}>
            {configuring ? "Update figure" : plugin.menu === "plot" ? "Create plot" : "Run analysis"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
