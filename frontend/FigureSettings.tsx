import { axisSettings, separateAxes, textRoles, type TextRole } from "./figureStyle";
import { createContext, useContext, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formatMeasurement, parseMeasurement } from "./units";
import { invoke } from "@tauri-apps/api/core";
import type { Appearance } from "./workspace";
import { Save, RotateCcw } from "lucide-react";
import type { AxisKey, AxisSettingsKey, AxisStyle, FigureStyle, StyleSection, TextRenderer } from "./figureStyle";

type FigureTab = "figure" | "traces" | "legend" | "fonts";
type SettingsTab = FigureTab | "axes";
export type SettingsSection = "figure" | AxisSettingsKey;

const sectionNames: Record<SettingsTab, string> = {
  figure: "Figure", traces: "Traces", legend: "Legend", fonts: "Fonts", axes: "Axes",
};

const figureTabFields: Record<FigureTab, (keyof FigureStyle)[]> = {
  figure: ["title", "title_renderer", "axes_width", "axes_height", "background"],
  traces: ["bar_width", "show_markers", "marker_size", "marker_symbol", "show_lines", "line_width", "line_dash", "marker_color", "line_color"],
  legend: ["legend", "legend_frame", "legend_border_color", "legend_border_width", "legend_background"],
  fonts: ["text_color", "font_family", "font_face", "font_bold", "font_italic", "label_size", "tick_size", "math_alphabet", "math_preamble",
    ...(Object.keys(textRoles) as TextRole[]).flatMap((role) =>
      (["family", "face", "size", "bold", "italic"] as const).map((field) => `${role}_${field}` as const))],
};

const fieldKeys: Record<string, string> = {
  "Title text renderer": "title_renderer", "Axis label text renderer": "label_renderer",
  "Math alphabet": "math_alphabet", "TeX preamble": "math_preamble",
  "Figure title": "title", "Axes width (px)": "axes_width", "Axes height (px)": "axes_height",
  "Show markers": "show_markers", "Show trace lines": "show_lines", "Number notation": "notation", "Font family": "font_family", "Font style": "font_face", "Axis label size (px)": "label_size", "Tick and legend size (px)": "tick_size",
  "Text color": "text_color", "Background": "background", "Position": "legend",
  "Show frame": "legend_frame", "Frame color": "legend_border_color", "Frame width (px)": "legend_border_width",
  "Legend background": "legend_background", "Marker color": "marker_color", "Line color": "line_color",
  "Bar width (fraction)": "bar_width", "Marker size (px)": "marker_size", "Marker shape": "marker_symbol",
  "Trace line width (px)": "line_width", "Trace line style": "line_dash",
  "Axis label": "label", "Scale": "scale", "Lower limit": "lower", "Upper limit": "upper",
  "Tick interval": "step", "Tick interval (decades)": "step", "Tick number format": "format",
  "Tick direction": "ticks", "Tick length (px)": "tick_length", "Tick label angle (°)": "angle",
  "Axis line width (px)": "line_width", "Axis line": "line", "Tick labels": "tick_labels",
  "Minor ticks": "minor_ticks", "Opposite axis line": "mirror", "Opposite ticks": "opposite_ticks", "Bold": "font_bold", "Italic": "font_italic", "Grid lines": "grid",
  "Zero line": "zero_line", "Hover ruler": "hover_ruler",
};
const measuredFields = new Set(Object.entries(fieldKeys)
  .filter(([label]) => label.endsWith("(px)") || label.endsWith("(°)")).map(([, key]) => key));

for (const role of Object.keys(textRoles) as TextRole[]) {
  const label = textRoles[role];
  fieldKeys[`${label} font family`] = `${role}_family`;
  fieldKeys[`${label} bold`] = `${role}_bold`;
  fieldKeys[`${label} italic`] = `${role}_italic`;
  fieldKeys[`${label} font style`] = `${role}_face`;
  fieldKeys[`${label} size (px)`] = `${role}_size`;
}

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
  describe: (key: string) => string;
} | null>(null);

function Field({ label, children, checkbox = false }: { label: string; children: ReactNode; checkbox?: boolean }) {
  const controls = useContext(GlobalControls);
  const key = fieldKeys[label];
  return <div className="figure-field-row">
    <label className={checkbox ? "figure-field figure-checkbox" : "figure-field"}>{checkbox && children}<span>{label}</span>{!checkbox && children}</label>
    {controls && key && <div className="global-field-actions">
      <button type="button" disabled={controls.busy} title="Save as global value"
        aria-label={`Save ${label.toLowerCase()} as global`} onClick={() => controls.save(key)}><Save size={10} /></button>
      <button type="button" disabled={controls.busy} title={`Use global value (${controls.describe(key)})`}
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

function TextField({ label, value, renderer, rendererLabel, onChange, onRenderer }: {
  label: string;
  value: string;
  renderer: TextRenderer;
  rendererLabel: string;
  onChange: (value: string) => void;
  onRenderer: (value: TextRenderer) => void;
}) {
  return <>
    <Field label={label}><input value={value} onChange={(event) => onChange(event.target.value)} /></Field>
    <Choice label={rendererLabel} value={renderer} onChange={onRenderer}
      options={[["auto", "Auto"], ["plain", "Plain text"], ["latex", "LaTeX (MathJax)"]]} />
  </>;
}

function faceLabel(face: string) {
  const weights: Record<string, string> = {
    100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium",
    600: "Semibold", 700: "Bold", 800: "Extra Bold", 900: "Black",
  };
  const [weight, slant] = face.split(":");
  if (slant === "normal") return weights[weight] ?? weight;
  const name = slant === "italic" ? "Italic" : "Oblique";
  return weight === "400" ? name : `${weights[weight] ?? weight} ${name}`;
}

function FontField({ value, onChange, label = "Font family", styleLabel = "Font style", inheritedFamily,
  face, legacyFace, onFace }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  styleLabel?: string;
  inheritedFamily?: string;
  face: string | null;
  legacyFace?: string;
  onFace: (face: string | null) => void;
}) {
  const id = useId();
  const [families, setFamilies] = useState<string[]>([]);
  const [styles, setStyles] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (refresh: boolean) => {
    setBusy(true);
    setError("");
    try {
      const response = await invoke<{ fonts: string[]; styles: Record<string, string[]> }>("workspace", {
        request: { action: "system_fonts", refresh },
      });
      setFamilies(response.fonts);
      setStyles(response.styles);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(false); }, []);
  const selected = face ?? legacyFace ?? "";
  const family = value.trim() || inheritedFamily;
  const installedFamily = families.find((name) => name.toLowerCase() === family?.toLowerCase());
  const options = installedFamily ? styles[installedFamily] ?? [] : [];
  const faces = [...new Set([...options, ...(selected ? [selected] : [])])];
  return <div>
    <Field label={label}>
      <input list={id} value={value} placeholder="Inherit figure font" onChange={(event) => onChange(event.target.value)} />
    </Field>
    <datalist id={id}>{families.map((family) => <option key={family} value={family} />)}</datalist>
    <Field label={styleLabel}>
      <select aria-label={styleLabel} value={selected} onChange={(event) => onFace(event.target.value || null)}>
        <option value="">{inheritedFamily ? "Inherit figure style" : "Regular (default)"}</option>
        {faces.map((face) => <option key={face} value={face}>{faceLabel(face)}</option>)}
      </select>
    </Field>
    <button className="refresh-fonts" type="button" disabled={busy} onClick={() => { void load(true); }}>Refresh system fonts</button>
    {error && <p className="figure-settings-error" role="alert">{error}</p>}
  </div>;
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
      <TextField label="Axis label" value={style.label ?? fallback} onChange={(value) => set("label", value)}
        rendererLabel="Axis label text renderer" renderer={style.label_renderer} onRenderer={(value) => set("label_renderer", value)} />
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
      {!categorical && <Choice label="Number notation" value={style.notation} onChange={(value) => set("notation", value)}
        options={[["plain", "Plain numbers"], ["si", "SI prefixes"], ["scientific", "Shared scientific exponent"]]} />}
      <NumberField label="Tick length (px)" value={style.tick_length} onChange={(value) => set("tick_length", value)} />
      <NumberField label="Tick label angle (°)" value={style.angle} onChange={(value) => set("angle", value)} />
    </SettingsGroup>
    <SettingsGroup title="Axis appearance">
      <NumberField label="Axis line width (px)" value={style.line_width} onChange={(value) => set("line_width", value)} />
    </SettingsGroup>
    {categorical && <p className="muted">Bar positions start at 0.</p>}
    <SettingsGroup title="Display">
      {([
        ["line", "Axis line"], ["tick_labels", "Tick labels"], ["minor_ticks", "Minor ticks"],
        ["mirror", "Opposite axis line"], ["grid", "Grid lines"], ["zero_line", "Zero line"],
        ["hover_ruler", "Hover ruler"],
      ] as const).filter(([key]) => !categorical || key !== "minor_ticks").map(([key, label]) => (
        <Field key={key} label={label} checkbox>
          <input type="checkbox" checked={style[key]} onChange={(event) => {
            if (key === "mirror") {
              onChange({ ...style, mirror: event.target.checked, opposite_ticks: style.opposite_ticks ?? false });
            } else {
              set(key, event.target.checked);
            }
          }} />
        </Field>
      ))}
      <Field label="Opposite ticks" checkbox>
        <input type="checkbox" checked={style.opposite_ticks ?? style.mirror} disabled={!style.mirror || !style.line}
          onChange={(event) => set("opposite_ticks", event.target.checked)} />
      </Field>
    </SettingsGroup>
  </>;
}

function TextOverrides({ style, onChange }: { style: FigureStyle; onChange: (style: FigureStyle) => void }) {
  const [role, setRole] = useState<TextRole>("title");
  const label = textRoles[role];
  return <SettingsGroup title="Text styles">
    <Field label="Text element"><select value={role} onChange={(event) => setRole(event.target.value as TextRole)}>
      {(Object.keys(textRoles) as TextRole[]).map((key) => <option key={key} value={key}>{textRoles[key]}</option>)}
    </select></Field>
    <FontField label={`${label} font family`} styleLabel={`${label} font style`} inheritedFamily={style.font_family}
      face={style[`${role}_face`]} value={style[`${role}_family`] ?? ""}
      legacyFace={style[`${role}_bold`] == null && style[`${role}_italic`] == null ? undefined
        : `${(style[`${role}_bold`] ?? style.font_bold) ? 700 : 400}:${(style[`${role}_italic`] ?? style.font_italic) ? "italic" : "normal"}`}
      onFace={(face) => onChange({ ...style, [`${role}_face`]: face, [`${role}_bold`]: null, [`${role}_italic`]: null })}
      onChange={(value) => onChange({ ...style, [`${role}_family`]: value.trim() ? value : null })} />
    <NumberField key={role} label={`${label} size (px)`} placeholder="Auto" value={style[`${role}_size`]}
      onChange={(value) => onChange({ ...style, [`${role}_size`]: Number.isNaN(value) ? null : value })} />
  </SettingsGroup>;
}

function OptionalColor({ label, value, fallback, onChange }: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (value: string | null) => void;
}) {
  return <>
    <Field label={label}><input type="color" value={value ?? fallback} onChange={(event) => onChange(event.target.value)} /></Field>
    <Field label={`Use automatic ${label.toLowerCase()}`} checkbox>
      <input type="checkbox" checked={value == null} onChange={(event) => onChange(event.target.checked ? null : fallback)} />
    </Field>
  </>;
}

function FigureFields({ tab, style, bar, markers, line, onChange }: {
  tab: FigureTab;
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
    {tab === "figure" && <>
    <SettingsGroup title="Layout">
    <TextField label="Figure title" value={style.title} onChange={(value) => set("title", value)}
      rendererLabel="Title text renderer" renderer={style.title_renderer} onRenderer={(value) => set("title_renderer", value)} />
    <NumberField label="Axes width (px)" placeholder="Auto" value={style.axes_width}
      onChange={(value) => set("axes_width", Number.isNaN(value) ? null : value)} />
    <NumberField label="Axes height (px)" placeholder="Auto" value={style.axes_height}
      onChange={(value) => set("axes_height", Number.isNaN(value) ? null : value)} />
    </SettingsGroup>
    <SettingsGroup title="Colors">
    <Field label="Background"><input type="color" value={style.background}
      onChange={(event) => set("background", event.target.value)} /></Field>
    </SettingsGroup>
    </>}
    {tab === "fonts" && <>
    <SettingsGroup title="Typography">
    <Field label="Text color"><input type="color" value={style.text_color}
      onChange={(event) => set("text_color", event.target.value)} /></Field>
    <FontField value={style.font_family} onChange={(value) => set("font_family", value)} face={style.font_face}
      legacyFace={style.font_bold || style.font_italic ? `${style.font_bold ? 700 : 400}:${style.font_italic ? "italic" : "normal"}` : undefined}
      onFace={(face) => onChange({ ...style, font_face: face, font_bold: false, font_italic: false })} />
    <NumberField label="Axis label size (px)" value={style.label_size} onChange={(value) => set("label_size", value)} />
    <NumberField label="Tick and legend size (px)" value={style.tick_size} onChange={(value) => set("tick_size", value)} />
    </SettingsGroup>
    <TextOverrides style={style} onChange={onChange} />
    <SettingsGroup title="MathJax">
      <div className="math-settings">
        <Choice label="Math alphabet" value={style.math_alphabet} onChange={(value) => set("math_alphabet", value)}
          options={[["default", "TeX default"], ["roman", "Roman"], ["sans", "Sans serif"], ["mono", "Monospace"]]} />
        <Field label="TeX preamble">
          <textarea rows={4} spellCheck={false} value={style.math_preamble} placeholder={"\\def\\conc{c_{0}}"}
            onChange={(event) => set("math_preamble", event.target.value)} />
        </Field>
        <p className="muted">Use TeX definitions such as {"\\def\\conc{c_{0}}"}. The alphabet uses MathJax’s bundled glyphs.</p>
      </div>
    </SettingsGroup>
    </>}
    {tab === "legend" && <SettingsGroup title="Legend">
    <Choice label="Position" value={style.legend} onChange={(value) => set("legend", value)}
      options={[
        ["auto", "Automatic"], ["none", "Hidden"], ["above", "Above plot"],
        ["top_left", "Top left"], ["top_right", "Top right"],
        ["bottom_left", "Bottom left"], ["bottom_right", "Bottom right"],
      ]} />
    <OptionalColor label="Legend background" value={style.legend_background} fallback={style.background}
      onChange={(value) => set("legend_background", value)} />
    <Field label="Show frame" checkbox><input type="checkbox" checked={style.legend_frame}
      onChange={(event) => set("legend_frame", event.target.checked)} /></Field>
    <Field label="Frame color"><input type="color" value={style.legend_border_color}
      onChange={(event) => set("legend_border_color", event.target.value)} /></Field>
    <NumberField label="Frame width (px)" value={style.legend_border_width} onChange={(value) => set("legend_border_width", value)} />
    </SettingsGroup>}
    {tab === "traces" && <>
    {bar && <SettingsGroup title="Bars"><NumberField label="Bar width (fraction)" value={style.bar_width} onChange={(value) => set("bar_width", value)} /></SettingsGroup>}
    {markers && <SettingsGroup title="Markers">
          <Field label="Show markers" checkbox><input type="checkbox" checked={style.show_markers} onChange={(event) => set("show_markers", event.target.checked)} /></Field>
          <OptionalColor label="Marker color" value={style.marker_color} fallback="#245e9b" onChange={(value) => set("marker_color", value)} />
          <NumberField label="Marker size (px)" value={style.marker_size} onChange={(value) => set("marker_size", value)} />
          <Choice label="Marker shape" value={style.marker_symbol} onChange={(value) => set("marker_symbol", value)}
            options={[
              ["circle", "Circle"], ["square", "Square"], ["diamond", "Diamond"],
              ["triangle-up", "Triangle"], ["cross", "Cross"],
            ]} />
        </SettingsGroup>}
    {line && <SettingsGroup title="Lines">
      <Field label="Show trace lines" checkbox><input type="checkbox" checked={style.show_lines} onChange={(event) => set("show_lines", event.target.checked)} /></Field>
      <OptionalColor label="Line color" value={style.line_color} fallback="#245e9b" onChange={(value) => set("line_color", value)} />
      <NumberField label="Trace line width (px)" value={style.line_width} onChange={(value) => set("line_width", value)} />
      <Choice label="Trace line style" value={style.line_dash} onChange={(value) => set("line_dash", value)}
        options={[["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"], ["dashdot", "Dash-dot"]]} />
    </SettingsGroup>}
    </>}
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
    return { tab: "figure" as const, message: "Enter axes dimensions from 1 to 8000 px." };
  }
  if (!/^[\p{L}\p{N}_ .'-]+$/u.test(style.font_family.trim())) return { tab: "fonts" as const, message: "Enter one font family name." };
  if (![style.label_size, style.tick_size].every((size) => size >= 6 && size <= 48)) return { tab: "fonts" as const, message: "Enter font sizes from 6 to 48 px." };
  if (!(style.legend_border_width >= 0 && style.legend_border_width <= 12)) return { tab: "legend" as const, message: "Enter a frame width from 0 to 12 px." };
  if (!(style.line_width >= 0.1 && style.line_width <= 12)) return { tab: "traces" as const, message: "Enter a trace line width from 0.1 to 12 px." };
  if (!(style.marker_size >= 1 && style.marker_size <= 30)) return { tab: "traces" as const, message: "Enter a marker size from 1 to 30 px." };
  if (!(style.bar_width >= 0.05 && style.bar_width <= 1)) return { tab: "traces" as const, message: "Enter a bar width from 0.05 to 1." };
  return null;
}

export function FigureSettings({ initial, defaults, initialSection, labels, availableAxes = ["x", "y"], categoricalX, bar, markers, line, onClose, onApply, global = false, appearance, runAutomatically = true, busy = false, saveError = "", onSaveGlobal }: {
  global?: boolean;
  appearance?: Appearance;
  runAutomatically?: boolean;
  busy?: boolean;
  saveError?: string;
  onSaveGlobal?: (section: SettingsSection, key: string, value: unknown, unit?: string) => Promise<boolean>;
  initial: FigureStyle;
  defaults: FigureStyle;
  initialSection: StyleSection;
  labels: Record<AxisKey, string>;
  availableAxes?: AxisKey[];
  categoricalX: boolean;
  bar: boolean;
  markers: boolean;
  line: boolean;
  onClose: () => void;
  onApply: (style: FigureStyle, appearance?: Appearance, runAutomatically?: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [style, setStyle] = useState(initial);
  const [page, setPage] = useState<"appearance" | "figures" | "workflow">(global ? "appearance" : "figures");
  const [automatic, setAutomatic] = useState(runAutomatically);
  const [expanded, setExpanded] = useState(true);
  const [appearanceDraft, setAppearanceDraft] = useState<Appearance>(appearance ?? { theme: "system", accent: "#245883" });
  const [tab, setTab] = useState<SettingsTab>(initialSection === "figure" || !availableAxes.length ? "figure" : "axes");
  const separate = separateAxes(style);
  const axisGroups: AxisSettingsKey[] = separate ? availableAxes : ["global_axis"];
  const [error, setError] = useState("");
  const [invalidMeasurements, setInvalidMeasurements] = useState<Record<string, SettingsTab>>({});

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo(0, 0); }, [tab, page]);

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
    if (busy) return;
    const invalidSection = Object.values(invalidMeasurements)[0];
    if (invalidSection) {
      setPage("figures");
      setExpanded(true);
      setTab(invalidSection);
      setError("Enter valid measurement units.");
      return;
    }
    const invalidAxis = ["x", "y", "global_axis"].map((key) => axisError(axisSettings(style, key as AxisSettingsKey))).find(Boolean);
    const failure = figureError(style) || (invalidAxis ? { tab: "axes" as const, message: invalidAxis } : null);
    if (failure) {
      setPage("figures");
      setExpanded(true);
      setTab(failure.tab);
      setError(failure.message);
      return;
    }
    onApply({ ...style, font_family: style.font_family.trim() }, global ? appearanceDraft : undefined, global ? automatic : undefined);
  }

  async function saveField(section: SettingsSection, key: string) {
    const value = section === "figure" ? style[key as keyof FigureStyle] : axisSettings(style, section)[key as keyof AxisStyle];
    if (!dialog.current?.querySelector("form")?.reportValidity()) return;
    if (Object.keys(invalidMeasurements).length) {
      setError("Enter valid measurement units.");
      return;
    }
    const unit = (section === "figure" ? style.units : axisSettings(style, section).units)?.[key];
    if (await onSaveGlobal?.(section, key, value, unit)) setError("");
  }

  function resetUnits(current: Record<string, string> = {}, defaults: Record<string, string> = {}, key: string) {
    const units = { ...current };
    delete units[key];
    if (defaults[key]) units[key] = defaults[key];
    return units;
  }

  function resetField(section: SettingsSection, key: string) {
    setInvalidMeasurements((current) => {
      const next = { ...current };
      delete next[`${section}.${key}`];
      return next;
    });
    setError("");
    if (section === "figure") {
      setStyle({ ...style, [key]: defaults[key as keyof FigureStyle], units: resetUnits(style.units, defaults.units, key) });
    } else {
      setStyle({ ...style, [section]: { ...axisSettings(style, section), [key]: axisSettings(defaults, section)[key as keyof AxisStyle], units: resetUnits(axisSettings(style, section).units, axisSettings(defaults, section).units, key) } });
    }
  }

  function resetSection() {
    if (page === "workflow") { setAutomatic(true); return; }
    if (page === "appearance") {
      setAppearanceDraft({ theme: "system", accent: "#245883" });
      return;
    }
    setError("");
    if (tab === "axes") {
      setInvalidMeasurements((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value !== "axes")));
      setStyle({ ...style, axes_separate: defaults.axes_separate, global_axis: defaults.global_axis, x: defaults.x, y: defaults.y });
      return;
    }
    const fields = figureTabFields[tab];
    setInvalidMeasurements((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !fields.some((field) => key === `figure.${field}`)),
    ));
    const units = fields.reduce((current, key) => resetUnits(current, defaults.units, key), style.units ?? {});
    setStyle({ ...style, ...Object.fromEntries(fields.map((key) => [key, defaults[key]])), units });
  }

  function describeDefault(section: SettingsSection, key: string) {
    const defaultsForSection = section === "figure" ? defaults : axisSettings(defaults, section);
    const value = key === "opposite_ticks" && section !== "figure"
      ? axisSettings(defaults, section).opposite_ticks ?? axisSettings(defaults, section).mirror
      : defaultsForSection[key as keyof typeof defaultsForSection] as unknown;
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (value == null) return "Auto";
    if (value === "") return "Blank";
    if (typeof value === "number" && measuredFields.has(key)) {
      const angle = key === "angle";
      return formatMeasurement(value, defaultsForSection.units?.[key] ?? (angle ? "deg" : "px"), angle);
    }
    return String(value);
  }

  function withControls(section: SettingsSection, fields: ReactNode) {
    return <GlobalControls.Provider value={onSaveGlobal ? {
      busy, save: (key) => { void saveField(section, key); }, reset: (key) => resetField(section, key),
      describe: (key) => describeDefault(section, key),
    } : null}>
      <MeasurementControls.Provider value={{
        units: (section === "figure" ? style.units : axisSettings(style, section).units) ?? {},
        setInvalid: (key, invalid) => setInvalidMeasurements((current) => {
          const next = { ...current };
          if (invalid) next[`${section}.${key}`] = tab;
          else delete next[`${section}.${key}`];
          return next;
        }),
        setUnit: (key, unit) => setStyle((current) => {
          if (section === "figure") return { ...current, units: { ...current.units, [key]: unit } };
          const axis = axisSettings(current, section);
          return { ...current, [section]: { ...axis, units: { ...axis.units, [key]: unit } } };
        }),
      }}>
        {fields}
      </MeasurementControls.Provider>
    </GlobalControls.Provider>;
  }

  const sectionTabs = (
          <div className="figure-settings-nav">
            {(["figure", "traces", "legend", "fonts", "axes"] as const)
              .filter((item) => (item !== "traces" || bar || markers || line) && (item !== "axes" || availableAxes.length > 0)).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={page === "figures" && tab === item}
                id={`settings-tab-${item}`} aria-controls="settings-options" tabIndex={page === "figures" && tab === item ? 0 : -1}
                onClick={() => { setPage("figures"); setTab(item); setError(""); }}>
                {sectionNames[item]}
              </button>
            ))}
          </div>
  );

  return <dialog ref={dialog} className="settings-dialog figure-settings" aria-labelledby="figure-settings-title"
    style={position ? { left: position.left, top: position.top, margin: 0 } : undefined}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form noValidate onSubmit={(event) => { event.preventDefault(); apply(); }}>
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
          <div role="tablist" aria-label="Settings section" aria-orientation="vertical"
            onKeyDown={(event) => {
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                .filter((item) => item.offsetParent !== null);
              const index = items.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : event.key === "ArrowDown" ? (index + 1) % items.length
                : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : -1;
              if (next < 0) return;
              event.preventDefault();
              items[next].click();
              items[next].focus();
            }}>
            {global && <button className="settings-page-tab" type="button" role="tab" id="settings-tab-appearance"
              aria-controls="settings-options" aria-selected={page === "appearance"} tabIndex={page === "appearance" ? 0 : -1}
              onClick={() => { setPage("appearance"); setError(""); }}>Appearance</button>}
            {global && <button className="settings-page-tab" type="button" role="tab" id="settings-tab-workflow"
              aria-controls="settings-options" aria-selected={page === "workflow"} tabIndex={page === "workflow" ? 0 : -1}
              onClick={() => { setPage("workflow"); setError(""); }}>Workflow</button>}
            {global ? <details className="settings-nav-group" open={expanded}
              onToggle={(event) => setExpanded(event.currentTarget.open)}>
              <summary>Global Figure Settings</summary>
              {sectionTabs}
            </details> : sectionTabs}
          </div>
        </nav>
        <div ref={content} className="settings-content" id="settings-options" role="tabpanel" aria-labelledby={page === "figures" ? `settings-tab-${tab}` : `settings-tab-${page}`}>
          {page === "workflow" && <SettingsGroup title="Execution">
            <Field label="Run new steps automatically" checkbox>
              <input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} />
            </Field>
          </SettingsGroup>}
          {page === "appearance" && <SettingsGroup title="Interface">
            <Field label="Theme">
              <select aria-label="Theme" value={appearanceDraft.theme} onChange={(event) => setAppearanceDraft({
                ...appearanceDraft, theme: event.target.value as Appearance["theme"],
              })}>
                <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
              </select>
            </Field>
            <Field label="Accent color">
              <input aria-label="Accent color" type="color" value={appearanceDraft.accent} onChange={(event) => setAppearanceDraft({
                ...appearanceDraft, accent: event.target.value,
              })} />
            </Field>
          </SettingsGroup>}
          <div hidden={page !== "figures"}>
            {tab === "axes" ? <>
              <Field label="Configure axes separately" checkbox>
                <input type="checkbox" checked={separate} onChange={(event) => {
                  setStyle({ ...style, axes_separate: event.target.checked });
                }} />
              </Field>
              {axisGroups.map((key) => <fieldset key={key} className="settings-category axis-group">
                <legend>{key === "global_axis" ? "Global" : key.toUpperCase()}</legend>
                {withControls(key, <AxisFields style={axisSettings(style, key)}
                  fallback={key === "global_axis" ? "" : labels[key]} categorical={key === "x" && categoricalX}
                  onChange={(value) => setStyle({ ...style, [key]: value })} />)}
              </fieldset>)}
            </> : withControls("figure", <FigureFields tab={tab} style={style} bar={bar} markers={markers} line={line} onChange={setStyle} />)}
          </div>
        </div>
      </div>
      <div className="settings-feedback">
        {(error || saveError) && <p className="figure-settings-error" role="alert">{error || saveError}</p>}
      </div>
      <footer>
        <button type="button" className="figure-reset" onClick={resetSection}>{page === "appearance" ? "Reset appearance" : "Reset section"}</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{global ? "Save settings" : "Apply"}</button>
      </footer>
    </form>
  </dialog>;
}
