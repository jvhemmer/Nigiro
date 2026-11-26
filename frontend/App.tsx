import { describeCircuit } from "./CircuitDesigner";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type MouseEvent, type Ref } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import appLogo from "../proposed-logos/data-matrix.svg";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Brackets, Calculator, ChartColumn, ChartLine, ChartNoAxesCombined, ChartScatter, Database, FileCode2, FileInput,
  FileOutput, FilePlus, Filter, FlaskConical, FolderOpen, FolderPlus, History, Info, Layers, ListFilter, PackagePlus, Play,
  NotebookPen, Save, SaveAll, ScanSearch, Settings2, SquareFunction, Table2, Variable, Workflow as WorkflowIcon,
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
import { FigureSettings } from "./FigureSettings";
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
import { RunWorkflowDialog, SaveWorkflowDialog } from "./WorkflowDialogs";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, lineDashes, replacesProject, workspace,
  type FigureElement, type PluginDefinition, type PluginRun, type Project, type Request, type TraceFillStyle, type TraceLineStyle, type WorkflowStep, type WorkspaceItem,
} from "./workspace";

type Run = (request: Request) => Promise<boolean>;

function matchesPlugin(run: PluginRun, plugin: PluginDefinition) {
  return run.plugin_id === plugin.id && run.version === plugin.version && run.checksum === plugin.checksum;
}

function projectStem(project: Project) {
  const fileName = (project.file_name ?? project.source_name ?? "Untitled").split(/[\\/]/).at(-1);
  return fileName?.replace(/\.(csv|nigiro)$/i, "") || "Analysis";
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

function ColorField({
  element, color, figureId, busy, run,
}: { element: FigureElement; color: string; figureId: number; busy: boolean; run: Run }) {
  const [draft, setDraft] = useState(color);
  return (
    <form
      className="color-field"
      onSubmit={(event) => { event.preventDefault(); void run({ action: "color", element, color: draft, figure_id: figureId }); }}
    >
      <label>
        <input
          type="color"
          aria-label={`${elementNames[element]} color`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        <span>{draft}</span>
      </label>
      <button disabled={busy || color === draft}>Apply</button>
    </form>
  );
}

function TraceLineEditor({ initial, overridden, busy, onApply }: {
  initial: TraceLineStyle;
  overridden: boolean;
  busy: boolean;
  onApply: (style: TraceLineStyle | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const valid = draft.width >= 0.1 && draft.width <= 12;
  const changed = draft.color !== initial.color || draft.width !== initial.width || draft.dash !== initial.dash;
  return <form className="fit-settings trace-line-editor" onSubmit={(event) => {
    event.preventDefault();
    if (valid && changed && !busy) onApply(draft);
  }}>
    <label><span>Line color</span><input type="color" value={draft.color}
      onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
    <label><span>Line width (px)</span><input type="number" min={0.1} max={12} step="any" required
      value={Number.isFinite(draft.width) ? draft.width : ""} onChange={(event) => setDraft({ ...draft, width: event.target.valueAsNumber })} /></label>
    <label><span>Line style</span><select value={draft.dash}
      onChange={(event) => setDraft({ ...draft, dash: event.target.value as TraceLineStyle["dash"] })}>
      {Object.entries(lineDashes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className="trace-line-actions">
      {overridden && <button type="button" disabled={busy} onClick={() => onApply(null)}>Reset</button>}
      <button type="submit" disabled={busy || !changed || !valid}>Apply</button>
    </div>
  </form>;
}

function TraceFillEditor({ initial, overridden, busy, onApply }: {
  initial: TraceFillStyle;
  overridden: boolean;
  busy: boolean;
  onApply: (style: TraceFillStyle | null) => void;
}) {
  const [color, setColor] = useState(initial.color);
  const [opacity, setOpacity] = useState(String(Math.round(initial.opacity * 1000) / 10));
  const valid = opacity !== "" && Number(opacity) >= 0 && Number(opacity) <= 100;
  return <form className="fit-settings trace-line-editor" onSubmit={(event) => {
    event.preventDefault();
    if (valid && !busy) onApply({ color, opacity: Number(opacity) / 100 });
  }}>
    <label><span>Fill color</span><input type="color" value={color} disabled={busy}
      onChange={(event) => setColor(event.target.value)} /></label>
    <label><span>Fill opacity (%)</span><input type="number" required min={0} max={100} step="any" value={opacity} disabled={busy}
      onChange={(event) => setOpacity(event.target.value)} /></label>
    <div className="trace-line-actions">
      {overridden && <button type="button" disabled={busy} onClick={() => onApply(null)}>Reset fill</button>}
      <button type="submit" disabled={busy || !valid}>Apply fill</button>
    </div>
  </form>;
}

function TraceOrderEditor({ initial, overridden, busy, onApply }: {
  initial: number;
  overridden: boolean;
  busy: boolean;
  onApply: (style: { zorder: number } | null) => void;
}) {
  const [value, setValue] = useState(String(initial));
  return <form className="fit-settings trace-line-editor" onSubmit={(event) => {
    event.preventDefault();
    if (!busy && value !== "") onApply({ zorder: Number(value) });
  }}>
    <label title="Higher values draw in front. A shaded area and its baseline share an order.">
      <span>Draw order (Z)</span>
      <input type="number" required min={-10000} max={10000} step={1} value={value} disabled={busy}
        onChange={(event) => setValue(event.target.value)} />
    </label>
    <div className="trace-line-actions">
      {overridden && <button type="button" disabled={busy} onClick={() => onApply(null)}>Reset order</button>}
      <button type="submit" disabled={busy || value === ""}>Apply order</button>
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
        {step.workflow_outputs?.map((name, index) => <Fragment key={index}><dt>Workflow output</dt><dd>{name}</dd></Fragment>)}
        {step.options.flatMap((options, index) => Object.entries(options).map(([key, value]) => (
          <Fragment key={`${index}:${key}`}>
            <dt>{step.options.length > 1 && `Input ${index + 1} · `}{step.labels[key] ?? key}</dt>
            <dd>{step.editors?.[key] === "eis_circuit" ? describeCircuit(String(value))
              : typeof value === "boolean" ? value ? "Yes" : "No" : value}</dd>
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
    ? traceAppearance(trace, index, figure, project.figure_style, project.colors, override?.color
      ? { color: override.color, width: override.width, dash: override.dash } : undefined) : undefined;
  const renderedLine = appearance?.line;
  const stroke = renderedLine?.color ?? traceColor ?? color;
  const dash = renderedLine?.dash ?? (line && "dash" in line ? line.dash : undefined);
  const initialLine: TraceLineStyle | undefined = appearance ? {
    color: typeof stroke === "string" && /^#[0-9a-f]{6}$/i.test(stroke) ? stroke : project.colors.observations,
    width: renderedLine?.width ?? line?.width ?? 2,
    dash: typeof dash === "string" && Object.hasOwn(lineDashes, dash) ? dash as TraceLineStyle["dash"] : "solid",
  } : undefined;
  const initialFill = trace && hasTraceFill(trace)
    ? override?.fill ?? fillAppearance(trace, typeof stroke === "string" ? stroke : project.colors.observations) : undefined;
  const orderIndex = index === undefined ? undefined : traceOrderIndex(figure.traces, index);
  const storedOrder = orderIndex === undefined ? undefined : project.trace_styles[orderIndex]?.zorder;
  const orderTrace = orderIndex === undefined ? undefined : figure.traces[orderIndex];
  const nativeOrder = orderTrace && "zorder" in orderTrace && typeof orderTrace.zorder === "number" ? orderTrace.zorder : 0;
  return <div className="inspector inspect-details">
    {trace && <button type="button" className="trace-list-back" onClick={() => onInspectFigure(inspection.id)}>All traces</button>}
    <h2>{trace ? trace.name || `Trace ${(index ?? 0) + 1}` : figureName}</h2>
    <dl>
      <dt>{isOverlay ? "Plot" : "Plugin"}</dt><dd>{isOverlay ? "Overlay" : figure.definition.name}</dd>
      {figure.overlay_inputs ? <><dt>Inputs</dt><dd>{figure.overlay_inputs.map(({ label }) => label).join(", ")}</dd></>
        : input && <><dt>Input</dt><dd>{input.name}</dd></>}
      {trace && <>
        <dt>Legend label</dt><dd>{trace.name ?? "Unnamed"}</dd>
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
    {index !== undefined && initialLine && <TraceLineEditor
      key={`${inspection.id}:${index}:${initialLine.color}:${initialLine.width}:${initialLine.dash}`}
      initial={initialLine} overridden={!!override?.color} busy={busy}
      onApply={(style) => { void run({ action: "trace_style", figure_id: inspection.id, trace: index, style }); }} />}
    {index !== undefined && initialFill && <TraceFillEditor
      key={`${inspection.id}:${index}:${initialFill.color}:${initialFill.opacity}`}
      initial={initialFill} overridden={!!override?.fill} busy={busy}
      onApply={(style) => { void run({ action: "trace_style", kind: "fill", figure_id: inspection.id, trace: index, style }); }} />}
    {trace && orderIndex !== undefined && (trace.type == null || ["scatter", "scattergl", "bar"].includes(trace.type)) && <TraceOrderEditor
      key={`${inspection.id}:${orderIndex}:${storedOrder ?? nativeOrder}`}
      initial={storedOrder ?? nativeOrder} overridden={storedOrder !== undefined} busy={busy}
      onApply={(style) => { void run({ action: "trace_style", kind: "order", figure_id: inspection.id, trace: orderIndex, style }); }} />}
    {!initialLine && trace && role && color && !figure.overlay_inputs && <ColorField
      key={`${inspection.id}:${role}:${color}`} figureId={inspection.id}
      element={role} color={color} busy={busy} run={run} />}
    {onConfigure && <button type="button" disabled={busy} onClick={onConfigure}>Plugin settings…</button>}
  </div>;
}

function WorksheetPanel({ project, busy, run, onInspect }: { project: Project; busy: boolean; run: Run; onInspect: (id: string | null) => void }) {
  const panelId = useId();
  if (!project.sources.length) return <p className="dock-empty">Use File → Import Data… to add a worksheet.</p>;
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
        id: "figure", title: "Figure", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel key={projectKey} project={project} onSelect={inspectTrace} onInspect={inspectFigure} onEdit={onEdit} busy={busy} capture={capture} run={run} />,
      },
      {
        id: "worksheet", title: "Worksheet", icon: Table2,
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
          onInspect={(id) => setInspection({ kind: "step", id })} />,
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
  const [inputDialog, setInputDialog] = useState<{ plugin: PluginDefinition; figureId?: number } | "scale" | null>(null);
  const [overlayDialog, setOverlayDialog] = useState(false);
  const [scalarDialog, setScalarDialog] = useState(false);
  const [arrayDialog, setArrayDialog] = useState(false);
  const [stepDialog, setStepDialog] = useState<WorkflowStep | null>(null);
  const [workflowDialog, setWorkflowDialog] = useState<"save" | "run" | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"appearance" | "updates" | null>(null);
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
      if (request.action === "delete_step" && !await confirm("Delete this recorded step? Later steps that use its outputs may fail when rerun.", {
        title: "Delete recorded step",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      })) return false;
      const saving = request.action === "save" || request.action === "save_as";
      const response = await workspace(saving && draft !== null ? { ...request, notes: draft } : request);
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
  const pluginDialog = inputDialog === "scale" ? null : inputDialog;
  const previous = project?.operations.slice().reverse().find((step) =>
    step.kind === "plugin" && pluginDialog && matchesPlugin(step, pluginDialog.plugin));
  const configuring = pluginDialog?.figureId !== undefined;
  const editingSource = configuring && project && figure ? (
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
    return plugins.filter((plugin) => plugin.menu === menu && plugin.category === category && plugin.id !== "nigiro.filter" && plugin.id !== "nigiro.filter_segments" && plugin.id !== columnFormulaId
      && plugin.id !== arrayFormulaId && plugin.id !== "example.scaled_xy").map((plugin) => {
      const columns = columnFields(plugin).length;
      const required = plugin.distinct_columns && plugin.input_mode !== "joint" ? columns : Math.min(columns, 1);
      return {
        label: `${plugin.name}…`,
        icon: plugin.id === "nigiro.scatter" ? ChartScatter : plugin.id === "nigiro.bar" ? ChartColumn
          : plugin.id === "nigiro.line" || plugin.id === "nigiro.linear_fit" ? ChartLine
          : menu === "plot" ? ChartNoAxesCombined : SquareFunction,
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

  function runMenu(request: MenuRequest) {
    closeContextMenu();
    if (request.action === "choose_plugin") {
      setError("");
      setInputDialog({ plugin: request.plugin });
    }
    else if (request.action === "settings") { setError(""); setSettingsDialog("appearance"); }
    else if (request.action === "choose_scale") { setError(""); setInputDialog("scale"); }
    else if (request.action === "choose_overlay") { setError(""); setOverlayDialog(true); }
    else if (request.action === "choose_scalar") { setError(""); setScalarDialog(true); }
    else if (request.action === "choose_array") { setError(""); setArrayDialog(true); }
    else if (request.action === "choose_step") { setError(""); setStepDialog(request.step); }
    else if (request.action === "choose_save_workflow") { setError(""); setWorkflowDialog("save"); }
    else if (request.action === "choose_run_workflow") { setError(""); setWorkflowDialog("run"); }
    else if (request.action === "figure_settings") { setError(""); setFigureDialog("figure"); }
    else if (request.action === "choose_export") setExportDialog(request.target);
    else if (request.action === "manage_item") setItemDialog(request.change);
    else void run(request);
  }

  const menuBusy = busy || scalarDialog || arrayDialog || overlayDialog || stepDialog !== null || workflowDialog !== null
    || settingsDialog !== null || inputDialog !== null || exportDialog !== null || figureDialog !== null || itemDialog !== null;
  const newProject: MenuCommand = { label: "New…", keywords: "create project", icon: FilePlus, request: { action: "new" }, shortcut: "N" };
  const openProject: MenuCommand = { label: "Open Project…", icon: FolderOpen, request: { action: "open" }, shortcut: "O" };
  const newWorkspace: MenuCommand = { label: "New Workspace", icon: FolderPlus, keywords: "create", request: { action: "new_workspace" } };
  const openWorkspace: MenuCommand = { label: "Open Workspace…", icon: FolderOpen, request: { action: "open_workspace" } };
  const dataGroups: MenuCommand[][] = [
    [{ label: "Import Raw Data…", keywords: "csv open load", icon: FileInput, request: { action: "import_data" } }],
    [
      { label: "Add Variable/Constant…", keywords: "create variables constants scalar", icon: Variable, request: { action: "choose_scalar" } },
      { label: "Add Array…", keywords: "create arrays formula", icon: Brackets, request: { action: "choose_array" } },
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
  const scaleCommand: MenuCommand = {
    label: "Scalar multiplication…", icon: Calculator,
    request: project?.sources.some((source) => source.kind === "raw" && source.columns.length)
      ? { action: "choose_scale" } : null,
  };
  const plotCommands = pluginCommands("plot");
  const overlayFigures = project?.figures.filter((figure) => figure.overlayable) ?? [];
  const filterPlugin = plugins.find((plugin) => plugin.id === "nigiro.filter");
  const filterCommand: MenuCommand = { label: "Filter…", icon: Filter, request: filterPlugin && project?.sources.length
    ? { action: "choose_plugin", plugin: filterPlugin } : null };
  const filterSegments = plugins.find((plugin) => plugin.id === "nigiro.filter_segments");
  const filterSegmentsCommand: MenuCommand = { label: "Filter Segments…", icon: ListFilter, request: filterSegments && project?.sources.length
    ? { action: "choose_plugin", plugin: filterSegments } : null };
  const formula = plugins.find((plugin) => plugin.id === columnFormulaId);
  const formulaCommand: MenuCommand = { label: "Column Formula…", icon: SquareFunction, request: formula && project?.sources.length
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
    const activeFigure = project?.figures.find(({ id }) => id === project.figure_id);
    const historyStep = event.target.closest<HTMLElement>("[data-workflow-id]");
    if (historyStep && project) {
      const index = project.workflow.steps.findIndex(({ id }) => String(id) === historyStep.dataset.workflowId);
      const step = project.workflow.steps[index];
      if (!step) return;
      label = "Recorded step actions";
      groups = [[
        { label: "Edit Step…", request: step.files?.length || step.parameters ? { action: "choose_step", step } : null },
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
    } else if (clicked?.dataset.itemKind === "figure" || (activeFigure && event.target.closest(".figure-pane"))) {
      const target = clicked ? project?.figures.find(({ id }) => String(id) === clicked.dataset.itemId) : activeFigure;
      if (!target) return;
      label = "Figure actions";
      const commands = itemCommands({ kind: "figure", id: target.id }, target.name);
      groups = figure && activeFigure?.id === target.id ? [[figureSettings], commands, exportCommands] : [commands];
    } else if (event.target.closest(".source-pane") && (plotCommands.length || analysisCommands.length)) {
      label = "Worksheet actions";
      groups = [[formulaCommand, scaleCommand, filterCommand], plotCommands, analysisCommands].filter((group) => group.length);
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
          { label: "Save as Workflow…", icon: WorkflowIcon, request: project?.workflow.completed ? { action: "choose_save_workflow" } : null },
          { label: "Import Workflow…", icon: FileInput, request: { action: "import_workflow" } },
          { label: "Run Workflow…", icon: Play, request: project?.saved_workflows?.length ? { action: "choose_run_workflow" } : null },
        ],
        exportCommands,
      ],
    },
    {
      label: "Edit",
      groups: [
        [{ label: "Settings…", icon: Settings2, request: { action: "settings" } }],
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
        label: "Overlay…", icon: Layers, keywords: "combine figures shared axes",
        request: overlayFigures.length >= 2 ? { action: "choose_overlay" } : null,
      }]],
    },
    {
      label: "Analysis",
      groups: [analysisCommands, [
        { label: "Operations", icon: Calculator, request: null, submenu: [formulaCommand, scaleCommand, filterCommand] },
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
      {scalarDialog && <ScalarSourceDialog busy={busy} error={error}
        onClose={() => { setScalarDialog(false); setError(""); }}
        onAdd={async (name, value, comment) => { if (await run({ action: "add_scalar", name, value, comment })) setScalarDialog(false); }} />}
      {arrayDialog && <ArraySourceDialog busy={busy} error={error} sources={project?.sources ?? []}
        onClose={() => { setArrayDialog(false); setError(""); }}
        onAdd={async (request) => { if (await run(request)) setArrayDialog(false); }} />}
      {project && overlayDialog && <OverlayDialog figures={overlayFigures} active={project.figure_id} busy={busy} error={error}
        onClose={() => { setOverlayDialog(false); setError(""); }}
        onCreate={async (figure_ids) => { if (await run({ action: "overlay_figures", figure_ids })) setOverlayDialog(false); }} />}
      {stepDialog && <WorkflowStepDialog step={stepDialog} sources={project?.sources ?? []} busy={busy} error={error} onRun={run}
        onClose={() => { setStepDialog(null); setError(""); }} />}
      {project && workflowDialog === "save" && <SaveWorkflowDialog {...{ project, busy, error }} onRun={run}
        onClose={() => { setWorkflowDialog(null); setError(""); }} />}
      {project && workflowDialog === "run" && <RunWorkflowDialog {...{ project, busy, error }} onRun={run}
        onClose={() => { setWorkflowDialog(null); setError(""); }} />}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={closeContextMenu} onRun={runMenu} />}
      {itemDialog && (
        <ItemDialog change={itemDialog} onClose={() => setItemDialog(null)} onApply={(name) => {
          setItemDialog(null);
          void run({ action: "edit_item", item: itemDialog.item, name });
        }} />
      )}
      {project && inputDialog && (
        <InputOptionsDialog target={inputDialog === "scale" ? inputDialog : inputDialog.plugin} project={project} previous={initialOptions}
          configuring={configuring} editingSource={editingSource} busy={busy} error={error}
          onClose={() => { setInputDialog(null); setError(""); }}
          onRun={async (submission) => {
            let success: boolean;
            if (inputDialog === "scale") {
              const runs = submission.runs.map(({ source_id, options }) => ({ source_id, column: Number(options.column) }));
              success = await run({ action: "scale_column", runs, factor: Number(submission.runs[0].options.factor) });
            } else if (inputDialog.plugin.id === columnFormulaId) {
              const { source_id, options } = submission.runs[0];
              success = await run({ action: "apply_formula", source_id, column: Number(options.column), expression: String(options.expression) });
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
      {project && settingsDialog && (
        <FigureSettings global runAutomatically={project.run_automatically} appearance={project.appearance} initial={project.global_figure_style} defaults={project.factory_figure_style}
          initialSection="figure" labels={{ x: "", y: "" }}
          categoricalX={false} bar markers line busy={busy} saveError={error}
          desktop={{ info: desktopInfo, initialPage: settingsDialog, pythonVersion: project.versions.python,
            update: { release, checking: updateChecking, installing: updateInstalling, checked: updateChecked,
              error: updateError, check: checkUpdates, install: installUpdate } }}
          onClose={() => { setSettingsDialog(null); setError(""); }}
          onApply={async (style, appearance, run_automatically, desktop) => {
            if (appearance && await saveDesktopPreferences(desktop)
              && await run({ action: "set_preferences", style, appearance, run_automatically })) setSettingsDialog(null);
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
      {error && !scalarDialog && !overlayDialog && !stepDialog && !workflowDialog && !inputDialog && !settingsDialog && !figureDialog && <div className="error-banner" role="alert">{error}</div>}
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
            <p>Open <strong>File</strong> to import a CSV or try sample data.</p>
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
