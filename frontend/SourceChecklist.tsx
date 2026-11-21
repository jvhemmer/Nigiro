import type { ProjectSource } from "./workspace";

export type SourceId = ProjectSource["id"];
export type SourceChoice = Pick<ProjectSource, "id" | "name" | "columns">;

export function SourceChecklist({ sources, picked, disabled, onChange }: {
  sources: SourceChoice[];
  picked: ReadonlySet<SourceId>;
  disabled: boolean;
  onChange: (picked: Set<SourceId>) => void;
}) {
  return <fieldset>
    <legend>Sources</legend>
    <ul className="batch-sources">
      {sources.map(({ id, name }) => <li key={id ?? "primary"}>
        <label>
          <input type="checkbox" checked={picked.has(id)} disabled={disabled} onChange={(event) => {
            const next = new Set(picked);
            if (event.target.checked) next.add(id);
            else next.delete(id);
            onChange(next);
          }} />
          <span>{name}</span>
        </label>
      </li>)}
    </ul>
  </fieldset>;
}
