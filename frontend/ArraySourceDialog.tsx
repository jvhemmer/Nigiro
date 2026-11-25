import { useEffect, useRef, useState } from "react";
import { FormulaEditor } from "./FormulaEditor";
import type { ProjectSource, Request } from "./workspace";

export function ArraySourceDialog({ sources, busy, error, onClose, onAdd }: {
  sources: ProjectSource[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onAdd: (request: Extract<Request, { action: "add_array" }>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [comment, setComment] = useState("");
  const text = input.trim();
  const formula = text.startsWith("=");
  const expression = text.slice(1).trim();
  const canAdd = !busy && !!name.trim() && !!(formula ? expression : text);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="array-source-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (canAdd) void onAdd({
        action: "add_array", name: name.trim(), comment: comment.trim(), ...(formula ? { expression } : { values: text }),
      });
    }}>
      <h2 id="array-source-title">Add Array</h2>
      <div className="fit-settings plugin-fields">
        <label><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <FormulaEditor array mixed value={input} sources={sources} onChange={setInput} />
        <label><span>Comment (optional)</span><textarea rows={2} value={comment}
          onChange={(event) => setComment(event.target.value)} /></label>
      </div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!canAdd}>Add array</button>
      </footer>
    </form>
  </dialog>;
}
