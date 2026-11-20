import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceItem } from "./workspace";

export interface ItemAction {
  mode: "rename" | "delete";
  item: WorkspaceItem;
  name: string;
}

export function ItemDialog({ change, onClose, onApply }: {
  change: ItemAction;
  onClose: () => void;
  onApply: (name: string | null) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(change.name);
  const rename = change.mode === "rename";
  const name = draft.trim();
  const canSubmit = !rename || (name !== "" && name !== change.name);

  useEffect(() => {
    dialog.current?.showModal();
    input.current?.select();
  }, []);

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onApply(rename ? name : null);
      }}>
        <h2 id={id}>{rename ? "Rename" : "Delete"} {change.item.kind}</h2>
        {rename ? (
          <div className="fit-settings plugin-fields">
            <label>
              <span>Name</span>
              <input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus required />
            </label>
          </div>
        ) : (
          <p>Remove <strong>{change.name}</strong> from the workspace? Existing analysis steps will keep their inputs.</p>
        )}
        <footer>
          <button type="button" autoFocus={!rename} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!canSubmit}>{rename ? "Rename" : "Delete"}</button>
        </footer>
      </form>
    </dialog>
  );
}
