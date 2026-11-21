import { loadMathJax } from "./mathText";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Data, PlotlyHTMLElement, PlotMouseEvent, LegendClickEvent } from "plotly.js";
import { figureFont, figureLayout, plotText, type FigureStyle, type StyleSection } from "./figureStyle";
import type { FigureElement, PluginFigure } from "./workspace";

type Colors = Record<FigureElement, string>;
type Renderer = typeof import("plotly.js-basic-dist-min");

const config = { responsive: false, displayModeBar: false, doubleClick: "reset" as const };
const scatterFields = new Set(["type", "mode", "name", "x", "y", "xaxis", "yaxis", "showlegend", "legendgroup", "hoverinfo"]);
let webGLAvailable: boolean | undefined;

function canAccelerate(data: PluginFigure) {
  if (data.categorical_x || data.definition.checksum !== null) return false;
  if (!data.traces.every((trace) => trace.type === "scatter" && Object.keys(trace).every((key) => scatterFields.has(key)))) return false;
  if (data.traces.reduce((count, trace) => count + ("x" in trace ? trace.x?.length ?? 0 : 0), 0) < 10_000) return false;
  if (webGLAvailable === undefined) {
    const gl = document.createElement("canvas").getContext("webgl");
    webGLAvailable = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webGLAvailable;
}

async function loadRenderer(accelerated: boolean): Promise<Renderer> {
  await loadMathJax();
  const library = accelerated ? await import("plotly.js-gl2d-dist-min") : await import("plotly.js-basic-dist-min");
  return library.default ?? library;
}

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
  onSelect: (id: number, index: number) => void;
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
    return before === value || JSON.stringify(before) === JSON.stringify(value) ? [] : [[key, value]];
  }));
}

function styleTrace(trace: Data, style: FigureStyle, color: string): Data {
  if (trace.type === "bar") return merge(trace, { marker: { color }, width: style.bar_width });
  if (trace.type !== "scatter" && trace.type !== "scattergl") return trace;
  const marker = { color: style.marker_color ?? color, size: style.marker_size, symbol: style.marker_symbol };
  const line = { color: style.line_color ?? color, width: style.line_width, dash: style.line_dash };
  const mode = (trace.mode ?? "lines").split("+").filter((part) =>
    (part !== "markers" || style.show_markers) && (part !== "lines" || style.show_lines));
  return merge(trace, { marker, line, mode: mode.join("+") || "none" });
}

export function FigurePlot({ capture, data, colors, style, revision, onEdit, onSelect }: FigurePlotProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const plotly = useRef<Renderer | null>(null);
  const webGLFailed = useRef(false);
  const traces = useMemo(() => structuredClone(data.traces), [data]);
  const rendered = useRef<PlotlyHTMLElement | null>(null);
  const drawing = useRef<Promise<void>>(Promise.resolve());
  const lastDraw = useRef<{ data: PluginFigure; colors: Colors; style: FigureStyle; width: number; height: number } | null>(null);
  const lockedWidth = style.axes_width;
  const lockedHeight = style.axes_height;
  const width = lockedWidth ?? available.width;
  const height = lockedHeight ?? available.height;
  const visible = available.width > 0 && available.height > 0;

  useImperativeHandle(capture, () => {
    function currentFigure() {
      const graph = rendered.current;
      const renderer = plotly.current;
      if (!visible) {
        throw new Error("Open the Figure panel before exporting.");
      }
      if (!graph || !renderer || !graph.clientWidth || !graph.clientHeight) {
        throw new Error("Wait for the figure to finish drawing.");
      }
      return { graph, renderer, width: graph.clientWidth, height: graph.clientHeight };
    }

    return {
      async svg() {
        const { graph, renderer, width, height } = currentFigure();
        const accelerated = graph.data.some((trace) => trace.type === "scattergl");
        const vectorRenderer = accelerated ? await loadRenderer(false) : renderer;
        const figure = accelerated ? {
          data: graph.data.map((trace, index) => ({ ...trace, type: data.traces[index].type }) as Data),
          layout: graph.layout,
          config,
        } : graph;
        const url = await vectorRenderer.toImage(figure, { format: "svg", width, height });
        return decodeURIComponent(url.slice(url.indexOf(",") + 1));
      },
      snapshot() {
        const { graph, width, height } = currentFigure();
        const traces = graph.data.map((trace, index) => differences(data.traces[index] ?? {}, {
          ...trace, type: data.traces[index].type,
        }));
        return { traces, layout: differences(data.layout ?? {}, graph.layout), width, height };
      },
    };
  }, [data, visible]);

  useEffect(() => {
    const node = container.current!;
    const view = viewport.current!;
    function measure() {
      const width = view.clientWidth;
      const height = view.clientHeight;
      setAvailable((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    measure();
    return () => {
      observer.disconnect();
      plotly.current?.purge(node);
      rendered.current = null;
    };
  }, []);

  useEffect(() => {
    const node = container.current!;
    if (!visible) return;
    let active = true;
    let chart: PlotlyHTMLElement | undefined;
    const elements = data.elements ?? [];
    function selectPoint(event: PlotMouseEvent) {
      const index = event.points[0]?.curveNumber;
      if (index !== undefined) onSelect(revision, index);
    }
    function selectLegend(event: LegendClickEvent) {
      onSelect(revision, event.curveNumber);
      return false;
    }

    drawing.current = drawing.current.then(async () => {
      if (!active) return;
      const accelerated = !webGLFailed.current && canAccelerate(data);
      const [renderer] = await Promise.all([
        loadRenderer(accelerated),
        document.fonts.load(`12px "${figureFont}"`),
      ]);
      if (!active) return;
      const previous = lastDraw.current;
      if (previous?.data === data && previous.colors === colors && previous.style === style
        && previous.width === width && previous.height === height && rendered.current) {
        chart = rendered.current;
        chart.on("plotly_click", selectPoint);
        chart.on("plotly_legendclick", selectLegend);
        return;
      }
      const layout = merge(
        figureLayout(style, data.x_label ?? "", data.y_label ?? "", revision,
          !!data.residual_panel, !!data.categorical_x, data.part === "fit" || !!data.overlay_inputs),
        structuredClone(data.layout ?? {}),
      );
      const margin = layout.margin;
      let canvasWidth = Math.max(10, lockedWidth === null ? width : lockedWidth + (margin?.l ?? 0) + (margin?.r ?? 0));
      let canvasHeight = Math.max(10, lockedHeight === null ? height : lockedHeight + (margin?.t ?? 0) + (margin?.b ?? 0));
      function setCanvas() {
        node.style.width = `${canvasWidth}px`;
        node.style.height = `${canvasHeight}px`;
        return { width: canvasWidth, height: canvasHeight };
      }
      const series = traces.map((trace, index) => {
        const element = elements[index];
        const series = element ? styleTrace(trace, style, data.series_colors?.[index] ?? colors[element]) : trace;
        return typeof series.name === "string" && /\$[^$]+\$/.test(series.name)
          ? { ...series, name: plotText(series.name, "auto", style) } : series;
      });
      const options = { ...layout, ...setCanvas(), autosize: false };
      if (plotly.current && plotly.current !== renderer) plotly.current.purge(node);
      plotly.current = renderer;
      let next: PlotlyHTMLElement;
      try {
        const preview = accelerated ? series.map((trace): Data => ({ ...trace, type: "scattergl" } as Data)) : series;
        next = await renderer.react(node, preview, options, config);
      } catch (reason) {
        if (!accelerated) throw reason;
        renderer.purge(node);
        webGLFailed.current = true;
        const fallback = await loadRenderer(false);
        if (!active) return;
        plotly.current = fallback;
        next = await fallback.react(node, series, options, config);
      }
      // Adjust the canvas after Plotly measures the margins around the axes.
      for (let attempt = 0; active && attempt < 5 && (lockedWidth !== null || lockedHeight !== null); attempt++) {
        const actual = (next as PlotlyHTMLElement & { _fullLayout?: { _size?: { w: number; h: number } } })._fullLayout?._size;
        if (!actual) break;
        const nextWidth = lockedWidth === null ? canvasWidth : Math.max(10, Math.round(canvasWidth + lockedWidth - actual.w));
        const nextHeight = lockedHeight === null ? canvasHeight : Math.max(10, Math.round(canvasHeight + lockedHeight - actual.h));
        if (nextWidth === canvasWidth && nextHeight === canvasHeight) break;
        canvasWidth = nextWidth;
        canvasHeight = nextHeight;
        await plotly.current.relayout(next, setCanvas());
      }
      if (active) {
        lastDraw.current = { data, colors, style, width, height };
        chart = next;
        rendered.current = next;
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
  }, [data, traces, colors, style, revision, onSelect, width, height, lockedWidth, lockedHeight, visible]);

  return (
    <div className="chart-panel">
      {error && <p role="alert">Could not draw the figure. {error}</p>}
      <div className="plot-viewport" ref={viewport}>
        <div className="plot" ref={container} aria-label={data.definition.name}
        onDoubleClick={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest(".xtitle, .x2title")) onEdit("x");
          else if (target.closest(".ytitle")) onEdit("y");
          else if (target.closest(".y2title")) onEdit("y");
          else if (target.closest(".gtitle")) onEdit("figure");
        }}
        />
      </div>
    </div>
  );
}
