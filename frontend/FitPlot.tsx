import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Data, PlotData, Layout, PlotlyHTMLElement, PlotMouseEvent, LegendClickEvent } from "plotly.js";
import { figureFont, figureLayout, plotText, type FigureStyle, type StyleSection } from "./figureStyle";
import type { FigureElement, Fit, Plot } from "./workspace";

type Colors = Record<FigureElement, string>;

export interface FigureSnapshot {
  traces: Data[];
  layout: Partial<Layout>;
  width: number;
  height: number;
}

export interface CaptureFigure {
  svg: () => Promise<string>;
  snapshot: () => FigureSnapshot;
}

interface FigurePlotProps {
  capture: Ref<CaptureFigure>;
  data: Fit | Plot;
  xLabel: string;
  yLabel: string;
  colors: Colors;
  style: FigureStyle;
  revision: number;
  onEdit: (section: StyleSection) => void;
  onSelect: (element: FigureElement) => void;
}

const traces: FigureElement[] = ["observations", "fit", "observations"];

function makeTraces(fit: Fit, colors: Colors, style: FigureStyle): Data[] {
  // Extra vertices let Plotly detect clicks between observations on a fitted line.
  const order = fit.x.reduce(({ min, max }, x, index) => ({
    min: x < fit.x[min] ? index : min,
    max: x > fit.x[max] ? index : max,
  }), { min: 0, max: 0 });
  const fractions = Array.from({ length: 201 }, (_, index) => index / 200);
  const interpolate = (values: number[]) =>
    fractions.map((t) => (1 - t) * values[order.min] + t * values[order.max]);

  const marker = { color: colors.observations, size: style.marker_size, symbol: style.marker_symbol };
  return [
    { type: "scatter", mode: "markers", name: "Observations", x: fit.x, y: fit.y, marker },
    {
      type: "scatter", mode: "lines", name: "Linear fit",
      x: interpolate(fit.x), y: interpolate(fit.fitted),
      line: { color: colors.fit, width: style.line_width, dash: style.line_dash },
      hoverinfo: "none",
    },
    {
      type: "scatter", mode: "markers", name: "Residuals",
      x: fit.x, y: fit.residuals, xaxis: "x2", yaxis: "y2", marker, showlegend: false,
    },
  ];
}

function makePlotTraces(plot: Plot, label: string, color: string, style: FigureStyle, barLabels?: string[]): Data[] {
  const name = plotText(label);
  return barLabels
    ? [{
        type: "bar", name, x: barLabels.map((_, index) => index), y: plot.y_values,
        marker: { color }, width: style.bar_width, text: barLabels, hoverinfo: "y+text",
      }]
    : [{
        type: "scatter", name, x: plot.x_values, y: plot.y_values,
        mode: plot.plot_type === "line" ? "lines+markers" : "markers",
        marker: { color, size: style.marker_size, symbol: style.marker_symbol },
        line: { color, width: style.line_width, dash: style.line_dash },
      }];
}

export function FigurePlot({ capture, data, xLabel, yLabel, colors, style, revision, onEdit, onSelect }: FigurePlotProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const plotly = useRef<typeof import("plotly.js-basic-dist-min") | null>(null);
  const rendered = useRef<PlotlyHTMLElement | null>(null);
  const renderedData = useRef<Fit | Plot | null>(null);

  useImperativeHandle(capture, () => {
    function currentFigure() {
      const graph = rendered.current;
      const renderer = plotly.current;
      if (!graph || !renderer || !graph.clientWidth || !graph.clientHeight) {
        throw new Error("Open the Figure panel before exporting.");
      }
      if (renderedData.current !== data) throw new Error("Wait for the figure to finish drawing.");
      return { graph, renderer, width: graph.clientWidth, height: graph.clientHeight };
    }

    return {
      async svg() {
        const { graph, renderer, width, height } = currentFigure();
        const url = await renderer.toImage(graph, { format: "svg", width, height });
        return decodeURIComponent(url.slice(url.indexOf(",") + 1));
      },
      snapshot() {
        const { graph, width, height } = currentFigure();
        const traces = graph.data.map((trace) => {
          const style = { ...trace } as Partial<PlotData>;
          delete style.x;
          delete style.y;
          return style as Data;
        });
        return { traces, layout: graph.layout, width, height };
      },
    };
  }, [data]);

  useEffect(() => {
    const node = container.current!;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth && node.clientHeight && rendered.current) {
        void plotly.current?.Plots.resize(rendered.current);
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      plotly.current?.purge(node);
      rendered.current = null;
    };
  }, []);

  useEffect(() => {
    const node = container.current!;
    let active = true;
    let chart: PlotlyHTMLElement | undefined;
    const plot = "plot_type" in data ? data : null;
    const elements = plot ? ["observations" as const] : traces;
    function selectPoint(event: PlotMouseEvent) {
      const element = elements[event.points[0]?.curveNumber];
      if (element) onSelect(element);
    }
    function selectLegend(event: LegendClickEvent) {
      const element = elements[event.curveNumber];
      if (element) onSelect(element);
      return false;
    }

    void Promise.all([
      import("plotly.js-basic-dist-min"),
      document.fonts.load(`12px "${figureFont}"`),
    ]).then(async ([library]) => {
      if (!active) return;
      // The distribution exposes Plotly as its default export in Vite.
      const renderer = library.default ?? library;
      plotly.current = renderer;
      const barLabels = plot?.plot_type === "bar" ? plot.x_values.map((value) => plotText(String(value))) : undefined;
      const layout = figureLayout(style, xLabel, yLabel, revision, !plot, barLabels);
      const series = "plot_type" in data
        ? makePlotTraces(data, yLabel, colors.observations, style, barLabels)
        : makeTraces(data, colors, style);
      const next = await renderer.react(node, series, layout, {
        responsive: false,
        displayModeBar: false,
        doubleClick: "reset",
      });
      if (active) {
        chart = next;
        rendered.current = next;
        renderedData.current = data;
        chart.on("plotly_click", selectPoint);
        chart.on("plotly_legendclick", selectLegend);
        setError("");
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      active = false;
      chart?.removeAllListeners?.("plotly_click");
      chart?.removeAllListeners?.("plotly_legendclick");
    };
  }, [data, xLabel, yLabel, colors, style, revision, onSelect]);

  return (
    <div className="chart-panel">
      {error && <p role="alert">Could not draw the figure. {error}</p>}
      <div className="plot" ref={container} aria-label={"plot_type" in data ? "Worksheet plot" : "Linear fit and residuals"}
        onDoubleClick={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest(".xtitle, .x2title")) onEdit("x");
          else if (target.closest(".ytitle")) onEdit("y");
          else if (target.closest(".y2title")) onEdit("residual");
          else if (target.closest(".gtitle")) onEdit("figure");
        }}
      />
    </div>
  );
}
