import { useEffect, useRef, useState } from "react";
import type { ExportSettings, ExportTarget } from "./exportFigure";

export function ExportDialog({ target, initial, onClose, onExport }: {
  target: ExportTarget;
  initial: ExportSettings;
  onClose: () => void;
  onExport: (settings: ExportSettings) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(initial);

  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="export-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); onExport(settings); }}>
        <h2 id="export-title">{target === "script" ? "Export Python script" : "Export figure"}</h2>
        <div className="fit-settings">
          <label>
            <span>Figure format</span>
            <select value={settings.format} onChange={(event) => {
              const format = event.target.value === "pdf" ? "pdf" : "png";
              setSettings({ ...settings, format });
            }}>
              <option value="pdf">PDF (vector)</option>
              <option value="png">PNG</option>
            </select>
          </label>
          {settings.format === "png" && (
            <label>
              <span>PNG resolution</span>
              <select value={settings.scale} onChange={(event) => {
                setSettings({ ...settings, scale: Number(event.target.value) });
              }}>
                {[1, 2, 3, 4].map((scale) => <option key={scale} value={scale}>{scale}×</option>)}
              </select>
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Export</button>
        </footer>
      </form>
    </dialog>
  );
}
