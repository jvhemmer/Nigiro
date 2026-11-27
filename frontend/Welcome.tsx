import { FilePlus, FolderOpen } from "lucide-react";
import appLogo from "../proposed-logos/data-matrix.svg";
import type { SavedPath } from "./workspace";

export function Welcome({ recent, busy, onNew, onOpen, onRecent }: {
  recent: SavedPath[];
  busy: boolean;
  onNew: () => void;
  onOpen: () => void;
  onRecent: (path: string) => void;
}) {
  return <main className="welcome">
    <div className="welcome-card">
      <h1><img src={appLogo} alt="" /> Nigiro</h1>
      <div className="welcome-actions">
        <button type="button" disabled={busy} onClick={onNew}><FilePlus size={16} aria-hidden="true" /> New project…</button>
        <button type="button" disabled={busy} onClick={onOpen}><FolderOpen size={16} aria-hidden="true" /> Open project…</button>
      </div>
      <section className="welcome-recent" aria-labelledby="recent-projects-heading">
        <h2 id="recent-projects-heading">Recent projects</h2>
        {recent.length ? <ul>
          {recent.map(({ name, path }) => <li key={path}>
            <button type="button" disabled={busy} title={path} onClick={() => onRecent(path)}>
              <span>{name}</span><small>{path}</small>
            </button>
          </li>)}
        </ul> : <p>No recent projects.</p>}
      </section>
    </div>
  </main>;
}
