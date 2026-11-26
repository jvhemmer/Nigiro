import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceItem } from "./workspace";

export type ItemAction =
  | { mode: "rename" | "delete"; item: WorkspaceItem; name: string }
  | { mode: "new_group" };

export function ItemDialog({ change, onClose, onApply }: {
  change: ItemAction;
  onClose: () => void;
  onApply: (name: string | null) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const originalName = change.mode === "new_group" ? "" : change.name;
  const [draft, setDraft] = useState(originalName);
  const action = change.mode === "new_group" ? "Create" : change.mode === "rename" ? "Rename" : "Delete";
  const title = change.mode === "new_group" ? "New source group" : `${action} ${change.item.kind}`;
  const name = draft.trim();
  const canSubmit = change.mode === "delete" || (name !== "" && name !== originalName);

  useEffect(() => {
    dialog.current?.showModal();
    input.current?.select();
  }, []);

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onApply(change.mode === "delete" ? null : name);
      }}>
        <h2 id={id}>{title}</h2>
        {change.mode !== "delete" ? (
          <div className="fit-settings plugin-fields">
            <label>
              <span>{change.mode === "new_group" ? "Group name" : "Name"}</span>
              <input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus required />
            </label>
          </div>
        ) : (
          <p>Remove <strong>{change.name}</strong> from the workspace? Existing analysis steps will keep their inputs.</p>
        )}
        <footer>
          <button type="button" autoFocus={change.mode === "delete"} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!canSubmit}>{action}</button>
        </footer>
      </form>
    </dialog>
  );
}
