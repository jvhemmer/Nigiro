import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Data, PlotlyHTMLElement, PlotMouseEvent, LegendClickEvent } from "plotly.js";
import { figureFont, figureLayout, type FigureStyle, type StyleSection } from "./figureStyle";
import type { FigureElement, PluginFigure } from "./workspace";

type Colors = Record<FigureElement, string>;

export interface FigureSnapshot {
  traces: object[];
  layout: object;
  width: number;
  height: number;
}

export interface CaptureFigure {
  svg: () => Promise<string>;
  snapshot: () => FigureSnapshot;
}

interface FigurePlotProps {
  capture: Ref<CaptureFigure>;
  data: PluginFigure;
  colors: Colors;
  style: FigureStyle;
  revision: number;
  onEdit: (section: StyleSection) => void;
  onSelect: (element: FigureElement) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function merge<T extends object>(base: T, patch: object): T {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(patch).map(([key, value]) => {
      const before: unknown = Object.hasOwn(base, key) ? base[key as keyof T] : undefined;
      return [key, isRecord(before) && isRecord(value) ? merge(before, value) : value];
    })),
  };
}

// Keep view changes while the replay script regenerates the plugin data.
function differences(base: object, current: object): object {
  return Object.fromEntries(Object.entries(current).flatMap(([key, value]) => {
    const before: unknown = Object.hasOwn(base, key) ? base[key as keyof typeof base] : undefined;
    if (isRecord(before) && isRecord(value)) {
      const nested = differences(before, value);
      return Object.keys(nested).length ? [[key, nested]] : [];
    }
    return JSON.stringify(before) === JSON.stringify(value) ? [] : [[key, value]];
  }));
}

function styleTrace(trace: Data, style: FigureStyle, color: string): Data {
  if (trace.type === "bar") return merge(trace, { marker: { color }, width: style.bar_width });
  if (trace.type !== "scatter") return trace;
  const marker = { color, size: style.marker_size, symbol: style.marker_symbol };
  const line = { color, width: style.line_width, dash: style.line_dash };
  return merge(trace, { marker, line });
}

export function FigurePlot({ capture, data, colors, style, revision, onEdit, onSelect }: FigurePlotProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const plotly = useRef<typeof import("plotly.js-basic-dist-min") | null>(null);
  const rendered = useRef<PlotlyHTMLElement | null>(null);
  const renderedData = useRef<PluginFigure | null>(null);

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
        const traces = graph.data.map((trace, index) => differences(data.traces[index] ?? {}, trace));
        return { traces, layout: differences(data.layout ?? {}, graph.layout), width, height };
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
    const elements = data.elements ?? [];
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
      const layout = merge(
        figureLayout(style, data.x_label ?? "", data.y_label ?? "", revision, !!data.residual_panel, !!data.categorical_x),
        structuredClone(data.layout ?? {}),
      );
      const series = structuredClone(data.traces).map((trace, index) => {
        const element = elements[index];
        return element ? styleTrace(trace, style, colors[element]) : trace;
      });
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
  }, [data, colors, style, revision, onSelect]);

  return (
    <div className="chart-panel">
      {error && <p role="alert">Could not draw the figure. {error}</p>}
      <div className="plot" ref={container} aria-label={data.definition.name}
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
