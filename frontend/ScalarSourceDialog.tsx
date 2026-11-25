import { useEffect, useRef, useState } from "react";

export function ScalarSourceDialog({ busy, error, onClose, onAdd }: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onAdd: (name: string, value: number, comment: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState<number>(NaN);
  const [comment, setComment] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="scalar-source-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (name.trim() && Number.isFinite(value) && !busy) void onAdd(name.trim(), value, comment.trim());
    }}>
      <h2 id="scalar-source-title">Add Variable</h2>
      <div className="fit-settings plugin-fields">
        <label><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>Value</span><input required type="number" step="any" value={Number.isNaN(value) ? "" : value}
          onChange={(event) => setValue(event.target.valueAsNumber)} /></label>
        <label><span>Comment (optional)</span><textarea rows={2} value={comment}
          onChange={(event) => setComment(event.target.value)} /></label>
      </div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !name.trim() || !Number.isFinite(value)}>Add variable</button>
      </footer>
    </form>
  </dialog>;
}
