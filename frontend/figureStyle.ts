import type { Layout, LayoutAxis } from "plotly.js";

export type AxisKey = "x" | "y" | "residual";
export type StyleSection = "figure" | AxisKey;

export interface AxisStyle {
  label: string | null;
  scale: "linear" | "log";
  lower: number | null;
  upper: number | null;
  step: number | null;
  format: string;
  angle: number;
  ticks: "outside" | "inside" | "none";
  tick_length: number;
  tick_labels: boolean;
  minor_ticks: boolean;
  line: boolean;
  line_width: number;
  mirror: boolean;
  grid: boolean;
  zero_line: boolean;
  hover_ruler: boolean;
}

export interface FigureStyle {
  title: string;
  font_family: string;
  label_size: number;
  tick_size: number;
  text_color: string;
  background: string;
  legend: "auto" | "none" | "above" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
  line_width: number;
  line_dash: "solid" | "dash" | "dot" | "dashdot";
  marker_size: number;
  marker_symbol: "circle" | "square" | "diamond" | "triangle-up" | "cross";
  bar_width: number;
  x: AxisStyle;
  y: AxisStyle;
  residual: AxisStyle;
}

export const figureFont = "DejaVu Sans";

export function plotText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
}

function axisLayout(style: FigureStyle, axis: AxisStyle, label: string, revision: number, categorical = false): Partial<LayoutAxis> {
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
    title: { text: plotText(axis.label ?? label), font: { size: style.label_size }, standoff: 8 },
    tickfont: { size: style.tick_size },
    ticks,
    ticklen: axis.tick_length,
    tickwidth: axis.line_width,
    tickcolor: style.text_color,
    tickangle: axis.angle,
    showticklabels: axis.tick_labels,
    ...(!categorical && {
      tickformat: format,
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
    mirror: axis.line && axis.mirror ? "ticks" : false,
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
      font: { size: style.tick_size },
      bgcolor: style.background,
      itemdoubleclick: false,
      ...(position === "above"
        ? { orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom" }
        : { x: right ? 0.98 : 0.02, y: below ? 0.02 : 0.98, xanchor: right ? "right" : "left", yanchor: below ? "bottom" : "top" }),
    },
  };
}

export function figureLayout(style: FigureStyle, xLabel: string, yLabel: string, revision: number, fit: boolean, barLabels?: string[]): Partial<Layout> {
  const x = axisLayout(style, style.x, xLabel, revision, barLabels !== undefined);
  const y = axisLayout(style, style.y, yLabel, revision);
  const font = style.font_family === figureFont ? figureFont : `"${style.font_family}", "${figureFont}"`;
  const above = style.legend === "above" || (fit && style.legend === "auto");
  const top = style.title ? style.label_size + 25 + (above ? style.tick_size + 7 : 0) : 24;
  return {
    autosize: true,
    uirevision: revision,
    margin: { l: 54, r: 16, t: top, b: 50 },
    title: { text: plotText(style.title), font: { size: style.label_size + 2 }, x: 0.5, y: 0.98, yanchor: "top" },
    font: { family: font, size: style.label_size, color: style.text_color },
    paper_bgcolor: style.background,
    plot_bgcolor: style.background,
    hovermode: "closest",
    dragmode: "zoom",
    ...legendLayout(style, fit),
    ...(fit
      ? {
          xaxis: { ...x, matches: "x2", title: { text: "" }, showticklabels: false },
          yaxis: { ...y, domain: [0.36, 1] },
          xaxis2: { ...x, anchor: "y2" },
          yaxis2: { ...axisLayout(style, style.residual, "Residual", revision), domain: [0, 0.26] },
        }
      : {
          xaxis: {
            ...x,
            ...(barLabels && { tickmode: "array", tickvals: barLabels.map((_, index) => index), ticktext: barLabels }),
          },
          yaxis: y,
        }),
  };
}
