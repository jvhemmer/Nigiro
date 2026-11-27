import { useEffect, useId, useRef, useState } from "react";
import { SettingsGroup, SettingsHelp } from "./SettingsGroup";
import type { ProjectStorage } from "./workspace";

export const defaultProjectStorage: ProjectStorage = {
  embed_files: false, embed_calculated_sources: false, embed_figures: false,
};

const storageLabels = {
  embed_files: "Embed files in the project file",
  embed_calculated_sources: "Embed calculated sources in the project file",
  embed_figures: "Embed figures in the project file",
} satisfies Record<keyof ProjectStorage, string>;

export function ProjectStorageSettings({ value, global, onChange }: {
  value: ProjectStorage;
  global?: ProjectStorage;
  onChange: (key: keyof ProjectStorage, checked: boolean) => void;
}) {
  return <SettingsGroup title="Project storage"
    help="With calculated sources and figures off, select Run all after you open a project to restore its results.">
    {(Object.keys(storageLabels) as (keyof ProjectStorage)[]).map((key) => <div className="project-storage-option" key={key}>
      <label className="figure-field figure-checkbox">
        <input type="checkbox" checked={value[key]} onChange={(event) => onChange(key, event.target.checked)} />
        <span>{storageLabels[key]}</span>
      </label>
      {global && value[key] !== global[key] && <SettingsHelp label={`${storageLabels[key]} override`} warning>
        This setting differs from the global setting. Nigiro uses the project value when you save.
      </SettingsHelp>}
    </div>)}
  </SettingsGroup>;
}

export function ProjectProperties({ global, initial, busy, error, onClose, onSave }: {
  global: ProjectStorage;
  initial: Partial<ProjectStorage>;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (overrides: Partial<ProjectStorage>) => Promise<boolean>;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [overrides, setOverrides] = useState(initial);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className="settings-dialog project-properties" aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!busy && await onSave(overrides)) onClose();
    }}>
      <h2 id={id}>Project properties</h2>
      <p className="project-storage-warning" role="note">Project settings override global settings for this project.</p>
      <ProjectStorageSettings value={{ ...global, ...overrides }} global={global} onChange={(key, checked) => {
        const updated = { ...overrides, [key]: checked };
        if (checked === global[key]) delete updated[key];
        setOverrides(updated);
      }} />
      {error && <p className="error-banner" role="alert">{error}</p>}
      <footer>
        <button type="button" className="project-storage-reset" disabled={busy || !Object.keys(overrides).length}
          onClick={() => setOverrides({})}>Use global settings</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={busy}>Apply</button>
      </footer>
    </form>
  </dialog>;
}
