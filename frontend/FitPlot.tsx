import { decodePlotText, formatPlotTicks, plotText } from "./plotText.mjs";
import { loadMathJax } from "./mathText";
import { useRevealDockPanel } from "./DockWorkspace";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Data, PlotlyHTMLElement, PlotMouseEvent, LegendClickEvent } from "plotly.js";
import { cycleColor, figureFont, figureLayout, tickRenderers, type FigureStyle, type StyleSection, type TextRenderer } from "./figureStyle";
import type { FigureElement, PluginFigure, TraceLineStyle } from "./workspace";

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
  uses_math: boolean;
  tick_renderers: Record<string, TextRenderer>;
  tick_math: Pick<FigureStyle, "math_alphabet" | "math_preamble">;
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
  traceStyles: ProjectTraceStyles;
  revision: number;
  onEdit: (section: StyleSection) => void;
  onSelect: (id: number, index: number) => void;
  onInspect: (id: number) => void;
}

type ProjectTraceStyles = Record<number, TraceLineStyle>;

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

export function hasEditableLine(trace: Data): boolean {
  return (trace.type === "scatter" || trace.type === "scattergl" || trace.type == null)
    && (!("mode" in trace) || (trace.mode ?? "lines").includes("lines"));
}

export function traceAppearance(
  trace: Data, index: number, data: PluginFigure, style: FigureStyle, colors: Colors, override?: TraceLineStyle,
): { name?: string; marker?: object; line?: Partial<TraceLineStyle>; mode?: string; width?: number } {
  const element = data.elements?.[index];
  const custom = cycleColor(style, data.series_cycle?.[index]);
  const color = custom ?? data.series_colors?.[index] ?? (element ? colors[element] : undefined);
  const renderer = style.legend_renderer ?? "auto";
  const name = typeof trace.name === "string" && (renderer !== "auto" || /\$[^$]+\$/.test(trace.name))
    ? { name: plotText(decodePlotText(trace.name), renderer, style) } : {};
  if (trace.type === "bar" && color && (element || custom)) {
    return { ...name, marker: { color }, ...(element && { width: style.bar_width }) };
  }
  if ((trace.type === "scatter" || trace.type === "scattergl") && color) {
    if (element) {
      const marker = { color: style.marker_color ?? color, size: style.marker_size, symbol: style.marker_symbol };
      const line = { color: style.line_color ?? color, width: style.line_width, dash: style.line_dash, ...override };
      const mode = (trace.mode ?? "lines").split("+").filter((part) =>
        (part !== "markers" || style.show_markers) && (part !== "lines" || style.show_lines));
      return { ...name, marker, line, mode: mode.join("+") || "none" };
    }
    if (custom) return { ...name, marker: { color }, line: { color, ...override } };
  }
  return override ? { ...name, line: override } : name;
}

export function FigurePlot({ capture, data, colors, style, traceStyles, revision, onEdit, onSelect, onInspect }: FigurePlotProps) {
  const reveal = useRevealDockPanel();
  const viewport = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const selectedTrace = useRef(false);
  const plotly = useRef<Renderer | null>(null);
  const webGLFailed = useRef(false);
  const traces = useMemo(() => structuredClone(data.traces), [data]);
  const rendered = useRef<PlotlyHTMLElement | null>(null);
  const drawing = useRef<Promise<void>>(Promise.resolve());
  const lastDraw = useRef<{ data: PluginFigure; colors: Colors; style: FigureStyle; traceStyles: ProjectTraceStyles; width: number; height: number } | null>(null);
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
        const traces = data.traces.map((trace, index) => {
          const current = graph.data[index];
          const visible = current && "visible" in current ? current.visible : undefined;
          return {
            ...traceAppearance(trace, index, data, style, colors, traceStyles[index]),
            ...(visible !== undefined && (!("visible" in trace) || visible !== trace.visible) && { visible }),
          };
        });
        const renderers = tickRenderers(data.layout ?? {}, style);
        const tick_math = { math_alphabet: style.math_alphabet, math_preamble: style.math_preamble };
        const usesMath = (text: unknown) => typeof text === "string" && /\$[^$]+\$/.test(text);
        const layout = Object.fromEntries(Object.entries(graph.layout).map(([key, axis]) => {
          if (!(key in renderers) || !isRecord(axis)) return [key, axis];
          const presentation = { ...axis };
          delete presentation.tickvals;
          delete presentation.ticktext;
          return [key, presentation];
        }));
        const uses_math = graph.data.some((trace) => usesMath(trace.name))
          || Object.entries(graph.layout).some(([key, axis]) => key in renderers && isRecord(axis)
            && Array.isArray(axis.ticktext) && axis.ticktext.some(usesMath));
        return { traces, layout: differences(data.layout ?? {}, layout), width, height, uses_math, tick_renderers: renderers, tick_math };
      },
    };
  }, [colors, data, style, traceStyles, visible]);

  useEffect(() => {
    const node = container.current!;
    const view = viewport.current!;
    const scroll = scrollArea.current!;
    const frame = canvas.current!;
    let zoom = 1;
    function sizeFrame() {
      frame.style.width = `${node.offsetWidth * zoom}px`;
      frame.style.height = `${node.offsetHeight * zoom}px`;
    }
    function zoomPreview(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (!rendered.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1;
      const next = Math.max(1, Math.min(4, zoom * Math.exp(-event.deltaY * unit * 0.002)));
      if (next === zoom) return;
      const bounds = scroll.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const left = (scroll.scrollLeft + x) * next / zoom - x;
      const top = (scroll.scrollTop + y) * next / zoom - y;
      zoom = next;
      node.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
      sizeFrame();
      scroll.scrollTo(left, top);
    }
    function measure() {
      const width = view.clientWidth;
      const height = view.clientHeight;
      setAvailable((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    const canvasObserver = new ResizeObserver(sizeFrame);
    canvasObserver.observe(node);
    scroll.addEventListener("wheel", zoomPreview, { passive: false, capture: true });
    measure();
    return () => {
      observer.disconnect();
      canvasObserver.disconnect();
      scroll.removeEventListener("wheel", zoomPreview, true);
      plotly.current?.purge(node);
      rendered.current = null;
    };
  }, []);

  useEffect(() => {
    const node = container.current!;
    if (!visible) return;
    let active = true;
    let chart: PlotlyHTMLElement | undefined;
    function selectPoint(event: PlotMouseEvent) {
      const index = event.points[0]?.curveNumber;
      if (index !== undefined) {
        selectedTrace.current = true;
        onSelect(revision, index);
      }
    }
    function selectLegend(event: LegendClickEvent) {
      selectedTrace.current = true;
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
        && previous.traceStyles === traceStyles && previous.width === width && previous.height === height && rendered.current) {
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
      if (style.plot_background === "transparent" && style.background !== "transparent"
        && traces.some((trace) => trace.type == null || ["scatter", "scattergl", "bar"].includes(trace.type))) {
        // Plotly paints paper behind the axes. Leave a hole in that paper
        // so a transparent plot area also stays transparent in an export.
        layout.shapes = [{
          type: "path", xref: "paper", yref: "paper", layer: "below",
          path: "M -100,-100 L 100,-100 L 100,100 L -100,100 Z M 0,0 L 0,1 L 1,1 L 1,0 Z",
          fillcolor: style.background, line: { width: 0 },
        }, ...(layout.shapes ?? [])];
        layout.paper_bgcolor = "rgba(0,0,0,0)";
      }
      formatPlotTicks(layout, tickRenderers(layout, style), style);
      const margin = layout.margin;
      let canvasWidth = Math.max(10, lockedWidth === null ? width : lockedWidth + (margin?.l ?? 0) + (margin?.r ?? 0));
      let canvasHeight = Math.max(10, lockedHeight === null ? height : lockedHeight + (margin?.t ?? 0) + (margin?.b ?? 0));
      function setCanvas() {
        node.style.width = `${canvasWidth}px`;
        node.style.height = `${canvasHeight}px`;
        return { width: canvasWidth, height: canvasHeight };
      }
      const series = traces.map((trace, index) => merge(trace, traceAppearance(trace, index, data, style, colors, traceStyles[index])));
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
        lastDraw.current = { data, colors, style, traceStyles, width, height };
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
  }, [data, traces, colors, style, traceStyles, revision, onSelect, width, height, lockedWidth, lockedHeight, visible]);

  return (
    <div className="chart-panel">
      {error && <p role="alert">Could not draw the figure. {error}</p>}
      <div className="plot-viewport" ref={viewport}>
        <div className="plot-scroll-area" ref={scrollArea}>
          <div className="plot-canvas" ref={canvas}>
            <div className="plot" ref={container} aria-label={data.definition.name}
              onPointerDownCapture={() => { selectedTrace.current = false; }}
              onClick={() => {
                if (!selectedTrace.current) onInspect(revision);
                reveal("analysis");
              }}
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
      </div>
    </div>
  );
}
