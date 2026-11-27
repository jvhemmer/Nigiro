import { actionIcons, pluginIcon } from "./actionIcons";
import { decodePlotText } from "./plotText.mjs";
import { ColorField, isHexColor, plotlyColor } from "./ColorField";
import { InspectField, InspectNumber } from "./InspectField";
import { describeCircuit } from "./CircuitDesigner";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type MouseEvent, type Ref } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import appLogo from "../proposed-logos/data-matrix.svg";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Calculator, ChartLine, ChartNoAxesCombined, Database, FileCode2, FileInput,
  FileOutput, FilePlus, FlaskConical, FolderOpen, FolderPlus, History, Info, PackagePlus, Play,
  NotebookPen, Save, SaveAll, ScanSearch, Settings2, Table2, Workflow as WorkflowIcon,
} from "lucide-react";
import { DockWorkspace, useRevealDockPanel } from "./DockWorkspace";
import { CommandSearch } from "./CommandSearch";
import { NotesPanel } from "./NotesPanel";
import { ProjectBreadcrumb } from "./ProjectBreadcrumb";
import { dragTitleBar, WindowControls } from "./WindowControls";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { ExportDialog } from "./ExportDialog";
import { OverlayDialog } from "./OverlayDialog";
import { applyAppearance, cacheAppearance } from "./appearance";
import { arrayFormulaId, columnFormulaId } from "./FormulaEditor";
import { ArraySourceDialog } from "./ArraySourceDialog";
import { ScalarSourceDialog } from "./ScalarSourceDialog";
import { ImportDataDialog } from "./ImportDataDialog";
import { FigureSettings } from "./FigureSettings";
import { defaultProjectStorage, ProjectProperties } from "./ProjectStorageSettings";
import type { DesktopInfo, DesktopPreferences, Release } from "./DesktopSettings";
import { axisSettings, cycleColor, type StyleSection } from "./figureStyle";
import { FigurePlot, fillAppearance, hasEditableLine, hasTraceFill, traceAppearance, traceOrderIndex, type CaptureFigure } from "./FitPlot";
import { ItemDialog, type ItemAction } from "./ItemDialog";
import { saveFigure, type ExportSettings, type ExportTarget } from "./exportFigure";
import { MenuBar, type Menu, type MenuCommand, type MenuRequest } from "./MenuBar";
import { columnFields, InputOptionsDialog, supportsPairedSources } from "./InputOptionsDialog";
import { SourcesPanel } from "./SourcesPanel";
import { ViewTabs, viewTabId } from "./ViewTabs";
import { statusLabels, WorkflowPanel, WorkflowStepDialog } from "./WorkflowPanel";
import { EditWorkflowPortsDialog, EditWorkflowRunDialog, ProjectWorkflowDialog, RunWorkflowDialog } from "./WorkflowDialogs";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, lineDashes, replacesProject, workspace,
  type FigureElement, type ImportReview, type InspectStyleChange, type PluginDefinition, type PluginRun, type PluginStepInputs, type Project, type ProjectWorkflowContext, type ProjectWorkflowPreview, type Request, type SavedWorkflow, type TraceFillStyle, type TraceLegendStyle, type TraceLineStyle, type TraceStyle, type WorkflowPorts, type WorkflowStep, type WorkspaceItem,
} from "./workspace";

type Run = (request: Request) => Promise<boolean>;

function matchesPlugin(run: PluginRun, plugin: PluginDefinition) {
  return run.plugin_id === plugin.id && run.version === plugin.version && run.checksum === plugin.checksum;
}

function projectStem(project: Project) {
  const fileName = (project.file_name ?? project.source_name ?? "Untitled").split(/[\\/]/).at(-1);
  return fileName?.replace(/\.[^.]+$/, "") || "Analysis";
}

function saveRequest(project: Project): Request {
  return project.file_name ? { action: "save" } : { action: "save_as", name: projectStem(project) };
}

function hasProjectChanges(project: Project | null, notes: string | null) {
  return !!project?.dirty || (notes !== null && notes !== (project?.notes ?? ""));
}

function confirmDiscard(projectDirty: boolean, workspaceDirty: boolean) {
  const target = projectDirty && workspaceDirty ? "the project and workspace" : workspaceDirty ? "this workspace" : "this project";
  return confirm(`Discard the unsaved changes to ${target}?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard changes",
    cancelLabel: "Cancel",
  });
}

function TraceInspectForm({ figureId, index, initialLine, initialFill, initialLegend, orderIndex, initialOrder, override,
  storedOrder, elementColor, busy, run }: {
  figureId: number;
  index: number;
  initialLine?: TraceLineStyle;
  initialFill?: TraceFillStyle;
  initialLegend?: TraceLegendStyle;
  orderIndex?: number;
  initialOrder: number;
  override?: TraceStyle;
  storedOrder?: number;
  elementColor?: { element: FigureElement; color: string };
  busy: boolean;
  run: Run;
}) {
  const storedLine = { color: override?.color, width: override?.width, dash: override?.dash };
  const storedFill = override?.fill ?? {};
  const storedLegend = override?.legend ?? {};
  const [line, setLine] = useState<Partial<TraceLineStyle>>(storedLine);
  const [fill, setFill] = useState<Partial<TraceFillStyle>>(storedFill);
  const [legend, setLegend] = useState<Partial<TraceLegendStyle>>(storedLegend);
  const [order, setOrder] = useState<string | null>(storedOrder === undefined ? null : String(storedOrder));
  const [color, setColor] = useState(elementColor?.color);
  const edits: InspectStyleChange[] = [];
  if (line.color !== storedLine.color || line.width !== storedLine.width || line.dash !== storedLine.dash) {
    edits.push({ action: "trace_style", trace: index, kind: "line",
      style: line.color === undefined && line.width === undefined && line.dash === undefined ? null : line });
  }
  if (fill.color !== storedFill.color || fill.opacity !== storedFill.opacity) {
    edits.push({ action: "trace_style", trace: index, kind: "fill",
      style: fill.color === undefined && fill.opacity === undefined ? null : fill });
  }
  if (legend.name !== storedLegend.name || legend.showlegend !== storedLegend.showlegend) {
    edits.push({ action: "trace_style", trace: index, kind: "legend",
      style: legend.name === undefined && legend.showlegend === undefined ? null : legend });
  }
  if (orderIndex !== undefined && (order === "" || (order === null ? storedOrder !== undefined : Number(order) !== storedOrder))) {
    edits.push({ action: "trace_style", trace: orderIndex, kind: "order",
      style: order === null ? null : { zorder: Number(order) } });
  }
  if (elementColor && color && color !== elementColor.color) edits.push({ action: "color", element: elementColor.element, color });
  const valid = (line.width === undefined || (line.width >= 0.1 && line.width <= 12))
    && (fill.opacity === undefined || (fill.opacity >= 0 && fill.opacity <= 1))
    && (order === null || (order !== "" && Number.isInteger(Number(order)) && Math.abs(Number(order)) <= 10000));

  return <form className="fit-settings trace-line-editor" noValidate onSubmit={(event) => {
    event.preventDefault();
    if (valid && !busy) void run({ action: "inspect_style", figure_id: figureId, trace: index, changes: edits });
  }} onKeyDown={(event) => {
    const target = event.target;
    if (event.key === "Enter" && !event.nativeEvent.isComposing &&
      (target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && (target.type === "number" || edits.length > 0)))) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }}>
    {initialLine && <>
      <InspectField label="Line color" disabled={busy}
        revert={line.color === undefined ? undefined : () => setLine({ ...line, color: undefined })}>
        {(id) => <ColorField id={id} label="Line color" value={line.color ?? initialLine.color} disabled={busy}
          onChange={(color) => setLine({ ...line, color })} />}
      </InspectField>
      <InspectField label="Line width (px)" disabled={busy}
        revert={line.width === undefined ? undefined : () => setLine({ ...line, width: undefined })}>
        {(id) => <InspectNumber id={id} min={0.1} max={12} increment={0.1} disabled={busy}
          value={Number.isFinite(line.width ?? initialLine.width) ? line.width ?? initialLine.width : ""}
          onChange={(value) => setLine({ ...line, width: value === "" ? NaN : Number(value) })} />}
      </InspectField>
      <InspectField label="Line style" disabled={busy}
        revert={line.dash === undefined ? undefined : () => setLine({ ...line, dash: undefined })}>
        {(id) => <select id={id} value={line.dash ?? initialLine.dash} disabled={busy}
          onChange={(event) => setLine({ ...line, dash: event.target.value as TraceLineStyle["dash"] })}>
          {Object.entries(lineDashes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
      </InspectField>
    </>}
    {initialLegend && <>
      <InspectField label="Show in legend" disabled={busy}
        revert={legend.showlegend === undefined ? undefined : () => setLegend({ ...legend, showlegend: undefined })}>
        {(id) => <input id={id} type="checkbox" checked={legend.showlegend ?? initialLegend.showlegend} disabled={busy}
          onChange={(event) => setLegend({ ...legend, showlegend: event.target.checked })} />}
      </InspectField>
      <InspectField label="Legend desc." disabled={busy}
        revert={legend.name === undefined ? undefined : () => setLegend({ ...legend, name: undefined })}>
        {(id) => <input id={id} type="text" value={legend.name ?? initialLegend.name} disabled={busy}
          onChange={(event) => setLegend({ ...legend, name: event.target.value })} />}
      </InspectField>
    </>}
    {initialFill && <>
      <InspectField label="Fill color" disabled={busy}
        revert={fill.color === undefined ? undefined : () => setFill({ ...fill, color: undefined })}>
        {(id) => <ColorField id={id} label="Fill color" value={fill.color ?? initialFill.color} disabled={busy}
          onChange={(color) => setFill({ ...fill, color })} />}
      </InspectField>
      <InspectField label="Fill opacity (%)" disabled={busy}
        revert={fill.opacity === undefined ? undefined : () => setFill({ ...fill, opacity: undefined })}>
        {(id) => <InspectNumber id={id} min={0} max={100} increment={1} disabled={busy}
          value={Number.isFinite(fill.opacity ?? initialFill.opacity) ? Math.round((fill.opacity ?? initialFill.opacity) * 1e8) / 1e6 : ""}
          onChange={(value) => setFill({ ...fill, opacity: value === "" ? NaN : Number(value) / 100 })} />}
      </InspectField>
    </>}
    {orderIndex !== undefined && <InspectField label="Draw order (Z)" disabled={busy}
      title="Higher values draw in front. A shaded area and its baseline share an order."
      revert={order === null ? undefined : () => setOrder(null)}>
      {(id) => <InspectNumber id={id} min={-10000} max={10000} increment={1} disabled={busy}
        value={order ?? initialOrder} onChange={setOrder} />}
    </InspectField>}
    {elementColor && <InspectField label={`${elementNames[elementColor.element]} color`}>
      {(id) => <ColorField id={id} label={`${elementNames[elementColor.element]} color`}
        value={color ?? elementColor.color} onChange={setColor} disabled={busy} />}
    </InspectField>}
    <div className="trace-line-actions">
      <button className="primary" type="submit" disabled={busy || !valid}>Apply</button>
    </div>
  </form>;
}

type Inspection =
  | { kind: "source"; id: string | null }
  | { kind: "step"; id: number }
  | { kind: "figure"; id: number; trace?: number };

function FigurePanel({ project, onSelect, onInspect, onEdit, busy, capture, run }: {
  project: Project;
  onSelect: (id: number, trace: number) => void;
  onInspect: (id: number) => void;
  onEdit: (section: StyleSection) => void;
  busy: boolean;
  run: Run;
  capture: Ref<CaptureFigure>;
}) {
  const panelId = useId();
  const data = project.figure;
  const summary = Object.entries(data?.summary ?? {});
  const figureId = project.figure_id;
  const previousFigure = useRef(figureId);
  const reveal = useRevealDockPanel();
  useEffect(() => {
    if (figureId !== null && previousFigure.current !== figureId) reveal("figure");
    previousFigure.current = figureId;
  }, [figureId, reveal]);
  const charts = useRef(new Map<number, Project>());
  for (const [id, stored] of charts.current) {
    const current = project.figures.find((figure) => figure.id === id);
    if (!current || (current.token && stored.figure_token !== current.token)) charts.current.delete(id);
  }
  if (data && figureId !== null) {
    charts.current.delete(figureId);
    charts.current.set(figureId, project);
  }
  while (charts.current.size > 3) charts.current.delete(charts.current.keys().next().value!);


  return (
    <div className="figure-pane">
      {project.figures.length > 0 && (
        <div className="view-picker">
          <ViewTabs id={panelId} label="Figures" kind="figure" items={project.figures} selected={figureId} busy={busy}
            onSelect={(id) => { if (id !== null) { onInspect(id); if (id !== figureId) void run({ action: "select_figure", figure_id: id }); } }} />
          {data && <button type="button" disabled={busy} onClick={() => onEdit("figure")}>Figure settings…</button>}
        </div>
      )}
      <div className="figure-content" id={panelId} role={figureId !== null ? "tabpanel" : undefined}
        aria-labelledby={figureId !== null ? viewTabId(panelId, figureId) : undefined}>
        {data && figureId !== null ? (
          <>
            {[...charts.current].map(([id, stored]) => (
              <div key={id} className="cached-figure" hidden={id !== figureId}>
                <FigurePlot
                  capture={id === figureId ? capture : null}
                  data={stored.figure!}
                  colors={stored.colors}
                  style={stored.figure_style}
                  traceStyles={stored.trace_styles}
                  revision={id}
                  onEdit={onEdit}
                  onSelect={onSelect}
                  onInspect={onInspect}
                />
              </div>
            ))}
            {summary.length > 0 && <dl className="fit-summary">
              {summary.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{typeof value === "number" || value === null ? formatNumber(value) : String(value)}</dd></div>
              ))}
            </dl>}
          </>
        ) : (
          <div className="empty-figure">
            <ChartNoAxesCombined size={36} strokeWidth={1.5} />
            {project.figure_error
              ? <p role="alert">{project.figure_error}</p>
              : <p>Choose a command from <strong>Plot</strong> or <strong>Analysis</strong>.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function InspectPanel({ project, inspection, busy, run, onConfigure, onEditStep, onInspectFigure, onInspectTrace }: {
  project: Project;
  inspection: Inspection | null;
  busy: boolean;
  run: Run;
  onConfigure?: () => void;
  onEditStep: (step: WorkflowStep) => void;
  onInspectFigure: (id: number) => void;
  onInspectTrace: (id: number, trace: number) => void;
}) {
  const source = inspection?.kind === "source" ? project.sources.find(({ id }) => id === inspection.id) : undefined;
  if (source) {
    const arrayStep = project.workflow.steps.find(({ id }) => id === source.array_step);
    return <div className="inspector inspect-details">
      <h2>{source.name}</h2>
      <dl>
        <dt>Type</dt><dd>{arrayStep ? "Array" : source.scalar ? "Variable" : source.kind === "raw" ? "Imported data" : "Derived data"}</dd>
        {source.original_path && <><dt>Original path</dt><dd>{source.original_path}</dd></>}
        {source.workflow_run && <><dt>Workflow run</dt><dd>{source.workflow_run}</dd></>}
        {source.detail && <><dt>{source.workflow_run && source.kind === "derived" ? "Original formula" : "Definition"}</dt>
          <dd>{source.detail}</dd></>}
        {source.scalar_formula && <><dt>Formula</dt><dd>= {source.scalar_formula}</dd></>}
        {source.comment && <><dt>Comment</dt><dd className="inspect-comment">{source.comment}</dd></>}
        <dt>Rows</dt><dd>{source.row_count.toLocaleString()}</dd>
        <dt>Columns</dt><dd>{source.columns.join(", ")}</dd>
      </dl>
      {arrayStep && <button type="button" disabled={busy} onClick={() => onEditStep(arrayStep)}>Edit Array…</button>}
    </div>;
  }
  if (inspection?.kind === "step") {
    const position = project.workflow.steps.findIndex(({ id }) => id === inspection.id);
    const step = project.workflow.steps[position];
    if (step) return <div className="inspector inspect-details">
      <h2>{step.label}</h2>
      <dl>
        <dt>Step</dt><dd>{position + 1} of {project.workflow.steps.length}</dd>
        <dt>Status</dt><dd>{statusLabels[step.status]}</dd>
        {step.files?.map((file, index) => <Fragment key={index}><dt>Input file</dt><dd>{file}</dd></Fragment>)}
        {step.workflow_inputs?.map((name, index) => <Fragment key={`input-${index}`}><dt>Workflow input</dt><dd>{name}</dd></Fragment>)}
        {step.workflow_outputs?.map((name, index) => <Fragment key={`output-${index}`}><dt>Workflow output</dt><dd>{name}</dd></Fragment>)}
        {step.options.flatMap((options, index) => Object.entries(options).map(([key, value]) => (
          <Fragment key={`${index}:${key}`}>
            <dt>{step.options.length > 1 && `Input ${index + 1} · `}{step.labels[key] ?? key}</dt>
            <dd>{step.editors?.[key] === "eis_circuit" ? describeCircuit(String(value))
              : typeof value === "boolean" ? value ? "Yes" : "No"
              : Array.isArray(value) ? value.join(", ") : value}</dd>
          </Fragment>
        )))}
        {step.status === "failed" && <><dt>Error</dt><dd>{project.workflow.error}</dd></>}
      </dl>
      {(step.files?.length || step.parameters) && <button type="button" disabled={busy} onClick={() => onEditStep(step)}>Edit Step…</button>}
    </div>;
  }
  const figure = inspection?.kind === "figure" && inspection.id === project.figure_id ? project.figure : null;
  if (!figure || inspection?.kind !== "figure") {
    return <p className="dock-empty">Select a source, figure, trace, or recorded step to inspect it.</p>;
  }
  const index = inspection.trace;
  const trace = index === undefined ? undefined : figure.traces[index];
  const role = index === undefined ? undefined : figure.elements?.[index];
  const seriesColor = index === undefined ? undefined : cycleColor(project.figure_style, figure.series_cycle?.[index]) ?? figure.series_colors?.[index];
  const line = trace && "line" in trace ? trace.line : undefined;
  const marker = trace && "marker" in trace ? trace.marker : undefined;
  const traceColor = (line && "color" in line ? line.color : undefined)
    ?? (marker && "color" in marker ? marker.color : undefined);
  const scatter = trace?.type === "scatter" || trace?.type === "scattergl";
  const traceMode = scatter ? trace.mode : undefined;
  const color = seriesColor ?? (role ? project.colors[role] : typeof traceColor === "string" ? traceColor : undefined);
  const figureName = project.figures.find(({ id }) => id === inspection.id)?.name;
  const operation = project.operations[inspection.id];
  const isOverlay = operation?.kind === "overlay_figure" && operation.keep_inputs;
  const input = project.sources.find(({ id }) => id === (figure.recipe.source_id ?? null));
  const override = index === undefined ? undefined : project.trace_styles[index];
  const appearance = trace && index !== undefined && hasEditableLine(trace)
    ? traceAppearance(trace, index, figure, project.figure_style, project.colors) : undefined;
  const renderedLine = appearance?.line;
  const stroke = renderedLine?.color ?? traceColor ?? color;
  const dash = renderedLine?.dash ?? (line && "dash" in line ? line.dash : undefined);
  const initialLine: TraceLineStyle | undefined = appearance ? {
    color: typeof stroke === "string" && isHexColor(stroke) ? stroke : stroke === plotlyColor("transparent") || stroke === "transparent" ? "transparent" : project.colors.observations,
    width: renderedLine?.width ?? line?.width ?? 2,
    dash: typeof dash === "string" && Object.hasOwn(lineDashes, dash) ? dash as TraceLineStyle["dash"] : "solid",
  } : undefined;
  const initialFill = trace && hasTraceFill(trace)
    ? fillAppearance(trace, typeof stroke === "string" ? stroke : project.colors.observations) : undefined;
  const autoLegend = figure.layout?.showlegend ?? (!!figure.residual_panel || figure.part === "fit" || !!figure.overlay_inputs);
  const initialLegend = initialLine && trace ? {
    name: decodePlotText(trace.name ?? ""),
    showlegend: (!("showlegend" in trace) || trace.showlegend !== false)
      && (project.figure_style.legend !== "auto" || autoLegend
        || Object.entries(project.trace_styles).some(([otherIndex, { legend }]) =>
          Number(otherIndex) !== index && legend?.showlegend === true)),
  } : undefined;
  const orderIndex = index === undefined ? undefined : traceOrderIndex(figure.traces, index);
  const storedOrder = orderIndex === undefined ? undefined : project.trace_styles[orderIndex]?.zorder;
  const orderTrace = orderIndex === undefined ? undefined : figure.traces[orderIndex];
  const nativeOrder = orderTrace && "zorder" in orderTrace && typeof orderTrace.zorder === "number" ? orderTrace.zorder : 0;
  const editableOrder = trace && (trace.type == null || ["scatter", "scattergl", "bar"].includes(trace.type)) ? orderIndex : undefined;
  const elementColor = !initialLine && trace && role && color && !figure.overlay_inputs ? { element: role, color } : undefined;
  return <div className="inspector inspect-details">
    {trace && <button type="button" className="trace-list-back" onClick={() => onInspectFigure(inspection.id)}>All traces</button>}
    <h2>{trace ? trace.name || `Trace ${(index ?? 0) + 1}` : figureName}</h2>
    <dl>
      <dt>{isOverlay ? "Plot" : "Plugin"}</dt><dd>{isOverlay ? "Overlay" : figure.definition.name}</dd>
      {figure.overlay_inputs ? <><dt>Inputs</dt><dd>{figure.overlay_inputs.map(({ label }) => label).join(", ")}</dd></>
        : input && <><dt>Input</dt><dd>{input.name}</dd></>}
      {trace && <>
        {!initialLegend && <><dt>Legend label</dt><dd>{trace.name ?? "Unnamed"}</dd></>}
        <dt>Trace type</dt><dd>{trace.type ?? "Scatter"}</dd>
        {!initialLine && color && <><dt>Color</dt><dd><span className="swatch" style={{ backgroundColor: color }} /> {color}</dd></>}
        {role && traceMode?.includes("markers") && project.figure_style.show_markers &&
          <><dt>Markers</dt><dd>{project.figure_style.marker_size} px · {project.figure_style.marker_symbol}
            {project.figure_style.marker_color && ` · ${project.figure_style.marker_color}`}</dd></>}
      </>}
    </dl>
    {!trace && <ul className="inspect-traces" aria-label="Figure traces">
      {figure.traces.map(({ name }, traceIndex) => <li key={traceIndex}>
        <button type="button" onClick={() => onInspectTrace(inspection.id, traceIndex)}>
          {name || `Trace ${traceIndex + 1}`}
        </button>
      </li>)}
    </ul>}
    {onConfigure && <button type="button" disabled={busy} onClick={onConfigure}>Plugin settings…</button>}
    {index !== undefined && (initialLine || initialFill || editableOrder !== undefined || elementColor) && <TraceInspectForm
      key={JSON.stringify([inspection.id, index, initialLine, initialFill, initialLegend, storedOrder, nativeOrder, override, elementColor])}
      figureId={inspection.id} {...{ index, initialLine, initialFill, initialLegend, override, storedOrder, elementColor, busy, run }}
      orderIndex={editableOrder} initialOrder={nativeOrder} />}
  </div>;
}

function WorksheetPanel({ project, busy, run, onInspect }: { project: Project; busy: boolean; run: Run; onInspect: (id: string | null) => void }) {
  const panelId = useId();
  if (!project.sources.length) return <p className="dock-empty">Use Data → Import Raw Data… to add a worksheet.</p>;
  return (
    <div className="source-pane">
      <div className="view-picker">
        <ViewTabs id={panelId} label="Worksheet sources" kind="source" items={project.sources} selected={project.source_id}
          busy={busy} onSelect={(id) => { onInspect(id); if (id !== project.source_id) void run({ action: "select_source", source_id: id }); }} />
      </div>
      <div className="source-content" id={panelId} role="tabpanel" aria-labelledby={viewTabId(panelId, project.source_id)}>
        <Worksheet key={project.source_id ?? "raw"}
          columns={project.source_table?.columns ?? project.columns}
          rows={project.source_table?.rows ?? project.rows}
          rowCount={project.row_count} offset={project.row_offset}
          onPage={(offset) => { void run({ action: "worksheet_page", offset }); }}
          originalRows={project.source_id === null ? project.original_rows : project.source_original_rows ?? undefined}
          busy={busy}
          onCorrect={(row, column, value) => void run({ action: "correct", row, column, value })} />
      </div>
    </div>
  );
}

function ProjectEditor({ project, projectKey, busy, run, onConfigure, onEdit, onEditStep, capture, notes, onNotesChange }: {
  project: Project;
  projectKey: number;
  capture: Ref<CaptureFigure>;
  busy: boolean;
  run: Run;
  onConfigure?: () => void;
  onEdit: (section: StyleSection) => void;
  onEditStep: (step: WorkflowStep) => void;
  notes: string;
  onNotesChange: (text: string) => void;
}) {
  const [selection, setSelection] = useState<{ projectKey: number; item: Inspection } | null>(null);
  const inspection = selection?.projectKey === projectKey ? selection.item : null;
  const setInspection = useCallback((item: Inspection) => setSelection({ projectKey, item }), [projectKey]);
  const inspectSource = (id: string | null) => setInspection({ kind: "source", id });
  const inspectTrace = useCallback((id: number, trace: number) => setInspection({ kind: "figure", id, trace }), [setInspection]);
  const inspectFigure = (id: number) => setInspection({ kind: "figure", id });
  return (
    <DockWorkspace panels={[
      {
        id: "figure", title: "Figures", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel key={projectKey} project={project} onSelect={inspectTrace} onInspect={inspectFigure} onEdit={onEdit} busy={busy} capture={capture} run={run} />,
      },
      {
        id: "worksheet", title: "Sheets", icon: Table2,
        position: { referencePanel: "figure", direction: "within" },
        minimumWidth: 170, minimumHeight: 150,
        content: <WorksheetPanel key={projectKey} project={project} busy={busy} run={run} onInspect={inspectSource} />,
      },
      {
        id: "notes", title: "Notes", icon: NotebookPen,
        position: { referencePanel: "worksheet", direction: "within" }, inactive: true,
        minimumWidth: 170, minimumHeight: 150,
        content: <NotesPanel key={projectKey} text={notes} onChange={onNotesChange} />,
      },
      {
        id: "sources", title: "Sources", icon: Database,
        position: { referencePanel: "figure", direction: "left" },
        initialWidth: 260, minimumWidth: 150, minimumHeight: 65,
        content: <SourcesPanel key={projectKey} project={project} busy={busy} run={run} onInspect={inspectSource} />,
      },
      {
        id: "history", title: "Recorded steps", icon: History,
        position: { referencePanel: "sources", direction: "below" },
        initialHeight: 180, minimumWidth: 150, minimumHeight: 90,
        content: <WorkflowPanel key={projectKey} workflow={project.workflow} busy={busy} run={run}
          selected={inspection?.kind === "step" ? inspection.id : undefined}
          onInspect={(id) => setInspection({ kind: "step", id })} onEdit={onEditStep} />,
      },
      {
        id: "analysis", title: "Inspect", icon: ScanSearch,
        position: { referencePanel: "figure", direction: "right" },
        initialWidth: 230, minimumWidth: 186,
        content: (
          <InspectPanel key={projectKey} {...{ project, busy, run, inspection, onConfigure, onEditStep }}
            onInspectFigure={inspectFigure} onInspectTrace={inspectTrace} />
        ),
      },
    ]} />
  );
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectKey, setProjectKey] = useState(0);
  const [notes, setNotes] = useState<string | null>(null);
  const notesDraft = useRef<string | null>(null);
  const updateNotes = useCallback((value: string | null) => {
    notesDraft.current = value;
    setNotes(value);
  }, []);
  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);
  const [inputDialog, setInputDialog] = useState<{
    plugin: PluginDefinition; figureId?: number; edit?: PluginStepInputs & { stepId: number };
  } | null>(null);
  const [overlayDialog, setOverlayDialog] = useState(false);
  const [scalarDialog, setScalarDialog] = useState(false);
  const [arrayDialog, setArrayDialog] = useState(false);
  const [stepDialog, setStepDialog] = useState<WorkflowStep | null>(null);
  const [importReview, setImportReview] = useState<ImportReview | null>(null);
  const [workflowDialog, setWorkflowDialog] = useState<"run" | null>(null);
  const [projectWorkflow, setProjectWorkflow] = useState<
    { mode: "configure"; context: ProjectWorkflowContext }
    | { mode: "import" | "refresh"; context: ProjectWorkflowPreview; refreshId?: string }
    | null>(null);
  const [workflowRunEditor, setWorkflowRunEditor] = useState<{ context: WorkflowPorts; stepId: number; ports: boolean } | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"appearance" | "updates" | null>(null);
  const [projectPropertiesOpen, setProjectPropertiesOpen] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const startupUpdateChecked = useRef(false);
  const [figureDialog, setFigureDialog] = useState<StyleSection | null>(null);
  const [exportDialog, setExportDialog] = useState<ExportTarget | null>(null);
  const [itemDialog, setItemDialog] = useState<ItemAction | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({ format: "pdf", scale: 3 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectRef = useRef(project);
  const inFlight = useRef(false);
  const capture = useRef<CaptureFigure>(null);

  const run = useCallback<Run>(async (request) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const replace = replacesProject(request);
      const draft = notesDraft.current;
      const replacesWorkspace = ["new_workspace", "open_workspace", "open_recent_workspace"].includes(request.action);
      const projectDirty = replace && hasProjectChanges(projectRef.current, draft);
      const workspaceDirty = replacesWorkspace && !!projectRef.current?.workspace?.dirty;
      if ((projectDirty || workspaceDirty) && !await confirmDiscard(projectDirty, workspaceDirty)) return false;
      if (request.action === "import_workflow" && !await confirm(
        "Nigiro will deprecate standalone workflow files soon. Save reusable workflows as Nigiro projects. To choose inputs and outputs, use File → Configure Project Workflow.",
        { title: "Import Workflow File", kind: "warning", okLabel: "Choose files", cancelLabel: "Cancel" },
      )) return false;
      if (request.action === "delete_step") {
        const step = projectRef.current?.workflow.steps.find(({ id }) => id === request.step_id);
        const message = step?.action === "import_data"
          ? "Delete this import and its source rename steps? Other steps that use this import may fail when you run them again."
          : "Delete this recorded step? Later steps that use its outputs may fail when you run them again.";
        if (!await confirm(message, {
          title: "Delete recorded step",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        })) return false;
      }
      const saving = request.action === "save" || request.action === "save_as";
      const response = await workspace(saving && draft !== null ? { ...request, notes: draft } : request);
      if (response && "import_review" in response) {
        setImportReview(response.import_review);
        return false;
      }
      if (response) {
        setPlugins(response.plugins);
        projectRef.current = response.project;
        setProject(response.project);
        if (replace || (saving && notesDraft.current === draft)) updateNotes(null);
        if (replace) setProjectKey((key) => key + 1);
      }
      return response !== null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [updateNotes]);

  useEffect(() => {
    void run({ action: "state" }).then(() => invoke<DesktopInfo>("desktop_info"))
      .then(setDesktopInfo, (reason: unknown) => setUpdateError(String(reason)));

    const currentWindow = getCurrentWindow();
    let confirmingClose = false;
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      const projectDirty = hasProjectChanges(projectRef.current, notesDraft.current);
      const workspaceDirty = !!projectRef.current?.workspace?.dirty;
      if (inFlight.current) {
        event.preventDefault();
      } else if (projectDirty || workspaceDirty) {
        event.preventDefault();
        if (confirmingClose) return;
        confirmingClose = true;
        try {
          if (await confirmDiscard(projectDirty, workspaceDirty)) await currentWindow.destroy();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          confirmingClose = false;
        }
      }
    });
    void unlisten.catch((reason: unknown) => setError(String(reason)));
    return () => { void unlisten.then((stop) => stop(), () => {}); };
  }, [run]);

  const checkUpdates = useCallback(async () => {
    setUpdateChecking(true);
    setUpdateError("");
    try {
      setRelease(await invoke<Release | null>("check_for_update"));
      setUpdateChecked(true);
    } catch (reason) {
      setUpdateError(String(reason));
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  useEffect(() => {
    if (desktopInfo?.preferences.check_updates && !desktopInfo.updates_unavailable && !startupUpdateChecked.current) {
      startupUpdateChecked.current = true;
      void checkUpdates();
    }
  }, [desktopInfo, checkUpdates]);

  async function installUpdate() {
    if (!release || inFlight.current || updateChecking) return;
    if (hasProjectChanges(projectRef.current, notesDraft.current) || projectRef.current?.workspace?.dirty) {
      setUpdateError("Save your project and workspace before restarting Nigiro.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setUpdateInstalling(true);
    setUpdateError("");
    try {
      await invoke("install_update", { version: release.version });
    } catch (reason) {
      setUpdateError(String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setUpdateInstalling(false);
    }
  }

  async function saveDesktopPreferences(settings: DesktopPreferences | undefined) {
    if (inFlight.current) return false;
    if (!settings || JSON.stringify(settings) === JSON.stringify(desktopInfo?.preferences)) return true;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setDesktopInfo(await invoke<DesktopInfo>("set_desktop_preferences", { settings }));
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!project?.appearance) return;
    const appearance = project.appearance;
    applyAppearance(appearance);
    cacheAppearance(appearance);
    const system = matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyAppearance(appearance);
    system.addEventListener("change", update);
    return () => system.removeEventListener("change", update);
  }, [project?.appearance.theme, project?.appearance.accent]);

  const figure = project?.figure;
  const figureNumber = project ? project.figures.findIndex((item) => item.id === project.figure_id) + 1 : 0;
  const exportName = project && figure
    ? projectStem(project) + (project.figures.length > 1 ? `-figure-${figureNumber}` : "") : null;
  const editableTraces = figure?.traces.filter((_, index) => figure.elements?.[index]) ?? [];
  const pluginDialog = inputDialog;
  const pluginEdit = pluginDialog?.edit;
  const previous = project?.operations.slice().reverse().find((step) =>
    step.kind === "plugin" && pluginDialog && matchesPlugin(step, pluginDialog.plugin));
  const configuring = pluginDialog?.figureId !== undefined || pluginEdit?.updates_figure === true;
  const editingSource = configuring && !pluginEdit && project && figure ? (
    (figure.recipe.references?.x && figure.recipe.references.y ? {
      id: figure.recipe.source_id ?? null, name: "Paired sources", columns: [figure.x_label ?? "X", figure.y_label ?? "Y"],
    } : project.sources.find(({ id }) => id === (figure.recipe.source_id ?? null))) ?? {
      id: figure.recipe.source_id ?? null,
      name: project.figure_input?.name ?? "Figure input",
      columns: project.figure_input?.columns ?? project.columns,
    }
  ) : undefined;
  const initialOptions = figure && configuring
    ? figure.recipe.options : previous?.kind === "plugin" ? previous.options : undefined;

  function pluginCommands(menu: PluginDefinition["menu"], category?: PluginDefinition["category"]) {
    return plugins.filter((plugin) => plugin.menu === menu && plugin.category === category && plugin.id !== "nigiro.filter" && plugin.id !== "nigiro.filter_columns" && plugin.id !== "nigiro.filter_rows" && plugin.id !== "nigiro.filter_segments" && plugin.id !== columnFormulaId
      && plugin.id !== arrayFormulaId && plugin.id !== "example.scaled_xy").map((plugin) => {
      const columns = columnFields(plugin).length;
      const required = plugin.distinct_columns && plugin.input_mode !== "joint" ? columns : Math.min(columns, 1);
      return {
        label: `${plugin.name}…`,
        icon: pluginIcon(plugin.id, menu),
        request: (project?.sources.some(({ columns }) => columns.length >= required)
          || (supportsPairedSources(plugin) && (project?.sources.filter(({ columns }) => columns.length > 0).length ?? 0) >= 2))
          ? { action: "choose_plugin", plugin } as const : null,
      };
    });
  }

  async function exportCurrent(target: ExportTarget, settings: ExportSettings) {
    if (!project || !exportName || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (!capture.current) throw new Error("Open the Figure panel before exporting.");
      await saveFigure(exportName, target, settings, capture.current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function openStep(step: WorkflowStep, ports = false) {
    setError("");
    if (!step.plugin_step && !step.workflow_outputs) {
      setStepDialog(step);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (step.workflow_outputs) {
        const context = await invoke<WorkflowPorts>("workspace", {
          request: { action: "workflow_step_ports", step_id: step.id },
        });
        setWorkflowRunEditor({ context, stepId: step.id, ports });
      } else {
        const context = await invoke<PluginStepInputs>("workspace", {
          request: { action: "plugin_step_inputs", step_id: step.id },
        });
        setInputDialog({ plugin: context.plugin, edit: { ...context, stepId: step.id } });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function openProjectWorkflow(mode: "configure" | "import" | "refresh", refresh?: SavedWorkflow) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "configure") {
        const context = await invoke<ProjectWorkflowContext>("workspace", { request: { action: "project_workflow_context" } });
        setProjectWorkflow({ mode, context });
      } else {
        const context = await invoke<ProjectWorkflowPreview | null>("workspace", {
          request: { action: "inspect_project_workflow", refresh_id: refresh?.id, project_path: refresh?.project_path },
        });
        if (context) {
          setWorkflowDialog(null);
          setProjectWorkflow({ mode, context, refreshId: refresh?.id });
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function runMenu(request: MenuRequest) {
    closeContextMenu();
    if (request.action === "choose_plugin") {
      setError("");
      setInputDialog({ plugin: request.plugin });
    }
    else if (request.action === "settings") { setError(""); setSettingsDialog("appearance"); }
    else if (request.action === "project_properties") { setError(""); setProjectPropertiesOpen(true); }
    else if (request.action === "choose_overlay") { setError(""); setOverlayDialog(true); }
    else if (request.action === "choose_scalar") { setError(""); setScalarDialog(true); }
    else if (request.action === "choose_array") { setError(""); setArrayDialog(true); }
    else if (request.action === "choose_step") void openStep(request.step);
    else if (request.action === "choose_workflow_ports") void openStep(request.step, true);
    else if (request.action === "choose_configure_project_workflow") void openProjectWorkflow("configure");
    else if (request.action === "choose_import_project_workflow") void openProjectWorkflow("import");
    else if (request.action === "choose_run_workflow") { setError(""); setWorkflowDialog("run"); }
    else if (request.action === "figure_settings") { setError(""); setFigureDialog("figure"); }
    else if (request.action === "choose_export") setExportDialog(request.target);
    else if (request.action === "manage_item") setItemDialog(request.change);
    else void run(request);
  }

  const menuBusy = busy || scalarDialog || arrayDialog || overlayDialog || stepDialog !== null || workflowDialog !== null
    || settingsDialog !== null || inputDialog !== null || exportDialog !== null || figureDialog !== null || itemDialog !== null
    || workflowRunEditor !== null || importReview !== null || projectWorkflow !== null || projectPropertiesOpen;
  const WorkflowRunEditor = workflowRunEditor?.ports ? EditWorkflowPortsDialog : EditWorkflowRunDialog;
  const newProject: MenuCommand = { label: "New…", keywords: "create project", icon: FilePlus, request: { action: "new" }, shortcut: "N" };
  const openProject: MenuCommand = { label: "Open Project…", icon: FolderOpen, request: { action: "open" }, shortcut: "O" };
  const newWorkspace: MenuCommand = { label: "New Workspace", icon: FolderPlus, keywords: "create", request: { action: "new_workspace" } };
  const openWorkspace: MenuCommand = { label: "Open Workspace…", icon: FolderOpen, request: { action: "open_workspace" } };
  const dataGroups: MenuCommand[][] = [
    [{ label: "Import Raw Data…", keywords: "csv txt tsv text open load", icon: actionIcons.import_data, request: { action: "import_data" } }],
    [
      { label: "Add Variable/Constant…", keywords: "create variables constants scalar", icon: actionIcons.add_scalar, request: { action: "choose_scalar" } },
      { label: "Add Array…", keywords: "create arrays formula", icon: actionIcons.add_array, request: { action: "choose_array" } },
    ],
    [{ label: "Try Sample Data", icon: FlaskConical, request: { action: "sample" } }],
  ];
  const exportCommands: MenuCommand[] = [
    { label: "Export Figure…", icon: FileOutput, request: exportName ? { action: "choose_export", target: "figure" } : null },
    { label: "Export Python Script…", icon: FileCode2, request: exportName ? { action: "choose_export", target: "script" } : null },
  ];
  const figureSettings: MenuCommand = {
    label: "Figure Settings…", request: exportName ? { action: "figure_settings" } : null,
  };
  const plotCommands = pluginCommands("plot");
  const overlayFigures = project?.figures.filter((figure) => figure.overlayable) ?? [];
  const filterPlugin = plugins.find((plugin) => plugin.id === "nigiro.filter");
  const filterCommand: MenuCommand = { label: "Filter…", icon: pluginIcon("nigiro.filter"), request: filterPlugin && project?.sources.length
    ? { action: "choose_plugin", plugin: filterPlugin } : null };
  const filterColumns = plugins.find((plugin) => plugin.id === "nigiro.filter_columns");
  const filterColumnsCommand: MenuCommand = { label: "Filter Columns…", icon: pluginIcon("nigiro.filter_columns"),
    request: filterColumns && project?.sources.some(({ columns }) => columns.length > 0)
      ? { action: "choose_plugin", plugin: filterColumns } : null };
  const filterRows = plugins.find((plugin) => plugin.id === "nigiro.filter_rows");
  const filterRowsCommand: MenuCommand = { label: "Filter Rows…", icon: pluginIcon("nigiro.filter_rows"),
    request: filterRows && project?.sources.some(({ row_count }) => row_count > 0)
      ? { action: "choose_plugin", plugin: filterRows } : null };
  const filterSegments = plugins.find((plugin) => plugin.id === "nigiro.filter_segments");
  const filterSegmentsCommand: MenuCommand = { label: "Filter Segments…", icon: pluginIcon("nigiro.filter_segments"), request: filterSegments && project?.sources.length
    ? { action: "choose_plugin", plugin: filterSegments } : null };
  const formula = plugins.find((plugin) => plugin.id === columnFormulaId);
  const formulaCommand: MenuCommand = { label: "Column Formula…", icon: actionIcons.apply_formula, request: formula && project?.sources.length
    ? { action: "choose_plugin", plugin: formula } : null };
  const analysisCommands = pluginCommands("analysis");

  function itemCommands(item: WorkspaceItem, name: string): MenuCommand[] {
    const imported = item.kind === "source" && item.id === null;
    return [
      { label: "Rename…", request: { action: "manage_item", change: { mode: "rename", item, name } } },
      {
        label: "Delete…",
        request: imported ? null : { action: "manage_item", change: { mode: "delete", item, name } },
        disabledReason: imported ? "The imported source is required for this project." : undefined,
      },
    ];
  }

  function openContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element) || event.target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    if (menuBusy || event.target.closest(".menu-popup")) return;
    let label = "Workspace actions";
    let groups = [[newProject, openProject], ...dataGroups];
    const clicked = event.target.closest<HTMLElement>("[data-item-kind][data-item-id]");
    const newGroup: MenuCommand = { label: "New group…", icon: FolderPlus, request: { action: "manage_item", change: { mode: "new_group" } } };
    const activeFigure = project?.figures.find(({ id }) => id === project.figure_id);
    const historyStep = event.target.closest<HTMLElement>("[data-workflow-id]");
    if (historyStep && project) {
      const index = project.workflow.steps.findIndex(({ id }) => String(id) === historyStep.dataset.workflowId);
      const step = project.workflow.steps[index];
      if (!step) return;
      label = "Recorded step actions";
      groups = [[
        { label: "Edit Step…", request: step.files?.length || step.parameters ? { action: "choose_step", step } : null },
        ...(step.workflow_outputs ? [{ label: "Edit Inputs and Outputs…", request: { action: "choose_workflow_ports" as const, step } }] : []),
        { label: "Move Earlier", request: index > 0 ? { action: "move_step", step_id: step.id, direction: -1 } : null },
        { label: "Move Later", request: index < project.workflow.steps.length - 1 ? { action: "move_step", step_id: step.id, direction: 1 } : null },
      ], [{ label: "Delete…", request: { action: "delete_step", step_id: step.id } }]];
    } else if (clicked?.dataset.itemKind === "source" && project) {
      const index = project.sources.findIndex(({ id }) => (id ?? "") === clicked.dataset.itemId);
      const source = project.sources[index];
      if (!source) return;
      label = "Source actions";
      const arrayStep = project.workflow.steps.find(({ id }) => id === source.array_step);
      const peers = project.sources.flatMap((item, position) => item.group_id === source.group_id ? [position] : []);
      const position = peers.indexOf(index);
      groups = [[
        ...(arrayStep ? [{ label: "Edit Array…", request: { action: "choose_step", step: arrayStep } } satisfies MenuCommand] : []),
        ...itemCommands({ kind: "source", id: source.id }, source.name),
      ], [
        { label: "Move Earlier", request: position > 0 ? { action: "move_source", source_id: source.id, destination: peers[position - 1] } : null },
        { label: "Move Later", request: position < peers.length - 1 ? { action: "move_source", source_id: source.id, destination: peers[position + 1] } : null },
      ]];
      const destinations = [{ id: null, name: "Outside groups" }, ...(project.source_groups ?? [])]
        .filter((group) => group.id !== source.group_id);
      if (destinations.length) groups[1].push({
        label: "Move to", request: null, submenu: destinations.map((group) => ({
          label: group.name,
          request: { action: "move_source", source_id: source.id, destination: index, placement: { group_id: group.id } },
        })),
      });
      groups.push([newGroup]);
    } else if (project && event.target.closest(".source-tree")) {
      label = "Source actions";
      groups = [[newGroup], ...dataGroups];
    } else if (clicked?.dataset.itemKind === "figure" || (activeFigure && event.target.closest(".figure-pane"))) {
      const target = clicked ? project?.figures.find(({ id }) => String(id) === clicked.dataset.itemId) : activeFigure;
      if (!target) return;
      label = "Figure actions";
      const commands = itemCommands({ kind: "figure", id: target.id }, target.name);
      groups = figure && activeFigure?.id === target.id ? [[figureSettings], commands, exportCommands] : [commands];
    } else if (event.target.closest(".source-pane") && (plotCommands.length || analysisCommands.length)) {
      label = "Worksheet actions";
      groups = [[formulaCommand, filterCommand, filterColumnsCommand], plotCommands, analysisCommands].filter((group) => group.length);
    }
    const anchor = (historyStep ?? clicked ?? event.target).getBoundingClientRect();
    const useAnchor = event.clientX === 0 && event.clientY === 0;
    setContextMenu({
      label, groups,
      x: useAnchor ? anchor.left : event.clientX,
      y: useAnchor ? anchor.bottom : event.clientY,
      returnFocus: historyStep ?? clicked ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    });
  }

  const menus: Menu[] = [
    {
      label: "File",
      groups: [
        [newProject],
        [openProject],
        [
          { label: "Save Project", icon: Save, request: project ? saveRequest(project) : null, shortcut: "S" },
          {
            label: "Save Project as…", icon: SaveAll,
            request: project ? { action: "save_as", name: projectStem(project) } : null,
            shortcut: "Shift+S",
          },
        ],
        [
          newWorkspace,
          { label: "Save Workspace…", icon: Save, request: project?.workspace
            ? { action: "save_workspace", name: project.workspace.name, choose_path: project.workspace.path === null } : null },
          openWorkspace,
        ],
        [
          { label: "Configure Project Workflow…", icon: WorkflowIcon, request: project?.workflow.completed ? { action: "choose_configure_project_workflow" } : null },
          { label: "Import Project as Workflow…", icon: FileInput, request: { action: "choose_import_project_workflow" } },
          { label: "Import Workflow File…", icon: FileInput, request: { action: "import_workflow" } },
          { label: "Run Workflow…", icon: Play, request: project?.saved_workflows?.length ? { action: "choose_run_workflow" } : null },
        ],
        exportCommands,
      ],
    },
    {
      label: "Edit",
      groups: [
        [
          { label: "Settings…", icon: Settings2, request: { action: "settings" } },
          { label: "Project properties…", icon: Settings2, request: project ? { action: "project_properties" } : null },
        ],
        [{ label: "Install Python Plugin…", icon: PackagePlus, request: { action: "install_plugin" } }],
      ],
    },
    {
      label: "Data",
      groups: dataGroups,
    },
    {
      label: "Plot",
      groups: [plotCommands, [{
        label: "Overlay…", icon: actionIcons.overlay_figures, keywords: "combine figures shared axes",
        request: overlayFigures.length >= 2 ? { action: "choose_overlay" } : null,
      }]],
    },
    {
      label: "Analysis",
      groups: [analysisCommands, [
        { label: "Operations", icon: Calculator, request: null, submenu: [formulaCommand, filterCommand, filterRowsCommand, filterColumnsCommand] },
        { label: "Signal Processing", icon: ChartLine, request: null, submenu: pluginCommands("analysis", "signal") },
        { label: "Electrochemistry", icon: FlaskConical, request: null, submenu: [...pluginCommands("analysis", "electrochemistry"), filterSegmentsCommand] },
      ]],
    },
  ];

  return (
    <div className="app" onContextMenu={openContextMenu}>
      <header className="app-bar" onMouseDown={(event) => dragTitleBar(event, setError)}>
        <div className="app-bar-start">
          <div className="brand"><img src={appLogo} alt="" /><span>Nigiro</span></div>
          <MenuBar busy={menuBusy} onRun={runMenu} menus={menus} />
        </div>
        <CommandSearch menus={menus} busy={menuBusy} onRun={runMenu} />
        <div className="app-bar-end">
          {project && <ProjectBreadcrumb project={project} projectName={project.file_name ? projectStem(project) : "Untitled project"}
            projectDirty={hasProjectChanges(project, notes)} busy={menuBusy}
            openWorkspace={openWorkspace} newWorkspace={newWorkspace} onRun={runMenu} />}
          <WindowControls onError={setError} />
        </div>
      </header>
      {scalarDialog && <ScalarSourceDialog busy={busy} error={error} sources={project?.sources ?? []}
        onClose={() => { setScalarDialog(false); setError(""); }}
        onAdd={async (request) => { if (await run(request)) setScalarDialog(false); }} />}
      {arrayDialog && <ArraySourceDialog busy={busy} error={error} sources={project?.sources ?? []}
        onClose={() => { setArrayDialog(false); setError(""); }}
        onAdd={async (request) => { if (await run(request)) setArrayDialog(false); }} />}
      {project && overlayDialog && <OverlayDialog figures={overlayFigures} active={project.figure_id} busy={busy} error={error}
        onClose={() => { setOverlayDialog(false); setError(""); }}
        onCreate={async (figure_ids) => { if (await run({ action: "overlay_figures", figure_ids })) setOverlayDialog(false); }} />}
      {stepDialog && <WorkflowStepDialog step={stepDialog} sources={project?.sources ?? []} busy={busy} error={error} onRun={run}
        onClose={() => { setStepDialog(null); setError(""); }} />}
      {importReview && <ImportDataDialog key={`${importReview.index}:${JSON.stringify(importReview.suggested)}`}
        review={importReview} busy={busy} error={error}
        onClose={() => { setImportReview(null); setError(""); }}
        onImport={async (request) => {
          if (await run(request)) {
            setImportReview(null);
            if (request.replacement) setStepDialog(null);
          }
        }} />}
      {projectWorkflow && <ProjectWorkflowDialog context={projectWorkflow.context} mode={projectWorkflow.mode}
        {...{ busy, error }} onSave={(configuration) => run(projectWorkflow.mode === "configure"
          ? { action: "configure_project_workflow", configuration }
          : { action: "import_project_workflow", configuration, path: projectWorkflow.context.path,
              revision: projectWorkflow.context.revision, refresh_id: projectWorkflow.refreshId })}
        onClose={() => { setProjectWorkflow(null); setError(""); }} />}
      {project && workflowDialog === "run" && <RunWorkflowDialog {...{ project, busy, error }} onRun={run}
        onRefresh={(workflow) => void openProjectWorkflow("refresh", workflow)} onClose={() => { setWorkflowDialog(null); setError(""); }} />}
      {workflowRunEditor && <WorkflowRunEditor context={workflowRunEditor.context} stepId={workflowRunEditor.stepId}
        {...{ busy, error }} onRun={run} onClose={() => { setWorkflowRunEditor(null); setError(""); }} />}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={closeContextMenu} onRun={runMenu} />}
      {itemDialog && (
        <ItemDialog change={itemDialog} onClose={() => setItemDialog(null)} onApply={(name) => {
          setItemDialog(null);
          if (itemDialog.mode === "new_group") {
            if (name !== null) void run({ action: "source_group", mode: "create", name });
          } else {
            void run({ action: "edit_item", item: itemDialog.item, name });
          }
        }} />
      )}
      {project && inputDialog && (
        <InputOptionsDialog target={inputDialog.plugin}
          project={pluginEdit?.inputs ?? project} previous={initialOptions}
          initial={pluginEdit?.submission} warning={pluginEdit?.warning}
          configuring={configuring} editingSource={editingSource} busy={busy} error={error}
          onClose={() => { setInputDialog(null); setError(""); }}
          onRun={async (submission) => {
            let success: boolean;
            if (pluginEdit) {
              success = await run({ action: "edit_plugin_step", step_id: pluginEdit.stepId, submission });
            } else if (inputDialog.plugin.id === columnFormulaId) {
              const { source_id, options } = submission.runs[0];
              success = await run({ action: "apply_formula", source_id, column: Number(options.column),
                expression: String(options.expression), column_name: String(options.column_name ?? "") });
            } else {
              const { id: plugin_id, version, checksum } = inputDialog.plugin;
              success = configuring ? await run({
                action: "run_plugin", plugin_id, version, checksum, figure_id: inputDialog.figureId,
                options: submission.runs[0].options,
              }) : await run({ action: "execute_plugin", plugin_id, version, checksum, ...submission });
            }
            if (success) setInputDialog(null);
          }}
        />
      )}
      {exportDialog && (
        <ExportDialog target={exportDialog} initial={exportSettings}
          onClose={() => setExportDialog(null)}
          onExport={(settings) => {
            setExportSettings(settings);
            setExportDialog(null);
            void exportCurrent(exportDialog, settings);
          }}
        />
      )}
      {project && projectPropertiesOpen && <ProjectProperties
        global={project.project_storage ?? defaultProjectStorage} initial={project.project_storage_overrides ?? {}}
        busy={busy} error={error} onSave={(overrides) => run({ action: "set_project_storage", overrides })}
        onClose={() => { setProjectPropertiesOpen(false); setError(""); }} />}
      {project && settingsDialog && (
        <FigureSettings global runAutomatically={project.run_automatically} projectStorage={project.project_storage}
          appearance={project.appearance} initial={project.global_figure_style} defaults={project.factory_figure_style}
          initialSection="figure" labels={{ x: "", y: "" }}
          categoricalX={false} bar markers line busy={busy} saveError={error}
          desktop={{ info: desktopInfo, initialPage: settingsDialog, pythonVersion: project.versions.python,
            update: { release, checking: updateChecking, installing: updateInstalling, checked: updateChecked,
              error: updateError, check: checkUpdates, install: installUpdate } }}
          onClose={() => { setSettingsDialog(null); setError(""); }}
          onApply={async (style, appearance, run_automatically, desktop, project_storage) => {
            if (appearance && await saveDesktopPreferences(desktop)
              && await run({ action: "set_preferences", style, appearance, run_automatically, project_storage })) setSettingsDialog(null);
          }} />
      )}
      {project && figure && project.figure_id !== null && figureDialog && (
        <FigureSettings
          initial={project.figure_style}
          busy={busy} saveError={error}
          onSaveGlobal={async (section, key, value, unit) => {
            const global = project.global_figure_style;
            const axis = section === "figure" ? section : "global_axis";
            const units = { ...(axis === "figure" ? global.units : axisSettings(global, axis).units) };
            if (unit) units[key] = unit;
            else delete units[key];
            const style = axis === "figure" ? { ...global, [key]: value, units }
              : { ...global, axes_separate: false, [axis]: { ...axisSettings(global, axis), [key]: value, units } };
            return run({ action: "set_global_style", style });
          }}
          defaults={project.default_figure_style}
          initialSection={figureDialog}
          labels={{ x: figure.x_label ?? "", y: figure.y_label ?? "" }}
          availableAxes={figure.traces.some((trace) => trace.type == null || ["scatter", "scattergl", "bar"].includes(trace.type)) ? ["x", "y"] : []}
          categoricalX={!!figure.categorical_x}
          bar={editableTraces.some((trace) => trace.type === "bar")}
          markers={editableTraces.some((trace) => trace.type === "scatter" && trace.mode?.includes("markers"))}
          line={editableTraces.some((trace) => trace.type === "scatter" && trace.mode?.includes("lines"))}
          onClose={() => { setFigureDialog(null); setError(""); }}
          onApply={(style) => {
            setFigureDialog(null);
            if (project.figure_id !== null) void run({ action: "figure_style", style, figure_id: project.figure_id });
          }}
        />
      )}
      {error && !scalarDialog && !overlayDialog && !stepDialog && !workflowDialog && !projectWorkflow && !workflowRunEditor && !importReview && !inputDialog && !settingsDialog && !projectPropertiesOpen && !figureDialog && <div className="error-banner" role="alert">{error}</div>}
      {project ? (
        <ProjectEditor {...{ project, projectKey, busy, run, capture }} notes={notes ?? project.notes ?? ""} onNotesChange={updateNotes}
          onEditStep={(step) => runMenu({ action: "choose_step", step })}
          onConfigure={figure && !figure.overlay_inputs && figure.definition.input_mode !== "joint" && project.figure_id !== null
            ? () => { setError(""); setInputDialog({ plugin: figure.definition, figureId: project.figure_id ?? undefined }); }
            : undefined} onEdit={setFigureDialog} />
      ) : (
        <main className="welcome">
          <div className="welcome-card">
            <div className="welcome-mark"><ChartNoAxesCombined size={35} strokeWidth={1.7} /></div>
            <h1>Start an analysis</h1>
            <p>Open <strong>Data</strong> to import a data file or try sample data.</p>
          </div>
        </main>
      )}
      <footer className="app-status">
        {desktopInfo && <span>v{desktopInfo.version}</span>}
        {release && <button type="button" className="app-update"
          title={`Version ${release.version} is available`} aria-label={`Version ${release.version} is available`}
          disabled={menuBusy} onClick={() => { setError(""); setSettingsDialog("updates"); }}>
          <Info size={14} aria-hidden="true" />
        </button>}
      </footer>
    </div>
  );
}
