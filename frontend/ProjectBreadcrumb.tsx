import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, FileSpreadsheet, FolderOpen } from "lucide-react";
import type { MenuCommand, MenuRequest } from "./MenuBar";
import type { Project } from "./workspace";

export function ProjectBreadcrumb({ project, projectName, projectDirty, busy, openWorkspace, newWorkspace, onRun }: {
  project: Project;
  projectName: string;
  projectDirty: boolean;
  busy: boolean;
  openWorkspace: MenuCommand;
  newWorkspace: MenuCommand;
  onRun: (request: MenuRequest) => void;
}) {
  const [open, setOpen] = useState<"workspace" | "project" | null>(null);
  const root = useRef<HTMLElement>(null);
  const workspaceButton = useRef<HTMLButtonElement>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const collection = project.workspace;
  const otherProjects = collection?.projects.filter(({ path }) => path !== collection.active_project) ?? [];
  const active = busy ? null : open;

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  function run(request: MenuRequest | null) {
    setOpen(null);
    if (request && !busy) onRun(request);
  }

  return (
    <nav ref={root} className="project-breadcrumb" aria-label="Workspace and project"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !active) return;
        event.preventDefault();
        event.stopPropagation();
        (active === "workspace" ? workspaceButton : projectButton).current?.focus();
        setOpen(null);
      }}>
      <div className="breadcrumb-segment">
        <button type="button" className="breadcrumb-trigger workspace-crumb" ref={workspaceButton}
          disabled={busy} aria-expanded={active === "workspace"} aria-controls={active === "workspace" ? `${id}-workspace` : undefined}
          title={collection?.path ?? "Workspaces"} onClick={() => setOpen(active === "workspace" ? null : "workspace")}>
          <FolderOpen size={14} aria-hidden="true" />
          <span>{collection?.name ?? "Workspace"}</span>
          {collection?.dirty && <span className="dirty" aria-label="Unsaved workspace changes" title="Unsaved workspace changes" />}
        </button>
        {active === "workspace" && <div className="breadcrumb-popup" id={`${id}-workspace`}>
          {!!project.recent_workspaces?.length && <>
            <p>Recent workspaces</p>
            {project.recent_workspaces.map(({ path, name }) => (
              <button type="button" key={path} title={path} disabled={path === collection?.path}
                onClick={() => run({ action: "open_recent_workspace", path })}>
                <FolderOpen size={14} aria-hidden="true" /><span>{name}</span>
              </button>
            ))}
            <div className="menu-separator" />
          </>}
          {[openWorkspace, newWorkspace].map((command) => <button type="button" key={command.label}
            onClick={() => run(command.request)}>
            {command.icon && <command.icon size={14} aria-hidden="true" />}<span>{command.label}</span>
          </button>)}
        </div>}
      </div>
      <ChevronRight size={13} aria-hidden="true" />
      <div className="breadcrumb-segment">
        <button type="button" className="breadcrumb-trigger project-crumb" ref={projectButton}
          disabled={busy} aria-expanded={active === "project"} aria-controls={active === "project" ? `${id}-project` : undefined}
          title={collection?.active_project ?? project.file_name ?? "Untitled project"} onClick={() => setOpen(active === "project" ? null : "project")}>
          <FileSpreadsheet size={14} aria-hidden="true" /><span>{projectName}</span>
          {projectDirty && <span className="dirty" aria-label="Unsaved project changes" title="Unsaved project changes" />}
        </button>
        {active === "project" && <div className="breadcrumb-popup" id={`${id}-project`}>
          {otherProjects.length ? otherProjects.map(({ path, name }) => (
            <button type="button" key={path} title={path} onClick={() => run({ action: "switch_workspace_project", path })}>
              <FileSpreadsheet size={14} aria-hidden="true" /><span>{name}</span>
            </button>
          )) : <p>{collection ? "No other projects in this workspace." : "Open a workspace to switch projects."}</p>}
        </div>}
      </div>
    </nav>
  );
}
