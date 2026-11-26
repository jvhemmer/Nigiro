import { useEffect, useRef, useState } from "react";
import { FormulaEditor } from "./FormulaEditor";
import type { ProjectSource, Request } from "./workspace";

export function ScalarSourceDialog({ sources, busy, error, onClose, onAdd }: {
  sources: ProjectSource[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onAdd: (request: Extract<Request, { action: "add_scalar" }>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const text = value.trim();
  const formula = text.startsWith("=");
  const expression = text.slice(1).trim();
  const canAdd = !busy && !!name.trim() && (formula ? !!expression
    : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)));
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="scalar-source-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (canAdd) void onAdd({ action: "add_scalar", name: name.trim(), comment: comment.trim(),
        ...(formula ? { expression } : { value: Number(text) }) });
    }}>
      <h2 id="scalar-source-title">Add Variable</h2>
      <div className="fit-settings plugin-fields">
        <label><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <FormulaEditor scalar mixed value={value} sources={sources} onChange={setValue} />
        <label><span>Comment (optional)</span><textarea rows={2} value={comment}
          onChange={(event) => setComment(event.target.value)} /></label>
      </div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!canAdd}>Add variable</button>
      </footer>
    </form>
  </dialog>;
}
