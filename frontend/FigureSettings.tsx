import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formatMeasurement, parseMeasurement } from "./units";
import { Save, RotateCcw } from "lucide-react";
import type { AxisKey, AxisStyle, FigureStyle, StyleSection } from "./figureStyle";

const sectionNames: Record<StyleSection, string> = {
  figure: "Figure", x: "X axis", y: "Y axis",
};

const fieldKeys: Record<string, string> = {
  "Figure title": "title", "Axes width (px)": "axes_width", "Axes height (px)": "axes_height",
  "Font family": "font_family", "Axis label size (px)": "label_size", "Tick and legend size (px)": "tick_size",
  "Text and axis color": "text_color", "Background": "background", "Legend": "legend",
  "Bar width (fraction)": "bar_width", "Marker size (px)": "marker_size", "Marker shape": "marker_symbol",
  "Trace line width (px)": "line_width", "Trace line style": "line_dash",
  "Axis label": "label", "Scale": "scale", "Lower limit": "lower", "Upper limit": "upper",
  "Tick interval": "step", "Tick interval (decades)": "step", "Tick number format": "format",
  "Tick direction": "ticks", "Tick length (px)": "tick_length", "Tick label angle (°)": "angle",
  "Axis line width (px)": "line_width", "Axis line": "line", "Tick labels": "tick_labels",
  "Minor ticks": "minor_ticks", "Mirror axis and ticks": "mirror", "Grid lines": "grid",
  "Zero line": "zero_line", "Hover ruler": "hover_ruler",
};
const MeasurementControls = createContext<{
  units: Record<string, string>;
  setUnit: (key: string, unit: string) => void;
  setInvalid: (key: string, invalid: boolean) => void;
}>({ units: {}, setUnit: () => {}, setInvalid: () => {} });

for (const [label, key] of Object.entries(fieldKeys)) {
  fieldKeys[label.replace(/ \(px\)| \(°\)/g, "")] = key;
}
const GlobalControls = createContext<{
  busy: boolean;
  save: (key: string) => void;
  reset: (key: string) => void;
} | null>(null);

function Field({ label, children }: { label: string; children: ReactNode }) {
  const controls = useContext(GlobalControls);
  const key = fieldKeys[label];
  return <div className="figure-field-row">
    <label className="figure-field"><span>{label}</span>{children}</label>
    {controls && key && <div className="global-field-actions">
      <button type="button" disabled={controls.busy} title={`Save ${label.toLowerCase()} as global`}
        aria-label={`Save ${label.toLowerCase()} as global`} onClick={() => controls.save(key)}><Save size={10} /></button>
      <button type="button" disabled={controls.busy} title={`Revert ${label.toLowerCase()} to global`}
        aria-label={`Revert ${label.toLowerCase()} to global`} onClick={() => controls.reset(key)}><RotateCcw size={10} /></button>
    </div>}
  </div>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="settings-category"><legend>{title}</legend>
    <div className="figure-fields">{children}</div>
  </fieldset>;
}

function NumberField({ label, value, onChange, placeholder }: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  const measurement = useContext(MeasurementControls);
  const key = fieldKeys[label];
  const angle = key === "angle";
  const hasUnits = label.endsWith("(px)") || angle;
  const unit = measurement.units[key] ?? (angle ? "deg" : "px");
  const [text, setText] = useState(() => formatMeasurement(value, unit, angle));
  const editing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) {
      setText(formatMeasurement(value, unit, angle));
      input.current?.setCustomValidity("");
    }
  }, [value, unit, angle, measurement.units]);
  return <Field label={label.replace(/ \(px\)| \(°\)/g, "")}>
    {hasUnits ? <input ref={input} type="text" inputMode="text" value={text} placeholder={placeholder ?? (angle ? "deg" : "px")}
      title={angle ? "Units: deg, rad, turn, °" : "Units: px, pt, cm, mm, in, pc, q. Bare numbers use px."}
      onFocus={() => { editing.current = true; }}
      onBlur={(event) => {
        editing.current = false;
        if (event.currentTarget.validity.valid) setText(formatMeasurement(value, unit, angle));
      }}
      onChange={(event) => {
        const text = event.target.value;
        const parsed = parseMeasurement(text, angle);
        const empty = text.trim() === "" && placeholder === "Auto";
        event.target.setCustomValidity(parsed.valid || empty ? "" : "Enter a number with a supported unit.");
        setText(text);
        measurement.setInvalid(key, !parsed.valid && !empty);
        onChange(parsed.valid ? parsed.value : NaN);
        if (parsed.valid) measurement.setUnit(key, parsed.unit);
      }} /> : <input type="number" step="any" value={value !== null && Number.isFinite(value) ? value : ""}
      placeholder={placeholder} onChange={(event) => onChange(event.target.valueAsNumber)} />}
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
    <SettingsGroup title="Label and range">
      <Field label="Axis label">
        <input value={style.label ?? fallback} onChange={(event) => set("label", event.target.value)} />
      </Field>
      {!categorical && <Choice label="Scale" value={style.scale} onChange={(value) => set("scale", value)}
        options={[["linear", "Linear"], ["log", "Logarithmic"]]} />}
      <NumberField label="Lower limit" placeholder="Auto" value={style.lower}
        onChange={(value) => set("lower", Number.isNaN(value) ? null : value)} />
      <NumberField label="Upper limit" placeholder="Auto" value={style.upper}
        onChange={(value) => set("upper", Number.isNaN(value) ? null : value)} />
    </SettingsGroup>
    <SettingsGroup title="Ticks">
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
    </SettingsGroup>
    <SettingsGroup title="Axis appearance">
      <NumberField label="Axis line width (px)" value={style.line_width} onChange={(value) => set("line_width", value)} />
    </SettingsGroup>
    {categorical && <p className="muted">Bar positions start at 0.</p>}
    <fieldset className="settings-category"><legend>Display</legend>
    <div className="figure-toggles">
      {([
        ["line", "Axis line"], ["tick_labels", "Tick labels"], ["minor_ticks", "Minor ticks"],
        ["mirror", "Mirror axis and ticks"], ["grid", "Grid lines"], ["zero_line", "Zero line"],
        ["hover_ruler", "Hover ruler"],
      ] as const).filter(([key]) => !categorical || key !== "minor_ticks").map(([key, label]) => (
        <Field key={key} label={label}>
          <input type="checkbox" checked={style[key]} onChange={(event) => set(key, event.target.checked)} />
        </Field>
      ))}
    </div>
    </fieldset>
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

  return <>
    <SettingsGroup title="Layout">
    <Field label="Figure title"><input value={style.title} onChange={(event) => set("title", event.target.value)} /></Field>
    <NumberField label="Axes width (px)" placeholder="Auto" value={style.axes_width}
      onChange={(value) => set("axes_width", Number.isNaN(value) ? null : value)} />
    <NumberField label="Axes height (px)" placeholder="Auto" value={style.axes_height}
      onChange={(value) => set("axes_height", Number.isNaN(value) ? null : value)} />
    </SettingsGroup>
    <SettingsGroup title="Typography">
    <Field label="Font family"><input value={style.font_family}
      onChange={(event) => set("font_family", event.target.value)} /></Field>
    <NumberField label="Axis label size (px)" value={style.label_size} onChange={(value) => set("label_size", value)} />
    <NumberField label="Tick and legend size (px)" value={style.tick_size} onChange={(value) => set("tick_size", value)} />
    </SettingsGroup>
    <SettingsGroup title="Colors and legend">
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
    </SettingsGroup>
    {(bar || markers || line) && <SettingsGroup title="Traces and markers">
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
    </SettingsGroup>}
  </>;
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
  if ([style.axes_width, style.axes_height].some((size) => size !== null && (!Number.isFinite(size) || size < 1 || size > 8000))) {
    return "Enter axes dimensions from 1 to 8000 px.";
  }
  if (!/^[\p{L}\p{N}_ .'-]+$/u.test(style.font_family.trim())) return "Enter one font family name.";
  if (![style.label_size, style.tick_size].every((size) => size >= 6 && size <= 48)) return "Enter font sizes from 6 to 48 px.";
  if (!(style.line_width >= 0.1 && style.line_width <= 12)) return "Enter a trace line width from 0.1 to 12 px.";
  if (!(style.marker_size >= 1 && style.marker_size <= 30)) return "Enter a marker size from 1 to 30 px.";
  if (!(style.bar_width >= 0.05 && style.bar_width <= 1)) return "Enter a bar width from 0.05 to 1.";
  return "";
}

export function FigureSettings({ initial, defaults, initialSection, labels, categoricalX, bar, markers, line, onClose, onApply, global = false, busy = false, saveError = "", onSaveGlobal }: {
  global?: boolean;
  busy?: boolean;
  saveError?: string;
  onSaveGlobal?: (section: StyleSection, key: string, value: unknown, unit?: string) => Promise<boolean>;
  initial: FigureStyle;
  defaults: FigureStyle;
  initialSection: StyleSection;
  labels: Record<AxisKey, string>;
  categoricalX: boolean;
  bar: boolean;
  markers: boolean;
  line: boolean;
  onClose: () => void;
  onApply: (style: FigureStyle) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [style, setStyle] = useState(initial);
  const [section, setSection] = useState(initialSection);
  const [error, setError] = useState("");
  const [invalidMeasurements, setInvalidMeasurements] = useState<Record<string, StyleSection>>({});
  const axes: AxisKey[] = ["x", "y"];

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo(0, 0); }, [section]);

  function move(left: number, top: number) {
    const bounds = dialog.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)),
    });
  }

  useEffect(() => {
    function resize() {
      const bounds = dialog.current?.getBoundingClientRect();
      if (bounds) move(bounds.left, bounds.top);
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const bounds = dialog.current!.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function apply() {
    if (busy || !dialog.current?.querySelector("form")?.reportValidity()) return;
    const invalidSection = Object.values(invalidMeasurements)[0];
    if (invalidSection) {
      setSection(invalidSection);
      setError("Enter valid measurement units.");
      return;
    }
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

  async function saveField(key: string) {
    const value = section === "figure" ? style[key as keyof FigureStyle] : style[section][key as keyof AxisStyle];
    if (!dialog.current?.querySelector("form")?.reportValidity()) return;
    if (Object.keys(invalidMeasurements).length) {
      setError("Enter valid measurement units.");
      return;
    }
    const unit = (section === "figure" ? style.units : style[section].units)?.[key];
    if (await onSaveGlobal?.(section, key, value, unit)) setError("");
  }

  function resetUnits(current: Record<string, string> = {}, defaults: Record<string, string> = {}, key: string) {
    const units = { ...current };
    delete units[key];
    if (defaults[key]) units[key] = defaults[key];
    return units;
  }

  function resetField(key: string) {
    setInvalidMeasurements((current) => {
      const next = { ...current };
      delete next[`${section}.${key}`];
      return next;
    });
    setError("");
    if (section === "figure") {
      setStyle({ ...style, [key]: defaults[key as keyof FigureStyle], units: resetUnits(style.units, defaults.units, key) });
    } else {
      setStyle({ ...style, [section]: { ...style[section], [key]: defaults[section][key as keyof AxisStyle], units: resetUnits(style[section].units, defaults[section].units, key) } });
    }
  }

  function resetSection() {
    setInvalidMeasurements((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value !== section)));
    setError("");
    setStyle(section === "figure"
      ? { ...defaults, x: style.x, y: style.y }
      : { ...style, [section]: defaults[section] });
  }

  return <dialog ref={dialog} className="settings-dialog figure-settings" aria-labelledby="figure-settings-title"
    style={position ? { left: position.left, top: position.top, margin: 0 } : undefined}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <header className="settings-title" tabIndex={0} title="Drag to move. Alt + arrow keys also move the window."
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          if (drag.current) move(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const bounds = dialog.current!.getBoundingClientRect();
          move(bounds.left + (event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0),
            bounds.top + (event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0));
        }}>
        <h2 id="figure-settings-title">{global ? "Settings" : "Figure settings"}</h2>
      </header>
      <div className="settings-body">
        <nav className="settings-sidebar" aria-label="Settings categories">
          {global && <p className="settings-sidebar-heading">Global Figure Settings</p>}
          <div className="figure-settings-nav" role="tablist" aria-label="Settings section" aria-orientation="vertical">
            {(["figure", ...axes] as const).map((item, index, items) => (
              <button key={item} type="button" role="tab" aria-selected={section === item}
                id={`settings-tab-${item}`} aria-controls="settings-options" tabIndex={section === item ? 0 : -1}
                onClick={() => { setSection(item); setError(""); }}
                onKeyDown={(event) => {
                  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                    : event.key === "ArrowDown" ? (index + 1) % items.length
                    : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setSection(items[next]);
                  setError("");
                  event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
                }}>
                {sectionNames[item]}
              </button>
            ))}
          </div>
        </nav>
        <div ref={content} className="settings-content" id="settings-options" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
          {global && <p className="global-settings-note muted">Defaults for new figures.</p>}
      <GlobalControls.Provider value={onSaveGlobal ? { busy, save: (key) => { void saveField(key); }, reset: resetField } : null}>
      <MeasurementControls.Provider value={{
        units: (section === "figure" ? style.units : style[section].units) ?? {},
        setInvalid: (key, invalid) => setInvalidMeasurements((current) => {
          const next = { ...current };
          if (invalid) next[`${section}.${key}`] = section;
          else delete next[`${section}.${key}`];
          return next;
        }),
        setUnit: (key, unit) => setStyle((current) => section === "figure"
          ? { ...current, units: { ...current.units, [key]: unit } }
          : { ...current, [section]: { ...current[section], units: { ...current[section].units, [key]: unit } } }),
      }}>
      {section === "figure" ? <FigureFields style={style} bar={bar} markers={markers} line={line} onChange={setStyle} />
        : <AxisFields style={style[section]} fallback={labels[section]} categorical={categoricalX && section === "x"}
            onChange={(value) => setStyle({ ...style, [section]: value })} />}
      </MeasurementControls.Provider>
      </GlobalControls.Provider>
        </div>
      </div>
      <div className="settings-feedback">
        {(error || saveError) && <p className="figure-settings-error" role="alert">{error || saveError}</p>}
      </div>
      <footer>
        <button type="button" className="figure-reset" onClick={resetSection}>Reset section</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{global ? "Save settings" : "Apply"}</button>
      </footer>
    </form>
  </dialog>;
}
