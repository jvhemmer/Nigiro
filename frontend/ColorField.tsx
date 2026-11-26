import { createPortal } from "react-dom";
import { useId, useRef, useState, type FormEvent } from "react";

const palette = [
  "#0072b2", "#56b4e9", "#009e73", "#e69f00", "#f0e442", "#d55e00", "#cc79a7",
  "#245e9b", "#34a853", "#b7d968", "#e3a17d", "#bf363b", "#924fa5", "#694f3d",
  "#000000", "#333333", "#666666", "#999999", "#cccccc", "#eeeeee", "#ffffff",
];

export const isHexColor = (color: string) => /^#[\da-f]{6}$/i.test(color);
export const plotlyColor = (color: string) => color === "transparent" ? "rgba(0,0,0,0)" : color;

export function ColorField({ id, label, value, onChange, disabled, opaque = false }: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  opaque?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const valid = isHexColor(draft) || (!opaque && draft === "transparent");
  function select(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!valid) return;
    onChange(draft.toLowerCase());
    dialog.current?.close();
  }

  return <div className="color-field">
    <button id={id} type="button" className="color-field-trigger" aria-label={label} aria-haspopup="dialog" title={value}
      disabled={disabled} onClick={() => {
        setDraft(value);
        dialog.current?.showModal();
      }}>
      <span className="color-sample" data-opaque={value !== "transparent" || undefined} style={{ backgroundColor: value }} />
    </button>
    {createPortal(<dialog ref={dialog} className="settings-dialog color-picker" aria-labelledby={titleId}
      onKeyDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <h2 id={titleId}>{label}</h2>
      <div className="color-palette">
        {palette.map((color) => <button type="button" key={color} className="color-sample" data-opaque
          style={{ backgroundColor: color }} aria-label={color} title={color} aria-pressed={draft.toLowerCase() === color}
          onClick={() => setDraft(color)} />)}
      </div>
      {!opaque && <button type="button" className="color-transparent" aria-pressed={draft === "transparent"}
        onClick={() => setDraft("transparent")}>
        <span className="color-sample" /> Transparent
      </button>}
      <label className="color-hex">Hex color
        <input value={draft === "transparent" ? "" : draft} placeholder="#rrggbb" spellCheck={false}
          onChange={(event) => setDraft(event.target.value.trim())}
          onKeyDown={(event) => { if (event.key === "Enter") select(event); }} />
      </label>
      <footer>
        <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="primary" disabled={!valid} onClick={select}>Select</button>
      </footer>
    </dialog>, document.body)}
  </div>;
}
