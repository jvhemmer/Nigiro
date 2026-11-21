import { useRef, useState } from "react";
import type { ProjectSource } from "./workspace";

export const columnFormulaId = "nigiro.column_formula";

function referenceName(name: string) {
  return /^[a-zA-Z_][\w.]*$/.test(name) ? name : JSON.stringify(name);
}

export function FormulaEditor({ value, sources, onChange }: {
  value: string;
  sources: ProjectSource[];
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [column, setColumn] = useState("");
  const source = sources[sourceIndex];
  const scalar = source?.row_count === 1 && source.columns.length === 1;
  const selected = column || (scalar ? "scalar" : "0");

  function insert() {
    if (!source || !input.current) return;
    let reference = `$${referenceName(source.name)}`;
    if (selected !== "scalar") {
      const name = source.columns[Number(selected)];
      const unique = name && source.columns.indexOf(name) === source.columns.lastIndexOf(name);
      reference += ":" + (unique ? referenceName(name) : String(Number(selected) + 1));
    }
    const start = input.current.selectionStart ?? value.length;
    const end = input.current.selectionEnd ?? start;
    onChange(value.slice(0, start) + reference + value.slice(end));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + reference.length, start + reference.length);
    });
  }

  return <>
    <label><span>Formula</span><input ref={input} value={value} onChange={(event) => onChange(event.target.value)} /></label>
    <p className="muted">Use <code>value</code> for the output column, <code>$Source:Column</code> for a column, or <code>$Source</code> for a single value. Matching rows are paired by position.</p>
    {source && <fieldset>
      <legend>Insert reference</legend>
      <label><span>Reference source</span>
        <select aria-label="Reference source" value={sourceIndex} onChange={(event) => {
          setSourceIndex(Number(event.target.value));
          setColumn("");
        }}>
          {sources.map(({ id, name }, index) => <option key={id ?? "primary"} value={index}>{name}</option>)}
        </select>
      </label>
      <label><span>Reference column</span>
        <select aria-label="Reference column" value={selected} onChange={(event) => setColumn(event.target.value)}>
          {scalar && <option value="scalar">Single value</option>}
          {source.columns.map((name, index) => <option key={index} value={index}>{name || `Column ${index + 1}`}</option>)}
        </select>
      </label>
      <button type="button" onClick={insert}>Insert reference</button>
    </fieldset>}
  </>;
}
