import { useEffect, useRef, useState } from "react";
import type { PluginDefinition, PluginOptions } from "./workspace";

export function columnFields(plugin: PluginDefinition) {
  return plugin.fields.filter((field) => field.type === "column");
}

export function PluginDialog({ plugin, columns, previous, configuring, sourceName, onClose, onRun }: {
  plugin: PluginDefinition;
  columns: string[];
  previous?: PluginOptions;
  configuring: boolean;
  sourceName?: string;
  onClose: () => void;
  onRun: (options: PluginOptions) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<PluginOptions>(() => Object.fromEntries(plugin.fields.map((field) => {
    const value = previous?.[field.key] ?? field.default;
    return [field.key, field.type === "column" ? Math.min(Number(value), columns.length - 1) : value];
  })));
  const picks = columnFields(plugin).map(({ key }) => options[key]);
  const duplicates = plugin.distinct_columns && new Set(picks).size !== picks.length;

  useEffect(() => { dialog.current?.showModal(); }, []);

  function change(key: string, value: PluginOptions[string]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="plugin-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!duplicates) onRun(options);
      }}>
        <h2 id="plugin-title">{plugin.menu === "plot" ? `${plugin.name} plot` : plugin.name}</h2>
        {sourceName && <p className="figure-input muted">Input · {sourceName}</p>}
        <div className="fit-settings plugin-fields">
          {plugin.fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.type === "column" && (
                <select aria-label={field.label} value={Number(options[field.key])}
                  onChange={(event) => change(field.key, Number(event.target.value))}>
                  {columns.map((name, index) => (
                    <option key={index} value={index}>{name || `Column ${index + 1}`}</option>
                  ))}
                </select>
              )}
              {field.type === "choice" && (
                <select aria-label={field.label} value={String(options[field.key])}
                  onChange={(event) => change(field.key, event.target.value)}>
                  {field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              )}
              {field.type === "boolean" && (
                <input type="checkbox" checked={Boolean(options[field.key])}
                  onChange={(event) => change(field.key, event.target.checked)} />
              )}
              {field.type === "number" && (
                <input type="number" required step="any" min={field.min} max={field.max}
                  value={Number.isNaN(options[field.key]) ? "" : Number(options[field.key])}
                  onChange={(event) => change(field.key, event.target.valueAsNumber)} />
              )}
              {field.type === "text" && (
                <input value={String(options[field.key])} onChange={(event) => change(field.key, event.target.value)} />
              )}
            </label>
          ))}
        </div>
        {duplicates && <p className="muted">Choose different columns.</p>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={duplicates}>
            {configuring ? "Update figure" : plugin.menu === "plot" ? "Create plot" : "Run analysis"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
