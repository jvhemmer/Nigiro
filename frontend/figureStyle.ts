import type { Layout, LayoutAxis } from "plotly.js";

export type TextRenderer = "auto" | "plain" | "latex";
export type AxisKey = "x" | "y";
export type StyleSection = "figure" | AxisKey;

export interface AxisStyle {
  units?: Record<string, string>;
  label: string | null;
  label_renderer: TextRenderer;
  scale: "linear" | "log";
  lower: number | null;
  upper: number | null;
  step: number | null;
  format: string;
  notation: "plain" | "si" | "scientific";
  angle: number;
  ticks: "outside" | "inside" | "none";
  tick_length: number;
  tick_labels: boolean;
  minor_ticks: boolean;
  line: boolean;
  line_width: number;
  mirror: boolean;
  opposite_ticks: boolean | null;
  grid: boolean;
  zero_line: boolean;
  hover_ruler: boolean;
}

export const textRoles = {
  title: "Title", x_label: "X axis label", y_label: "Y axis label",
  x_tick: "X tick labels", y_tick: "Y tick labels", legend: "Legend labels",
} as const;
export type TextRole = keyof typeof textRoles;
type Typography = Record<`${TextRole}_family` | `${TextRole}_face`, string | null>
  & Record<`${TextRole}_bold` | `${TextRole}_italic`, boolean | null>
  & Record<`${TextRole}_size`, number | null>;

export interface FigureStyle extends Typography {
  units?: Record<string, string>;
  title: string;
  title_renderer: TextRenderer;
  axes_width: number | null;
  axes_height: number | null;
  font_family: string;
  font_bold: boolean;
  font_italic: boolean;
  font_face: string | null;
  math_alphabet: "default" | "roman" | "sans" | "mono";
  math_preamble: string;
  label_size: number;
  tick_size: number;
  text_color: string;
  background: string;
  legend: "auto" | "none" | "above" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
  line_width: number;
  legend_frame: boolean;
  legend_border_color: string;
  legend_border_width: number;
  legend_background: string | null;
  marker_color: string | null;
  line_color: string | null;
  line_dash: "solid" | "dash" | "dot" | "dashdot";
  marker_size: number;
  show_markers: boolean;
  show_lines: boolean;
  marker_symbol: "circle" | "square" | "diamond" | "triangle-up" | "cross";
  bar_width: number;
  x: AxisStyle;
  y: AxisStyle;
}

export const figureFont = "DejaVu Sans";

const latexEscapes: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "$": "\\$",
  "&": "\\&", "#": "\\#", "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};

export function plotText(text: string, renderer: TextRenderer = "auto", math?: Pick<FigureStyle, "math_alphabet" | "math_preamble">) {
  function formatMath(expression: string) {
    const command = { default: "", roman: "mathrm", sans: "mathsf", mono: "mathtt" }[math?.math_alphabet ?? "default"];
    const body = command ? `\\${command}{${expression}}` : expression;
    const preamble = math?.math_preamble.trim();
    return preamble ? "$" + `{${preamble}\n${body}}$` : `$${body}$`;
  }
  if (!text) return text;
  if (renderer !== "plain") {
    const parts = text.split(/(?<!\\)\$([^$]+)(?<!\\)\$/g);
    if (parts.length > 1) {
      const expression = parts.map((part, index) => index % 2 || !part ? part
        : `\\text{${part.replace(/[\\{}%$&#_^~]/g, (character) => latexEscapes[character])}}`).join("");
      return formatMath(expression);
    }
    if (renderer === "latex") return formatMath(text);
  }
  return text.replaceAll("&", "&amp;").replaceAll("$", "&#36;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
}

function fontFace(face: string | null, bold: boolean, italic: boolean) {
  const [weight, slant] = (face ?? `${bold ? 700 : 400}:${italic ? "italic" : "normal"}`).split(":");
  return { weight: Number(weight), style: slant === "normal" ? "normal" as const : "italic" as const };
}

function textFont(style: FigureStyle, role: TextRole, defaultSize: number) {
  const family = style[`${role}_family`] ?? style.font_family;
  return {
    family: family === figureFont ? figureFont : `"${family}", "${figureFont}"`,
    size: style[`${role}_size`] ?? defaultSize,
    ...fontFace(style[`${role}_face`] ?? (style[`${role}_bold`] == null && style[`${role}_italic`] == null ? style.font_face : null),
      style[`${role}_bold`] ?? style.font_bold, style[`${role}_italic`] ?? style.font_italic),
  };
}

function axisLayout(style: FigureStyle, axis: AxisStyle, label: string, revision: number, side: AxisKey, categorical = false): Partial<LayoutAxis> {
  const scale = categorical ? "linear" : axis.scale;
  const { lower, upper, step, format } = axis;
  const transformLimit = (limit: number | null) => limit === null || scale === "linear" ? limit : Math.log10(limit);
  const limits = [transformLimit(lower), transformLimit(upper)];
  const autorange = lower === null || upper === null;
  const ticks = axis.ticks === "none" ? "" : axis.ticks;
  return {
    type: scale,
    uirevision: JSON.stringify([revision, scale, ...limits]),
    range: autorange ? undefined : limits,
    autorange,
    ...(autorange && (lower !== null || upper !== null) && {
      autorangeoptions: { minallowed: limits[0] ?? undefined, maxallowed: limits[1] ?? undefined },
    }),
    title: { text: plotText(axis.label ?? label, axis.label_renderer, style), font: textFont(style, `${side}_label`, style.label_size), standoff: 8 },
    tickfont: textFont(style, `${side}_tick`, style.tick_size),
    ticks,
    ticklen: axis.tick_length,
    tickwidth: axis.line_width,
    tickcolor: style.text_color,
    tickangle: axis.angle,
    showticklabels: axis.tick_labels,
    ...(!categorical && {
      tickformat: format,
      exponentformat: axis.notation === "si" ? "SI" : axis.notation === "scientific" ? "power" : "none",
      showexponent: axis.notation === "scientific" ? "last" : "all",
      tickmode: step === null ? "auto" : "linear",
      ...(step === null ? {} : { dtick: step, tick0: 0 }),
      ...(axis.minor_ticks && {
        minor: {
          ticks,
          ticklen: axis.tick_length / 2,
          tickwidth: axis.line_width,
          tickcolor: style.text_color,
          ...(step !== null && scale === "linear" ? { tickmode: "linear", dtick: step / 5, tick0: 0 } : { tickmode: "auto" }),
        },
      }),
    }),
    automargin: true,
    showline: axis.line,
    linewidth: axis.line_width,
    linecolor: style.text_color,
    mirror: axis.line && axis.mirror ? (axis.opposite_ticks ?? true) ? "ticks" : true : false,
    showgrid: axis.grid,
    gridcolor: "#e0e0e0",
    zeroline: axis.zero_line,
    zerolinecolor: "#777777",
    zerolinewidth: 1,
    showspikes: axis.hover_ruler,
    spikemode: "across",
    spikecolor: "#777777",
    spikethickness: 1,
  };
}

function legendLayout(style: FigureStyle, fit: boolean): Partial<Layout> {
  const position = style.legend === "auto" ? (fit ? "above" : "none") : style.legend;
  if (position === "none") return { showlegend: false };
  const below = position.startsWith("bottom");
  const right = position.endsWith("right");
  return {
    showlegend: true,
    legend: {
      font: textFont(style, "legend", style.tick_size),
      bgcolor: style.legend_background ?? style.background,
      bordercolor: style.legend_border_color,
      borderwidth: style.legend_frame ? style.legend_border_width : 0,
      itemdoubleclick: false,
      ...(position === "above"
        ? { orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom" }
        : { x: right ? 0.98 : 0.02, y: below ? 0.02 : 0.98, xanchor: right ? "right" : "left", yanchor: below ? "bottom" : "top" }),
    },
  };
}

export function figureLayout(style: FigureStyle, xLabel: string, yLabel: string, revision: number, fit: boolean, categorical = false, fitLegend = false): Partial<Layout> {
  const x = axisLayout(style, style.x, xLabel, revision, "x", categorical);
  const y = axisLayout(style, style.y, yLabel, revision, "y");
  const font = style.font_family === figureFont ? figureFont : `"${style.font_family}", "${figureFont}"`;
  const above = style.legend === "above" || ((fit || fitLegend) && style.legend === "auto");
  const titleFont = textFont(style, "title", style.label_size + 2);
  const top = (style.title ? titleFont.size + 23 : 24) + (above ? (style.legend_size ?? style.tick_size) + 7 : 0);
  return {
    autosize: true,
    uirevision: revision,
    margin: { l: 54, r: 16, t: top, b: 50 },
    title: { text: plotText(style.title, style.title_renderer, style), font: titleFont, x: 0.5, y: 0.98, yanchor: "top" },
    font: { family: font, size: style.label_size, color: style.text_color,
      ...fontFace(style.font_face, style.font_bold, style.font_italic) },
    paper_bgcolor: style.background,
    plot_bgcolor: style.background,
    hovermode: "closest",
    dragmode: "zoom",
    ...legendLayout(style, fit || fitLegend),
    ...(fit
      ? {
          xaxis: { ...x, matches: "x2", title: { text: "" }, showticklabels: false },
          yaxis: { ...y, domain: [0.36, 1] },
          xaxis2: { ...x, anchor: "y2" },
          yaxis2: { ...axisLayout(style, style.y, "Residual", revision, "y"), domain: [0, 0.26] },
        }
      : { xaxis: x, yaxis: y }),
  };
}
