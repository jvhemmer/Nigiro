import { Brackets, ChevronDown, ChevronRight, Pencil, Table2, Trash2, Variable } from "lucide-react";
import { useState, type DragEvent } from "react";
import { useRevealDockPanel } from "./DockWorkspace";
import { SourcePath } from "./SourceChecklist";
import type { Project, ProjectSource, Request } from "./workspace";

export function SourcesPanel({ project, busy, run, onInspect }: {
  project: Project;
  busy: boolean;
  run: (request: Request) => Promise<boolean>;
  onInspect: (id: string | null) => void;
}) {
  const reveal = useRevealDockPanel();
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<{ key: string; edge: "before" | "after" } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const members = project.sources.map((source, index) => ({ source, index }));

  function endDrag() {
    setDrag(null);
    setHover(null);
  }

  function dropTarget(group_id: string | null, boundary: (event: DragEvent<HTMLElement>) => number, key: string, row?: number) {
    return {
      "data-drop-edge": hover?.key === key ? hover.edge : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (busy || drag === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const edge = row !== undefined && boundary(event) > row ? "after" : "before";
        setHover((current) => current?.key === key && current.edge === edge ? current : { key, edge });
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (busy || drag === null) return;
        event.preventDefault();
        const item = project.sources[drag];
        const position = boundary(event);
        const destination = position > drag ? position - 1 : position;
        endDrag();
        if (item.group_id !== group_id || destination !== drag) {
          void run({ action: "move_source", source_id: item.id, destination, placement: { group_id } });
        }
      },
    };
  }

  function sourceRow(source: ProjectSource, index: number) {
    const detail = source.workflow_run ? `Produced by ${source.workflow_run}` : source.detail;
    const name = source.group_name ?? source.name;
    return <li key={source.id ?? "raw"} draggable={!busy}
      {...dropTarget(source.group_id, (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return index + Number(event.clientY >= rect.top + rect.height / 2);
      }, `row:${index}`, index)}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(index));
        event.dataTransfer.effectAllowed = "move";
        setDrag(index);
      }} onDragEnd={endDrag}>
      <button type="button" title={[source.name, detail ?? source.original_path].filter(Boolean).join("\n")}
        aria-current={source.id === project.source_id} disabled={busy} data-item-kind="source" data-item-id={source.id ?? ""}
        onClick={async () => {
          onInspect(source.id);
          if (source.id !== project.source_id) await run({ action: "select_source", source_id: source.id });
          reveal("worksheet");
        }}>
        {source.array_step !== undefined ? <Brackets size={13} aria-hidden="true" />
          : source.scalar ? <Variable size={13} aria-hidden="true" /> : <Table2 size={13} aria-hidden="true" />}
        <span className="source-list-name">{name}</span>
        {detail ? <span className="source-list-detail">{detail}</span>
          : source.original_path && <SourcePath path={source.original_path} />}
      </button>
    </li>;
  }

  return <section className="source-tree">
    {edit && <form className="source-group-form" onSubmit={async (event) => {
      event.preventDefault();
      if (edit.name.trim() && await run({ action: "source_group", mode: "rename",
        group_id: edit.id, name: edit.name })) setEdit(null);
    }}>
      <input aria-label="Group name" placeholder="Group name" required autoFocus value={edit.name} disabled={busy}
        onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
      <button type="submit" disabled={busy || !edit.name.trim()}>Save</button>
      <button type="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
    </form>}
    <ul className="source-list" aria-label="Project sources">
      {members.filter(({ source }) => source.group_id == null).map(({ source, index }) => sourceRow(source, index))}
      {(project.source_groups ?? []).map((group) => {
        const children = members.filter(({ source }) => source.group_id === group.id);
        return <li key={group.id}>
          <div className="source-group-row"
            {...dropTarget(group.id, () => (children.at(-1)?.index ?? project.sources.length - 1) + 1, group.id)}>
            <button type="button" className="source-group-title" aria-expanded={!group.collapsed} disabled={busy}
              onClick={() => void run({ action: "source_group", mode: "toggle", group_id: group.id })}>
              {group.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              <span>{group.name}</span> <small>{children.length}</small>
            </button>
            <button type="button" title="Rename group" aria-label={`Rename group ${group.name}`} disabled={busy}
              onClick={() => setEdit({ id: group.id, name: group.name })}><Pencil size={12} aria-hidden="true" /></button>
            <button type="button" title="Delete group and keep its sources" aria-label={`Delete group ${group.name}`} disabled={busy}
              onClick={() => void run({ action: "source_group", mode: "delete", group_id: group.id })}><Trash2 size={12} aria-hidden="true" /></button>
          </div>
          {!group.collapsed && <ul className="source-group-children" aria-label={group.name}>
            {children.map(({ source, index }) => sourceRow(source, index))}
          </ul>}
        </li>;
      })}
      {!project.sources.length && !project.source_groups?.length && <li className="muted">No sources in this project.</li>}
    </ul>
    {drag !== null && <div className="source-root-drop" {...dropTarget(null, () => project.sources.length, "root")}>
      Drop outside groups
    </div>}
  </section>;
}
