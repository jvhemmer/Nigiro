export type PythonRuntime =
  | { mode: "bundled" }
  | { mode: "existing"; executable: string }
  | { mode: "uv"; version: string; executable: string | null };

export interface DesktopPreferences {
  check_updates: boolean;
  python: PythonRuntime;
}

export interface DesktopInfo {
  version: string;
  preferences: DesktopPreferences;
  active_python: PythonRuntime | null;
  python_fallback: string | null;
  updates_unavailable: string | null;
}

export interface Release {
  version: string;
  notes: string | null;
}

export const defaultDesktopPreferences: DesktopPreferences = { check_updates: true, python: { mode: "bundled" } };

export interface UpdateControls {
  release: Release | null;
  checking: boolean;
  installing: boolean;
  checked: boolean;
  error: string;
  check: () => void;
  install: () => void;
}

export function UpdateSettings({ info, draft, onChange, update }: {
  info: DesktopInfo | null;
  draft: DesktopPreferences;
  onChange: (draft: DesktopPreferences) => void;
  update: UpdateControls;
}) {
  const reason = info?.updates_unavailable;
  return <div className="desktop-settings-fields">
    <label className="desktop-checkbox"><input type="checkbox" disabled={!info || !!reason}
      checked={draft.check_updates} onChange={(event) => onChange({ ...draft, check_updates: event.target.checked })} />
      <span>Check for updates at startup</span></label>
    <p className="muted">Nigiro checks GitHub Releases and verifies the signature before installing.</p>
    {reason && <p className="muted">{reason}</p>}
    <div className="desktop-settings-actions">
      <button type="button" disabled={!info || !!reason || update.checking || update.installing} onClick={update.check}>
        {update.checking ? "Checking…" : "Check now"}
      </button>
      {update.release && <button type="button" className="primary" disabled={update.checking || update.installing} onClick={update.install}>
        {update.installing ? "Installing…" : "Update and restart"}
      </button>}
    </div>
    {update.error && <p role="alert" className="figure-settings-error">{update.error}</p>}
    {update.release ? <>
      <p><strong>Version {update.release.version} is available.</strong></p>
      {update.release.notes && <div className="update-notes">{update.release.notes}</div>}
    </> : update.checked && !update.error && <p role="status">Nigiro is up to date.</p>}
  </div>;
}

export function PythonSettings({ info, draft, onChange, version }: {
  info: DesktopInfo | null;
  draft: DesktopPreferences;
  onChange: (draft: DesktopPreferences) => void;
  version: string;
}) {
  const runtime = draft.python;
  const active = info?.active_python?.mode === "existing" ? "Existing Python"
    : info?.active_python?.mode === "uv" ? "Managed by uv" : "Bundled";
  const pending = info?.active_python && JSON.stringify(info.active_python) !== JSON.stringify(info.preferences.python);
  function select(mode: PythonRuntime["mode"]) {
    const saved = info?.preferences.python;
    const python: PythonRuntime = saved?.mode === mode ? saved
      : mode === "existing" ? { mode, executable: "" }
      : mode === "uv" ? { mode, version: "3.12", executable: null }
      : { mode };
    onChange({ ...draft, python });
  }
  return <div className="desktop-settings-fields">
    <p>Active runtime: <strong>{active} · Python {version}</strong></p>
    {info?.python_fallback && <p role="alert" className="figure-settings-error">Nigiro started its bundled engine. {info.python_fallback}</p>}
    {pending && !info?.python_fallback && <p role="status">Restart Nigiro to use the saved runtime.</p>}
    <label>Python runtime
      <select value={runtime.mode} onChange={(event) => select(event.target.value as PythonRuntime["mode"])}>
        <option value="bundled">Bundled engine</option>
        <option value="existing">Existing Python installation</option>
        <option value="uv">Python managed by uv</option>
      </select>
    </label>
    {runtime.mode === "bundled" && <p className="muted">Includes Python and the packages Nigiro needs. Works offline.</p>}
    {runtime.mode === "existing" && <>
      <label>Python executable path
        <input value={runtime.executable} spellCheck={false}
          onChange={(event) => onChange({ ...draft, python: { ...runtime, executable: event.target.value } })} />
      </label>
      <p className="muted">Choose a Python 3.10 or newer virtual environment with Nigiro’s runtime dependencies installed.</p>
    </>}
    {runtime.mode === "uv" && <>
      <label>Python version
        <input value={runtime.version} placeholder="3.12" spellCheck={false}
          onChange={(event) => onChange({ ...draft, python: { ...runtime, version: event.target.value } })} />
      </label>
      <label>uv executable path (optional)
        <input value={runtime.executable ?? ""} placeholder="Find uv automatically" spellCheck={false}
          onChange={(event) => onChange({ ...draft, python: { ...runtime, executable: event.target.value || null } })} />
      </label>
      <p className="muted">Nigiro uses an installed uv to get the selected Python version and install the locked packages in an isolated environment.</p>
    </>}
    {runtime.mode !== "bundled" && <p className="muted">Saving tests the runtime and may download packages. Changes take effect after a restart.</p>}
  </div>;
}
