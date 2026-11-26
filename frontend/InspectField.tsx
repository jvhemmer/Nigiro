import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useId, type ReactNode } from "react";

export function InspectField({ label, children, revert, disabled, title }: {
  label: string;
  children: (id: string) => ReactNode;
  revert?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const id = useId();
  const revertLabel = `Revert ${label.toLowerCase()}`;
  return <div className="inspect-field" title={title}>
    <label htmlFor={id}>{label}</label>
    {children(id)}
    {revert && <button className="inspect-revert" type="button" disabled={disabled} onClick={revert}
      title={revertLabel} aria-label={revertLabel}><RotateCcw size={10} /></button>}
  </div>;
}

export function InspectNumber({ id, value, onChange, min, max, increment, disabled }: {
  id: string;
  value: number | string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  increment: number;
  disabled?: boolean;
}) {
  const step = (direction: number) => {
    const current = Number(value);
    const next = Number((current + direction * increment).toFixed(8));
    onChange(String(Math.min(max, Math.max(min, next))));
  };
  return <div className="inspect-number">
    <input id={id} type="number" step="any" value={value} min={min} max={max} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        step(event.key === "ArrowUp" ? 1 : -1);
      }} />
    <div className="inspect-number-step">
      <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled} onClick={() => step(1)}><ChevronUp size={10} /></button>
      <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled} onClick={() => step(-1)}><ChevronDown size={10} /></button>
    </div>
  </div>;
}
