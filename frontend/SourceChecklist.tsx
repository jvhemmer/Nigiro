import type { ProjectSource } from "./workspace";

export type SourceId = ProjectSource["id"];
export type SourceChoice = Pick<ProjectSource, "id" | "name" | "columns">
  & Partial<Pick<ProjectSource, "original_path" | "row_count">>;

const pathLimit = 100;

export function SourceChecklist({ sources, picked, disabled, onChange }: {
  sources: SourceChoice[];
  picked: ReadonlySet<SourceId>;
  disabled: boolean;
  onChange: (picked: Set<SourceId>) => void;
}) {
  return <fieldset>
    <legend>Sources</legend>
    <ul className="batch-sources">
      {sources.map(({ id, name, original_path: path, row_count: rows, columns }) => <li key={id ?? "primary"}>
        <label className="source-option">
          <span className="source-option-name" title={name}>
            <input type="checkbox" aria-label={name} checked={picked.has(id)} disabled={disabled} onChange={(event) => {
              const next = new Set(picked);
              if (event.target.checked) next.add(id);
              else next.delete(id);
              onChange(next);
            }} />
            <span>{name}</span>
          </span>
          <span className="source-option-path" title={path ?? undefined}>
            <bdi dir="ltr">{path ? (path.length > pathLimit ? `…${path.slice(1 - pathLimit)}` : path) : "—"}</bdi>
          </span>
          <span className="source-option-size">{rows === undefined ? "—" : `${rows}×${columns.length}`}</span>
        </label>
      </li>)}
    </ul>
  </fieldset>;
}
