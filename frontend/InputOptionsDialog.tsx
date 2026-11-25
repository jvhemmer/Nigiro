import { CircuitField } from "./CircuitDesigner";
import { columnFormulaId, FormulaEditor } from "./FormulaEditor";
import { SourceChecklist, type SourceChoice } from "./SourceChecklist";
import { useEffect, useId, useRef, useState } from "react";
import type { PluginDefinition, PluginField, PluginOptions, PluginSubmission, Project } from "./workspace";

export function columnFields(plugin: PluginDefinition) {
  return plugin.fields.filter((field) => field.type === "column");
}

export function supportsPairedSources(plugin: PluginDefinition | null) {
  return plugin?.checksum === null && ["nigiro.scatter", "nigiro.line", "nigiro.bar"].includes(plugin.id);
}

function PluginOptionField({ field, columns, value, onChange }: {
  field: PluginField;
  columns: string[];
  value: PluginOptions[string];
  onChange: (value: PluginOptions[string]) => void;
}) {
  if (field.editor === "eis_circuit") {
    return <div className="circuit-option"><span>{field.label}</span><CircuitField value={String(value)} onChange={onChange} /></div>;
  }
  return (
    <label>
      <span>{field.label}{field.help && <small className="muted plugin-field-help">{field.help}</small>}</span>
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

const parameterFields = [
  { key: "guesses", label: "Initial guess", placeholder: "Auto" },
  { key: "lower", label: "Lower bound", placeholder: "Auto" },
  { key: "upper", label: "Upper bound", placeholder: "Unbounded" },
] as const;

function FitParameters({ names, options, onChange }: {
  names: string[];
  options: PluginOptions;
  onChange: (key: string, value: string) => void;
}) {
  return <div className="batch-mappings">
    <table aria-label="Fit parameters">
      <thead><tr><th scope="col">Parameter</th>
        {parameterFields.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}</tr></thead>
      <tbody>{names.map((name, index) => <tr key={index}>
        <th scope="row">{name}</th>
        {parameterFields.map(({ key, label, placeholder }) => {
          const values = String(options[key] ?? "").split(",").map((value) => value.trim());
          return <td key={key}><input aria-label={`${label} for ${name}`} placeholder={placeholder}
            inputMode="text" value={values[index] ?? ""}
            onChange={(event) => {
              const next = names.map((_, row) => row === index ? event.target.value.trim() : values[row] ?? "");
              onChange(key, next.some(Boolean) ? next.join(",") : "");
            }} /></td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
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

const scalarFields: PluginField[] = [
  { key: "column", label: "Column", type: "column", default: 0 },
  { key: "factor", label: "Factor", type: "number", default: 1 },
];

export function InputOptionsDialog({ target, project, previous, editingSource, configuring, busy, error, onClose, onRun }: {
  target: PluginDefinition | "scale";
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
  const scale = target === "scale";
  const plugin = scale ? null : target;
  const sources = editingSource ? [editingSource] : scale
    ? project.sources.filter((source) => source.kind === "raw")
    : project.sources;
  const initialSource = sources.find((source) => source.id === project.source_id) ?? sources[0];
  const axisSources = sources.filter(({ columns }) => columns.length > 0);
  const pair = !configuring && supportsPairedSources(plugin);
  const joint = plugin?.input_mode === "joint";
  const tableOnly = plugin?.table_only;
  const sameSource = (initialSource?.columns.length ?? 0) > 1;
  const [xInput, setXInput] = useState({ id: initialSource?.id ?? null, column: 0 });
  const [yInput, setYInput] = useState({
    id: (sameSource ? initialSource : axisSources.find(({ id }) => id !== initialSource?.id) ?? initialSource)?.id ?? null,
    column: sameSource ? 1 : 0,
  });
  const xSource = axisSources.find(({ id }) => id === xInput.id);
  const ySource = axisSources.find(({ id }) => id === yInput.id);
  const definitionFields = plugin?.fields ?? scalarFields;
  const [jointInputs, setJointInputs] = useState(() => Object.fromEntries(
    definitionFields.filter(({ type }) => type === "column").map((field) => {
      const source = (field.prefer_other_source ? axisSources.find(({ id }) => id !== initialSource?.id) : undefined) ?? initialSource;
      return [field.key, { source_id: source?.id ?? null, column: Math.min(Number(field.default), (source?.columns.length ?? 0) - 1) }];
    }),
  ));
  const filterSegments = plugin?.id === "nigiro.filter_segments";
  const segmentColumn = initialSource?.columns.findIndex((name) => /^segments?\b/i.test(name.trim())) ?? -1;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Inputs");
  const [picked, setPicked] = useState(() => new Set(initialSource ? [initialSource.id] : []));
  const [referenceId, setReferenceId] = useState<SourceId>(initialSource?.id ?? null);
  const [options, setOptions] = useState<PluginOptions>(() => Object.fromEntries(definitionFields.map((field) => {
    const value = previous?.[field.key] ?? (filterSegments && field.key === "column" && segmentColumn >= 0 ? segmentColumn : field.default);
    return [field.key, field.type === "column" ? Math.min(Number(value), (initialSource?.columns.length ?? 0) - 1) : value];
  })));
  const [overrides, setOverrides] = useState(new Map<SourceId, Record<string, number>>());
  const [mode, setMode] = useState<PluginSubmission["output"]>("overlay");
  const [destination, setDestination] = useState<number | null>(null);
  const [destinations, setDestinations] = useState(new Map<SourceId, number | null>());
  const inputs = sources.filter(({ id }) => picked.has(id));
  const reference = inputs.find(({ id }) => id === referenceId) ?? inputs[0];
  const fields = definitionFields.filter((field) => field.type === "column");
  const formula = plugin?.id === columnFormulaId;
  const filter = plugin?.id === "nigiro.filter";
  const outputField = filter ? definitionFields.find(({ key }) => key === "output") : undefined;
  function isVisible(field: PluginField) {
    return Object.entries(field.visible_when ?? {}).every(([key, value]) =>
      Array.isArray(value) ? value.includes(options[key]) : options[key] === value);
  }
  const config = definitionFields.filter((field) => field.type !== "column" && field !== outputField && isVisible(field));
  const submittedOptions = Object.fromEntries(definitionFields.map((field) => [
    field.key, isVisible(field) ? options[field.key] : field.default,
  ]));
  const parameterNames = plugin?.model_parameters
    ? plugin.model_parameters[String(options.model)] ?? String(options.parameters).split(",").map((name) => name.trim()).filter(Boolean)
    : null;
  const emptyRequired = config.find((field) => field.type === "text" && field.required && !String(options[field.key]).trim());
  const output = tableOnly || scale || formula ? "separate" : !pair && !joint && inputs.length > 1 ? mode : "overlay";
  const runs = reference ? inputs.map((source) => {
    const mapped = { ...submittedOptions };
    for (const { key } of fields) {
      const override = inputs.length > 1 ? overrides.get(source.id)?.[key] : undefined;
      mapped[key] = override ?? matchColumn(source, reference, Number(options[key]));
    }
    const values = fields.map(({ key }) => Number(mapped[key]));
    return {
      source_id: source.id, options: mapped, target_id: output === "separate" ? destinations.get(source.id) ?? null : null,
      valid: values.every((index) => index >= 0 && index < source.columns.length)
        && (!plugin?.distinct_columns || new Set(values).size === values.length),
    };
  }) : [];
  const inputError = pair
    ? !xSource || !ySource ? "Select a source for each axis."
      : xSource.id === ySource.id && xInput.column === yInput.column ? "Choose different columns for X and Y."
      : "row_count" in xSource && "row_count" in ySource && xSource.row_count !== ySource.row_count
        ? "Choose X and Y sources with the same number of rows." : ""
    : joint ? fields.some(({ key }) => {
      const input = jointInputs[key];
      const source = axisSources.find(({ id }) => id === input.source_id);
      return !source || input.column < 0 || input.column >= source.columns.length;
    }) ? "Choose a source and column for each input." : ""
    : !runs.length ? "Select a source." : runs.some((run) => !run.valid) ? "Choose valid columns for each source." : "";
  const configError = emptyRequired
    ? `Enter a value for ${emptyRequired.label} on the Configuration tab.`
    : formula && !String(options.expression ?? "").trim()
    ? "Enter a formula on the Configuration tab."
    : filterSegments && !/^\s*\d+\s*(?:,\s*\d+\s*)*$/.test(String(options.segments))
    ? "Enter segment numbers separated by commas on the Configuration tab."
    : config.some(({ type, key, min, max }) =>
    type === "number" && (!Number.isFinite(options[key]) || Number(options[key]) < (min ?? -Infinity)
      || Number(options[key]) > (max ?? Infinity))) ? "Check the values on the Configuration tab." : "";
  const targets = runs.flatMap(({ target_id }) => target_id === null ? [] : [target_id]);
  const outputError = !joint && new Set(targets).size !== targets.length ? "Choose a different figure for each source." : "";
  const problem = inputError || configError || outputError;

  useEffect(() => { dialog.current?.showModal(); }, []);

  function change(key: string, value: PluginOptions[string]) {
    setOptions((current) => ({ ...current,
      ...(plugin?.model_parameters && (key === "model" || key === "parameters") ? { guesses: "", lower: "", upper: "" } : {}),
      [key]: value,
    }));
  }

  function selectReference(source: SourceChoice) {
    const before = sources.find(({ id }) => id === referenceId);
    if (!before || source.id === before.id) return;
    setReferenceId(source.id);
    setOptions((current) => {
      const next = { ...current };
      for (const { key } of fields) {
        const matched = matchColumn(source, before, Number(current[key]));
        next[key] = matched >= 0 ? matched : Math.min(Number(current[key]), source.columns.length - 1);
      }
      return next;
    });
  }

  return (
    <dialog ref={dialog} className="settings-dialog plugin-dialog" aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!problem && !busy) onRun({
          output, target_id: output === "overlay" ? destination : null,
          runs: pair ? [{
            source_id: xInput.id, options: { ...submittedOptions, x: 0, y: 1 }, target_id: null,
            references: { x: { source_id: xInput.id, column: xInput.column }, y: { source_id: yInput.id, column: yInput.column } },
          }] : joint ? [{
            source_id: jointInputs[fields[0].key].source_id,
            options: { ...submittedOptions, ...Object.fromEntries(fields.map(({ key }) => [key, jointInputs[key].column])) },
            target_id: null, references: jointInputs,
          }] : runs.map(({ source_id, options, target_id }) => ({ source_id, options, target_id })),
        });
      }}>
        <h2 id={`${id}-title`}>{!plugin ? "Scalar multiplication" : plugin.menu === "plot" ? `${plugin.name} plot` : plugin.name}</h2>
        <div className="plugin-body">
        <div className="plugin-tabs" role="tablist" aria-label="Input options" aria-orientation="vertical">
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
          {joint ? <div className="fit-settings plugin-fields">
            {fields.map((field) => {
              const input = jointInputs[field.key];
              const source = axisSources.find(({ id }) => id === input.source_id);
              return <fieldset key={field.key}>
                <legend>{field.label}</legend>
                <label><span>Source</span>
                  <select aria-label={`${field.label} source`} value={source ? sourceKey(source.id) : ""} onChange={(event) => {
                    const selected = axisSources.find(({ id }) => sourceKey(id) === event.target.value);
                    if (selected) setJointInputs((current) => ({
                      ...current, [field.key]: { source_id: selected.id, column: Math.min(input.column, selected.columns.length - 1) },
                    }));
                  }}>
                    {!source && <option value="" disabled>Choose a source</option>}
                    {axisSources.map(({ id, name }) => <option key={sourceKey(id)} value={sourceKey(id)}>{name}</option>)}
                  </select>
                </label>
                <PluginOptionField field={field} columns={source?.columns ?? []} value={input.column}
                  onChange={(value) => setJointInputs((current) => ({
                    ...current, [field.key]: { ...input, column: Number(value) },
                  }))} />
              </fieldset>;
            })}
            <p className="muted">These inputs run together in one step.</p>
          </div> : pair ? <div className="fit-settings plugin-fields">
            {([{ axis: "X", input: xInput, source: xSource, set: setXInput },
              { axis: "Y", input: yInput, source: ySource, set: setYInput }]).map(({ axis, input, source, set }) => (
              <fieldset key={axis}>
                <legend>{axis} axis</legend>
                <label><span>Source</span>
                  <select aria-label={`${axis} source`} value={source ? sourceKey(source.id) : ""} onChange={(event) => {
                    const next = axisSources.find(({ id }) => sourceKey(id) === event.target.value);
                    if (next) set({ id: next.id, column: 0 });
                  }}>
                    {!source && <option value="" disabled>Choose a source</option>}
                    {axisSources.map(({ id, name }) => <option key={sourceKey(id)} value={sourceKey(id)}>{name}</option>)}
                  </select>
                </label>
                <PluginOptionField field={{ key: axis, label: `${axis} column`, type: "column", default: 0 }}
                  columns={source?.columns ?? []} value={input.column} onChange={(value) => set({ ...input, column: Number(value) })} />
              </fieldset>
            ))}
            <p className="muted">Rows are paired in order.</p>
          </div> : <>
          <SourceChecklist sources={sources} picked={picked} single={formula} disabled={configuring || busy} onChange={(next) => {
            const first = sources.find(({ id }) => next.has(id));
            if (!next.has(referenceId) && first) selectReference(first);
            setPicked(next);
          }} />
          {reference && fields.length > 0 && <>
            <div className="batch-controls fit-settings plugin-fields">
              {inputs.length > 1 && <label><span>Match columns from</span>
                <select aria-label="Match columns from" value={sourceKey(reference.id)} onChange={(event) => {
                  const source = inputs.find(({ id }) => sourceKey(id) === event.target.value);
                  if (source) selectReference(source);
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
          </>}
        </section>
        <section role="tabpanel" id={`${id}-panel-Configuration`} aria-labelledby={`${id}-tab-Configuration`} hidden={tab !== "Configuration"}>
          {config.length ? <div className="fit-settings plugin-fields">
            {filterSegments && <p className="muted">Enter segment numbers separated by commas, for example 1,2,3,5.</p>}
            {config.filter((field) => !parameterNames || !parameterFields.some(({ key }) => key === field.key)).map((field) => (formula || filter) && field.key === "expression"
              ? <FormulaEditor key={field.key} filter={filter} value={String(options[field.key])} sources={filter ? [] : project.sources}
                  onChange={(value) => change(field.key, value)} />
              : <PluginOptionField key={field.key} field={field} columns={[]}
                  value={options[field.key]} onChange={(value) => change(field.key, value)} />)}
            {parameterNames && <FitParameters names={parameterNames} options={options} onChange={change} />}
          </div> : <p className="muted">This plugin has no additional settings.</p>}
        </section>
        <section role="tabpanel" id={`${id}-panel-Output`} aria-labelledby={`${id}-tab-Output`} hidden={tab !== "Output"}>
          {scale ? <p>Updates the working column in each selected source. The original CSV files stay intact.</p>
          : formula ? <p>Creates a new worksheet with the calculated column and the other columns from the output worksheet.</p> : <>
          <fieldset>
            <legend>Plugin outputs</legend>
            <ul>{(plugin?.outputs?.length ? plugin.outputs : tableOnly ? ["Source tables"] : ["Figure", ...(plugin?.menu === "analysis" ? ["Plugin results, if available"] : [])])
              .map((label, index) => <li key={index}>{label}</li>)}</ul>
          </fieldset>
          {outputField ? <div className="fit-settings">
            <PluginOptionField field={outputField} columns={[]} value={options[outputField.key]}
              onChange={(value) => change(outputField.key, value)} />
            <p className="muted">Each input produces a new source in the Sources panel.</p>
          </div> : tableOnly ? <p className="muted">Results appear in Sources.</p> : configuring ? <p className="muted">Update the current figure.</p> : <div className="fit-settings">
            {!pair && !joint && inputs.length > 1 && <label><span>Combine inputs</span>
              <select aria-label="Combine inputs" value={mode} onChange={(event) => setMode(event.target.value === "separate" ? "separate" : "overlay")}>
                <option value="overlay">Overlay in one figure</option>
                <option value="separate">One figure per source</option>
              </select>
            </label>}
            {output === "overlay" ? <Destination label="Destination" figures={project.figures} value={destination} onChange={setDestination} />
              : inputs.map(({ id, name }) => <Destination key={sourceKey(id)} label={`Destination for ${name}`}
                figures={project.figures} value={destinations.get(id) ?? null}
                onChange={(value) => setDestinations((current) => new Map(current).set(id, value))} />)}
            {["nigiro.linear_fit", "nigiro.nonlinear_fit"].includes(plugin?.id ?? "") && <p className="muted">Residuals go to a separate figure. Result tables appear in Sources.</p>}
          </div>}
          </>}
        </section>
        </div>
        {problem && <p className="muted">{problem}</p>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!!problem || busy}>
            {configuring ? "Update figure" : scale ? "Add step" : formula ? "Calculate column" : plugin?.menu === "plot" ? "Create plot" : "Run analysis"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
