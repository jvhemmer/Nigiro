import { useId, useRef, useState } from "react";
import type { ProjectSource } from "./workspace";

export const columnFormulaId = "nigiro.column_formula";
export const arrayFormulaId = "nigiro.array_formula";

function referenceName(name: string) {
  return /^[a-zA-Z_][\w.]*$/.test(name) ? name : JSON.stringify(name);
}

const trailingReference = /[$#]("(?:[^"\\]|\\.)*"?|[\p{L}\p{N}_.]*)(?::("(?:[^"\\]|\\.)*"?|[\p{L}\p{N}_.]*))?$/u;
const highlightToken = /([$#](?:"(?:[^"\\]|\\.)*"|[\p{L}\p{N}_.]*)(?::(?:"(?:[^"\\]|\\.)*"|[\p{L}\p{N}_.]*))?|\b(?:value|i|abs|min|max|sqrt|exp|log10?|sin|cos|tan)\b|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[=+*/^%<>!()-])/gu;

function completions(value: string, caret: number, sources: ProjectSource[]) {
  const match = trailingReference.exec(value.slice(0, caret));
  if (!match) return [];
  const [, sourceName, columnName] = match;
  const matches = (name: string, fragment: string) =>
    name.toLowerCase().includes(fragment.replace(/^"|"$/g, "").toLowerCase());
  const remainder = value.slice(caret);
  const fragment = columnName ?? sourceName;
  const suffix = remainder.match(fragment.startsWith('"') && !fragment.endsWith('"')
    ? /^(?:[^"\\]|\\.)*"?/ : /^[\p{L}\p{N}_.]*/u)?.[0] ?? "";
  const end = caret + suffix.length;
  if (columnName !== undefined) {
    const source = sources.find(({ name }) => name === sourceName || referenceName(name) === sourceName);
    if (!source) return [];
    return source.columns.flatMap((name, index, columns) => {
      const label = name || `Column ${index + 1}`;
      const unique = name && columns.indexOf(name) === columns.lastIndexOf(name);
      const replacement = unique ? referenceName(name) : String(index + 1);
      return matches(label, fragment) || matches(String(index + 1), fragment)
        ? [{ label, replacement, start: caret - fragment.length, end }] : [];
    }).slice(0, 8);
  }
  return sources.filter(({ name }) => matches(name, fragment)).slice(0, 8).map((source) => ({
    label: source.name,
    replacement: referenceName(source.name) + (value[end] !== ":" && (source.row_count !== 1 || source.columns.length !== 1) ? ":" : ""),
    start: caret - fragment.length,
    end,
  }));
}

export function FormulaEditor({ value, sources, onChange, array = false, mixed = false, filter = false }: {
  value: string;
  sources: ProjectSource[];
  onChange: (value: string) => void;
  array?: boolean;
  mixed?: boolean;
  filter?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const formula = !mixed || value.trimStart().startsWith("=");
  const suggestions = focused && !dismissed && formula ? completions(value, caret, sources) : [];
  const selected = Math.min(active, suggestions.length - 1);

  function syncScroll() {
    if (!input.current || !mirror.current) return;
    mirror.current.scrollTop = input.current.scrollTop;
    mirror.current.scrollLeft = input.current.scrollLeft;
  }

  function choose(suggestion: (typeof suggestions)[number]) {
    const { replacement, start, end } = suggestion;
    const position = start + replacement.length;
    onChange(value.slice(0, start) + replacement + value.slice(end));
    setCaret(position);
    setActive(0);
    setDismissed(!replacement.endsWith(":"));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
      syncScroll();
    });
  }

  return <div className="formula-editor">
    <label htmlFor={id}>{mixed ? "Values or formula" : filter ? "Expression" : "Formula"}</label>
    <div className="formula-surface">
      <pre ref={mirror} aria-hidden="true">{formula ? value.split(highlightToken).map((part, index) => index % 2
        ? <span key={index} className={/^[$#]/.test(part) ? "formula-reference" : /^[\d.]/.test(part) ? "formula-number" : "formula-operator"}>{part}</span>
        : part) : value}{"\n"}</pre>
      <textarea id={id} ref={input} rows={mixed ? 5 : 2} wrap="off" spellCheck={false} value={value}
        aria-describedby={`${id}-help`} aria-autocomplete="list" aria-controls={suggestions.length ? `${id}-suggestions` : undefined}
        aria-activedescendant={selected >= 0 ? `${id}-suggestion-${selected}` : undefined}
        onFocus={(event) => { setFocused(true); setCaret(event.target.selectionStart); }}
        onBlur={() => setFocused(false)}
        onScroll={syncScroll}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setDismissed(false);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(true);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(suggestions[selected]);
          }
        }} />
      {suggestions.length > 0 && <ul id={`${id}-suggestions`} role="listbox" className="formula-suggestions" aria-label="Reference suggestions">
        {suggestions.map((suggestion, index) => <li key={index} id={`${id}-suggestion-${index}`} role="option"
          aria-selected={index === selected} onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(suggestion)}>{suggestion.label}</li>)}
      </ul>}
    </div>
    <p id={`${id}-help`} className="muted">
      {mixed ? <>Separate values with spaces, commas, or new lines. Start with <code>=</code> for a formula.</>
        : filter ? <>Use <code>value</code> for the selected column.</>
        : <>Use <code>value</code> for the output column or <code>$Source</code> for a single value.</>}
      {!filter && <> Type <code>$</code> for source names and <code>:</code> for columns.</>}
      {array && <> Use <code>(i-1)</code> or <code>(i+1)</code> for neighboring rows.</>}
    </p>
  </div>;
}
