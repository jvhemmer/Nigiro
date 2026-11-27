import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ProjectSource } from "./workspace";

export type SourceId = ProjectSource["id"];
export type SourceChoice = Pick<ProjectSource, "id" | "name" | "columns">
  & Partial<Pick<ProjectSource, "original_path" | "row_count">>;

const pathLimit = 100;

export function SourcePath({ path }: { path: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(path);
  useLayoutEffect(() => {
    const cell = element.current;
    const context = document.createElement("canvas").getContext("2d");
    if (!cell || !context) return;
    function fit() {
      if (!cell || !context) return;
      const style = getComputedStyle(cell);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = cell.getBoundingClientRect().width;
      if (width <= 0) return;
      if (path.length <= pathLimit && context.measureText(path).width <= width) {
        setText(path);
        return;
      }
      const tail = Array.from(path).slice(1 - pathLimit);
      let start = 0;
      let end = tail.length;
      while (start < end) {
        const middle = Math.floor((start + end) / 2);
        if (context.measureText(`…${tail.slice(middle).join("")}`).width <= width) end = middle;
        else start = middle + 1;
      }
      setText(`…${tail.slice(start).join("")}`);
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [path]);
  return <span ref={element} className="source-option-path" title={path} dir="ltr">{text}</span>;
}

export function SourceChecklist({ sources, picked, disabled, onChange, single = false, ordered = false, label = single ? "Output worksheet" : "Sources" }: {
  sources: SourceChoice[];
  picked: ReadonlySet<SourceId>;
  disabled: boolean;
  single?: boolean;
  ordered?: boolean;
  label?: string;
  onChange: (picked: Set<SourceId>) => void;
}) {
  const group = useId();
  const positions = ordered ? new Map(Array.from(picked, (id, i) => [id, i + 1])) : undefined;
  return <fieldset>
    <legend>{label}</legend>
    <ul className="batch-sources">
      {sources.map(({ id, name, original_path: path, row_count: rows, columns }) => <li key={id ?? "primary"}>
        <label className="source-option">
          <span className="source-option-name" title={name}>
            <input type={single ? "radio" : "checkbox"} name={single ? group : undefined} aria-label={name} checked={picked.has(id)} disabled={disabled} onChange={(event) => {
              const next = single ? new Set<SourceId>() : new Set(picked);
              if (event.target.checked) next.add(id);
              else next.delete(id);
              onChange(next);
            }} />
            <span>{positions?.has(id) ? `${positions.get(id)}. ${name}` : name}</span>
          </span>
          {path ? <SourcePath path={path} /> : <span className="source-option-path">—</span>}
          <span className="source-option-size">{rows === undefined ? "—" : `${rows}×${columns.length}`}</span>
        </label>
      </li>)}
    </ul>
  </fieldset>;
}
