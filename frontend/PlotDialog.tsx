import { useEffect, useRef, useState } from "react";
import { plotNames, type PlotKind } from "./workspace";

export function PlotDialog({ kind, columns, initialX, initialY, onClose, onPlot }: {
  kind: PlotKind;
  columns: string[];
  initialX: number;
  initialY: number;
  onClose: () => void;
  onPlot: (x: number, y: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);

  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="plot-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (x !== y) onPlot(x, y);
      }}>
        <h2 id="plot-title">{plotNames[kind]} plot</h2>
        <div className="fit-settings">
          {([["X", x, setX], ["Y", y, setY]] as const).map(([axis, value, change]) => (
            <label key={axis}>
              <span>{axis} column</span>
              <select value={value} onChange={(event) => change(Number(event.target.value))}>
                {columns.map((name, index) => (
                  <option key={index} value={index}>{name || `Column ${index + 1}`}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={x === y}>Create plot</button>
        </footer>
      </form>
    </dialog>
  );
}
