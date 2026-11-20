import { useEffect, useRef, useState } from "react";
import type { Data, Layout, PlotlyHTMLElement, PlotMouseEvent, LegendClickEvent } from "plotly.js";
import type { FigureElement, Fit } from "./workspace";

type Colors = Record<FigureElement, string>;

interface FitPlotProps {
  fit: Fit;
  xLabel: string;
  yLabel: string;
  colors: Colors;
  onSelect: (element: FigureElement) => void;
}

const traces: FigureElement[] = ["observations", "fit", "observations"];

function plotText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function makeTraces(fit: Fit, colors: Colors): Data[] {
  // Extra vertices let Plotly detect clicks between observations on a fitted line.
  const order = fit.x.reduce(({ min, max }, x, index) => ({
    min: x < fit.x[min] ? index : min,
    max: x > fit.x[max] ? index : max,
  }), { min: 0, max: 0 });
  const fractions = Array.from({ length: 201 }, (_, index) => index / 200);
  const interpolate = (values: number[]) =>
    fractions.map((t) => (1 - t) * values[order.min] + t * values[order.max]);

  const marker = { color: colors.observations, size: 7 };
  return [
    { type: "scatter", mode: "markers", name: "Observations", x: fit.x, y: fit.y, marker },
    {
      type: "scatter", mode: "lines", name: "Linear fit",
      x: interpolate(fit.x), y: interpolate(fit.fitted),
      line: { color: colors.fit, width: 2.5 },
      hoverinfo: "none",
    },
    {
      type: "scatter", mode: "markers", name: "Residuals",
      x: fit.x, y: fit.residuals, xaxis: "x2", yaxis: "y2", marker, showlegend: false,
    },
  ];
}

function makeLayout(xLabel: string, yLabel: string): Partial<Layout> {
  const axis = { gridcolor: "#e8eaf4", linecolor: "#c8ccdf", showline: true, zeroline: false, automargin: true };
  return {
    autosize: true,
    margin: { l: 64, r: 20, t: 32, b: 60 },
    font: { family: "system-ui, sans-serif", size: 12, color: "#414a68" },
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    hovermode: "closest",
    dragmode: "zoom",
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", itemdoubleclick: false },
    xaxis: { ...axis, matches: "x2", showticklabels: false },
    yaxis: { ...axis, domain: [0.33, 1], title: { text: plotText(yLabel) } },
    xaxis2: { ...axis, anchor: "y2", title: { text: plotText(xLabel) } },
    yaxis2: { ...axis, domain: [0, 0.25], title: { text: "Residual" }, zeroline: true, zerolinecolor: "#a0a7bc" },
    uirevision: `${xLabel}\u0000${yLabel}`,
  };
}

export function FitPlot({ fit, xLabel, yLabel, colors, onSelect }: FitPlotProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const plotly = useRef<typeof import("plotly.js-basic-dist-min") | null>(null);
  const rendered = useRef<PlotlyHTMLElement | null>(null);

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
    function selectPoint(event: PlotMouseEvent) {
      const element = traces[event.points[0]?.curveNumber];
      if (element) onSelect(element);
    }
    function selectLegend(event: LegendClickEvent) {
      const element = traces[event.curveNumber];
      if (element) onSelect(element);
      return false;
    }

    void import("plotly.js-basic-dist-min").then(async (library) => {
      if (!active) return;
      // The distribution exposes Plotly as its default export in Vite.
      const renderer = library.default ?? library;
      plotly.current = renderer;
      const next = await renderer.react(node, makeTraces(fit, colors), makeLayout(xLabel, yLabel), {
        responsive: false,
        displayModeBar: false,
        doubleClick: "reset",
      });
      if (active) {
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
  }, [fit, xLabel, yLabel, colors, onSelect]);

  return (
    <div className="chart-panel">
      {error && <p role="alert">Could not draw the figure. {error}</p>}
      <div className="plot" ref={container} aria-label="Linear fit and residuals" />
    </div>
  );
}
