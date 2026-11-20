import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AxisKey, AxisStyle, FigureStyle, StyleSection } from "./figureStyle";

const sectionNames: Record<StyleSection, string> = {
  figure: "Figure", x: "X axis", y: "Y axis", residual: "Residual Y axis",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="figure-field"><span>{label}</span>{children}</label>;
}

function NumberField({ label, value, onChange, placeholder }: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  return <Field label={label}>
    <input type="number" step="any" value={value !== null && Number.isFinite(value) ? value : ""}
      placeholder={placeholder} onChange={(event) => onChange(event.target.valueAsNumber)} />
  </Field>;
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return <Field label={label}>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  </Field>;
}

function AxisFields({ style, fallback, categorical, onChange }: {
  style: AxisStyle;
  fallback: string;
  categorical: boolean;
  onChange: (style: AxisStyle) => void;
}) {
  function set<K extends keyof AxisStyle>(key: K, value: AxisStyle[K]) {
    onChange({ ...style, [key]: value });
  }

  return <>
    <div className="figure-fields">
      <Field label="Axis label">
        <input value={style.label ?? fallback} onChange={(event) => set("label", event.target.value)} />
      </Field>
      {!categorical && <Choice label="Scale" value={style.scale} onChange={(value) => set("scale", value)}
        options={[["linear", "Linear"], ["log", "Logarithmic"]]} />}
      <NumberField label="Lower limit" placeholder="Auto" value={style.lower}
        onChange={(value) => set("lower", Number.isNaN(value) ? null : value)} />
      <NumberField label="Upper limit" placeholder="Auto" value={style.upper}
        onChange={(value) => set("upper", Number.isNaN(value) ? null : value)} />
      {!categorical && <>
        <NumberField label={style.scale === "log" ? "Tick interval (decades)" : "Tick interval"}
          placeholder="Auto" value={style.step} onChange={(value) => set("step", Number.isNaN(value) ? null : value)} />
        <Field label="Tick number format">
          <input value={style.format} placeholder="Auto or .2f" onChange={(event) => set("format", event.target.value)} />
        </Field>
      </>}
      <Choice label="Tick direction" value={style.ticks} onChange={(value) => set("ticks", value)}
        options={[["outside", "Outward"], ["inside", "Inward"], ["none", "Hidden"]]} />
      <NumberField label="Tick length (px)" value={style.tick_length} onChange={(value) => set("tick_length", value)} />
      <NumberField label="Tick label angle (°)" value={style.angle} onChange={(value) => set("angle", value)} />
      <NumberField label="Axis line width (px)" value={style.line_width} onChange={(value) => set("line_width", value)} />
    </div>
    {categorical && <p className="muted">Bar positions start at 0.</p>}
    <div className="figure-toggles">
      {([
        ["line", "Axis line"], ["tick_labels", "Tick labels"], ["minor_ticks", "Minor ticks"],
        ["mirror", "Mirror axis and ticks"], ["grid", "Grid lines"], ["zero_line", "Zero line"],
        ["hover_ruler", "Hover ruler"],
      ] as const).filter(([key]) => !categorical || key !== "minor_ticks").map(([key, label]) => (
        <label key={key}>
          <input type="checkbox" checked={style[key]} onChange={(event) => set(key, event.target.checked)} />
          {label}
        </label>
      ))}
    </div>
  </>;
}

function FigureFields({ style, bar, markers, line, onChange }: {
  style: FigureStyle;
  bar: boolean;
  markers: boolean;
  line: boolean;
  onChange: (style: FigureStyle) => void;
}) {
  function set<K extends keyof FigureStyle>(key: K, value: FigureStyle[K]) {
    onChange({ ...style, [key]: value });
  }

  return <div className="figure-fields">
    <Field label="Figure title"><input value={style.title} onChange={(event) => set("title", event.target.value)} /></Field>
    <Field label="Font family"><input value={style.font_family}
      onChange={(event) => set("font_family", event.target.value)} /></Field>
    <NumberField label="Axis label size (px)" value={style.label_size} onChange={(value) => set("label_size", value)} />
    <NumberField label="Tick and legend size (px)" value={style.tick_size} onChange={(value) => set("tick_size", value)} />
    <Field label="Text and axis color"><input type="color" value={style.text_color}
      onChange={(event) => set("text_color", event.target.value)} /></Field>
    <Field label="Background"><input type="color" value={style.background}
      onChange={(event) => set("background", event.target.value)} /></Field>
    <Choice label="Legend" value={style.legend} onChange={(value) => set("legend", value)}
      options={[
        ["auto", "Automatic"], ["none", "Hidden"], ["above", "Above plot"],
        ["top_left", "Top left"], ["top_right", "Top right"],
        ["bottom_left", "Bottom left"], ["bottom_right", "Bottom right"],
      ]} />
    {bar && <NumberField label="Bar width (fraction)" value={style.bar_width} onChange={(value) => set("bar_width", value)} />}
    {markers && <>
          <NumberField label="Marker size (px)" value={style.marker_size} onChange={(value) => set("marker_size", value)} />
          <Choice label="Marker shape" value={style.marker_symbol} onChange={(value) => set("marker_symbol", value)}
            options={[
              ["circle", "Circle"], ["square", "Square"], ["diamond", "Diamond"],
              ["triangle-up", "Triangle"], ["cross", "Cross"],
            ]} />
        </>}
    {line && <>
      <NumberField label="Trace line width (px)" value={style.line_width} onChange={(value) => set("line_width", value)} />
      <Choice label="Trace line style" value={style.line_dash} onChange={(value) => set("line_dash", value)}
        options={[["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"], ["dashdot", "Dash-dot"]]} />
    </>}
  </div>;
}

function axisError(style: AxisStyle) {
  const { lower, upper, scale, step } = style;
  if (scale === "log" && [lower, upper].some((value) => value !== null && value <= 0)) return "Enter positive logarithmic limits.";
  if (lower !== null && upper !== null && lower >= upper) return "Enter an upper limit greater than the lower limit.";
  if (step !== null && step <= 0) return "Enter a positive tick interval.";
  if (!(style.line_width >= 0.1 && style.line_width <= 12)) return "Enter an axis line width from 0.1 to 12 px.";
  if (!(style.tick_length >= 0 && style.tick_length <= 30)) return "Enter a tick length from 0 to 30 px.";
  if (!(style.angle >= -180 && style.angle <= 180)) return "Enter a tick label angle from −180° to 180°.";
  return "";
}

function figureError(style: FigureStyle) {
  if (!/^[\p{L}\p{N}_ .'-]+$/u.test(style.font_family.trim())) return "Enter one font family name.";
  if (![style.label_size, style.tick_size].every((size) => size >= 6 && size <= 48)) return "Enter font sizes from 6 to 48 px.";
  if (!(style.line_width >= 0.1 && style.line_width <= 12)) return "Enter a trace line width from 0.1 to 12 px.";
  if (!(style.marker_size >= 1 && style.marker_size <= 30)) return "Enter a marker size from 1 to 30 px.";
  if (!(style.bar_width >= 0.05 && style.bar_width <= 1)) return "Enter a bar width from 0.05 to 1.";
  return "";
}

export function FigureSettings({ initial, defaults, initialSection, labels, fit, categoricalX, bar, markers, line, onClose, onApply }: {
  initial: FigureStyle;
  defaults: FigureStyle;
  initialSection: StyleSection;
  labels: Record<AxisKey, string>;
  fit: boolean;
  categoricalX: boolean;
  bar: boolean;
  markers: boolean;
  line: boolean;
  onClose: () => void;
  onApply: (style: FigureStyle) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [style, setStyle] = useState(initial);
  const [section, setSection] = useState(initialSection);
  const [error, setError] = useState("");
  const axes: AxisKey[] = fit ? ["x", "y", "residual"] : ["x", "y"];

  useEffect(() => { dialog.current?.showModal(); }, []);

  function apply() {
    for (const item of ["figure", ...axes] as const) {
      const message = item === "figure" ? figureError(style) : axisError(style[item]);
      if (message) {
        setSection(item);
        setError(message);
        return;
      }
    }
    onApply({ ...style, font_family: style.font_family.trim() });
  }

  function resetSection() {
    setError("");
    setStyle(section === "figure"
      ? { ...defaults, x: style.x, y: style.y, residual: style.residual }
      : { ...style, [section]: defaults[section] });
  }

  return <dialog ref={dialog} className="settings-dialog figure-settings" aria-labelledby="figure-settings-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <h2 id="figure-settings-title">Figure settings</h2>
      <div className="figure-settings-nav" role="group" aria-label="Settings section">
        {(["figure", ...axes] as const).map((item) => (
          <button key={item} type="button" aria-pressed={section === item}
            onClick={() => { setSection(item); setError(""); }}>
            {sectionNames[item]}
          </button>
        ))}
      </div>
      {section === "figure" ? <FigureFields style={style} bar={bar} markers={markers} line={line} onChange={setStyle} />
        : <AxisFields style={style[section]} fallback={labels[section]} categorical={categoricalX && section === "x"}
            onChange={(value) => setStyle({ ...style, [section]: value })} />}
      {error && <p className="figure-settings-error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="figure-reset" onClick={resetSection}>Reset section</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary">Apply</button>
      </footer>
    </form>
  </dialog>;
}
