import { useEffect, useId, useRef, useState } from "react";
import type { Project } from "./workspace";

export function OverlayDialog({ figures, active, busy, error, onClose, onCreate }: {
  figures: Project["figures"];
  active: number | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (ids: number[]) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [axes, setAxes] = useState(() => figures.find((figure) => figure.id === active)?.id ?? figures[0].id);
  const [selected, setSelected] = useState(() => [axes]);
  const inputs = [axes, ...figures.filter((figure) => figure.id !== axes && selected.includes(figure.id)).map((figure) => figure.id)];

  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!busy && inputs.length > 1) onCreate(inputs);
      }}>
        <h2 id={id}>Overlay Figures</h2>
        <fieldset className="overlay-figures" disabled={busy}>
          <legend>Figures</legend>
          {figures.map((figure) => (
            <label key={figure.id}>
              <input type="checkbox" checked={selected.includes(figure.id)} disabled={figure.id === axes}
                onChange={(event) => setSelected(event.target.checked
                  ? [...selected, figure.id] : selected.filter((input) => input !== figure.id))} />
              <span>{figure.name}</span>
            </label>
          ))}
        </fieldset>
        <div className="fit-settings plugin-fields">
          <label>
            <span>Use axes from</span>
            <select value={axes} disabled={busy} onChange={(event) => setAxes(Number(event.target.value))}>
              {figures.filter((figure) => selected.includes(figure.id)).map((figure) => (
                <option key={figure.id} value={figure.id}>{figure.name}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy || inputs.length < 2}>Create overlay</button>
        </footer>
      </form>
    </dialog>
  );
}
