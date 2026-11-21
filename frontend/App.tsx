import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type Ref } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ChartNoAxesCombined, Database, FileSpreadsheet, History, ScanSearch, Table2,
} from "lucide-react";
import { DockWorkspace, useRevealDockPanel } from "./DockWorkspace";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { ExportDialog } from "./ExportDialog";
import { applyAppearance, cacheAppearance } from "./appearance";
import { FigureSettings } from "./FigureSettings";
import { axisSettings, type StyleSection } from "./figureStyle";
import { FigurePlot, type CaptureFigure } from "./FitPlot";
import { ItemDialog, type ItemAction } from "./ItemDialog";
import { saveFigure, type ExportSettings, type ExportTarget } from "./exportFigure";
import { MenuBar, type MenuCommand, type MenuRequest } from "./MenuBar";
import { columnFields, InputOptionsDialog } from "./InputOptionsDialog";
import { useListDrag } from "./useListDrag";
import { ViewTabs, viewTabId } from "./ViewTabs";
import { WorkflowPanel, WorkflowStepDialog } from "./WorkflowPanel";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, workspace,
  type FigureElement, type PluginDefinition, type PluginRun, type Project, type Request, type WorkflowStep, type WorkspaceItem,
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

function confirmDiscard() {
  return confirm("Discard the unsaved changes to this project?", {
    title: "Unsaved project",
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

type Inspection =
  | { kind: "source"; id: string | null }
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
                  revision={id}
                  onEdit={onEdit}
                  onSelect={onSelect}
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

function InspectPanel({ project, inspection, busy, run, onConfigure }: {
  project: Project;
  inspection: Inspection | null;
  busy: boolean;
  run: Run;
  onConfigure?: () => void;
}) {
  const source = inspection?.kind === "source" ? project.sources.find(({ id }) => id === inspection.id) : undefined;
  if (source) {
    return <div className="inspector inspect-details">
      <h2>{source.name}</h2>
      <dl>
        <dt>Type</dt><dd>{source.kind === "raw" ? "Imported data" : "Derived data"}</dd>
        <dt>Original path</dt><dd>{source.original_path ?? "Unavailable"}</dd>
        <dt>Rows</dt><dd>{source.row_count.toLocaleString()}</dd>
        <dt>Columns</dt><dd>{source.columns.join(", ")}</dd>
      </dl>
    </div>;
  }
  const figure = inspection?.kind === "figure" && inspection.id === project.figure_id ? project.figure : null;
  if (!figure || inspection?.kind !== "figure") {
    return <p className="dock-empty">Select a source, figure, or trace to inspect it.</p>;
  }
  const index = inspection.trace;
  const trace = index === undefined ? undefined : figure.traces[index];
  const role = index === undefined ? undefined : figure.elements?.[index];
  const seriesColor = index === undefined ? undefined : figure.series_colors?.[index];
  const line = trace && "line" in trace ? trace.line : undefined;
  const marker = trace && "marker" in trace ? trace.marker : undefined;
  const traceColor = (line && "color" in line ? line.color : undefined)
    ?? (marker && "color" in marker ? marker.color : undefined);
  const scatter = trace?.type === "scatter" || trace?.type === "scattergl";
  const traceMode = scatter ? trace.mode : undefined;
  const color = seriesColor ?? (role ? project.colors[role] : typeof traceColor === "string" ? traceColor : undefined);
  const figureName = project.figures.find(({ id }) => id === inspection.id)?.name;
  const input = project.sources.find(({ id }) => id === (figure.recipe.source_id ?? null));
  return <div className="inspector inspect-details">
    <h2>{trace ? trace.name || `Trace ${(index ?? 0) + 1}` : figureName}</h2>
    <dl>
      <dt>Plugin</dt><dd>{figure.definition.name}</dd>
      {figure.overlay_inputs ? <><dt>Inputs</dt><dd>{figure.overlay_inputs.map(({ label }) => label).join(", ")}</dd></>
        : input && <><dt>Input</dt><dd>{input.name}</dd></>}
      {trace && <>
        <dt>Legend label</dt><dd>{trace.name ?? "Unnamed"}</dd>
        <dt>Trace type</dt><dd>{trace.type ?? "Scatter"}</dd>
        {color && <><dt>Color</dt><dd><span className="swatch" style={{ backgroundColor: color }} /> {color}</dd></>}
        {role && traceMode?.includes("lines") && project.figure_style.show_lines &&
          <><dt>Line</dt><dd>{project.figure_style.line_width} px · {project.figure_style.line_dash}
            {project.figure_style.line_color && ` · ${project.figure_style.line_color}`}</dd></>}
        {role && traceMode?.includes("markers") && project.figure_style.show_markers &&
          <><dt>Markers</dt><dd>{project.figure_style.marker_size} px · {project.figure_style.marker_symbol}
            {project.figure_style.marker_color && ` · ${project.figure_style.marker_color}`}</dd></>}
      </>}
    </dl>
    {trace && role && color && !figure.overlay_inputs && <ColorField
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

function SourcesPanel({ project, busy, run, onInspect }: { project: Project; busy: boolean; run: Run; onInspect: (id: string | null) => void }) {
  const reveal = useRevealDockPanel();
  const drag = useListDrag(busy, (from, to) => {
    void run({ action: "move_source", source_id: project.sources[from].id, destination: to });
  });
  if (!project.sources.length) return <p className="dock-empty">No sources in this project.</p>;
  return (
    <ul className="source-list" aria-label="Project sources">
      {project.sources.map((source, index) => (
        <li key={source.id ?? "raw"} {...drag(index)}>
          <button type="button" title={source.name} aria-current={source.id === project.source_id} disabled={busy}
            data-item-kind="source" data-item-id={source.id ?? ""}
            onClick={async () => {
              onInspect(source.id);
              if (source.id !== project.source_id) await run({ action: "select_source", source_id: source.id });
              reveal("worksheet");
            }}>
            <Table2 size={13} aria-hidden="true" />
            <span>{source.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProjectEditor({ project, busy, run, onConfigure, onEdit, capture }: {
  project: Project;
  capture: Ref<CaptureFigure>;
  busy: boolean;
  run: Run;
  onConfigure?: () => void;
  onEdit: (section: StyleSection) => void;
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const inspectSource = (id: string | null) => setInspection({ kind: "source", id });
  const inspectTrace = useCallback((id: number, trace: number) => setInspection({ kind: "figure", id, trace }), []);
  const inspectFigure = (id: number) => setInspection({ kind: "figure", id });
  return (
    <DockWorkspace panels={[
      {
        id: "figure", title: "Figure", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel project={project} onSelect={inspectTrace} onInspect={inspectFigure} onEdit={onEdit} busy={busy} capture={capture} run={run} />,
      },
      {
        id: "worksheet", title: "Worksheet", icon: Table2,
        position: { referencePanel: "figure", direction: "within" },
        minimumWidth: 170, minimumHeight: 150,
        content: <WorksheetPanel project={project} busy={busy} run={run} onInspect={inspectSource} />,
      },
      {
        id: "sources", title: "Sources", icon: Database,
        position: { referencePanel: "figure", direction: "left" },
        initialWidth: 260, minimumWidth: 150, minimumHeight: 65,
        content: <SourcesPanel project={project} busy={busy} run={run} onInspect={inspectSource} />,
      },
      {
        id: "history", title: "Recorded steps", icon: History,
        position: { referencePanel: "sources", direction: "below" },
        initialHeight: 180, minimumWidth: 150, minimumHeight: 90,
        content: <WorkflowPanel workflow={project.workflow} busy={busy} run={run} />,
      },
      {
        id: "analysis", title: "Inspect", icon: ScanSearch,
        position: { referencePanel: "figure", direction: "right" },
        initialWidth: 230, minimumWidth: 186,
        content: (
          <InspectPanel {...{ project, busy, run, inspection, onConfigure }} />
        ),
      },
    ]} />
  );
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectKey, setProjectKey] = useState(0);
  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);
  const [inputDialog, setInputDialog] = useState<{ plugin: PluginDefinition; figureId?: number } | "scale" | null>(null);
  const [stepDialog, setStepDialog] = useState<WorkflowStep | null>(null);
  const [settingsDialog, setSettingsDialog] = useState(false);
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
      const replace = request.action === "new" || request.action === "open";
      if (replace && projectRef.current?.dirty && !await confirmDiscard()) return false;
      const response = await workspace(request);
      if (response) {
        setPlugins(response.plugins);
        projectRef.current = response.project;
        setProject(response.project);
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
  }, []);

  useEffect(() => {
    void run({ action: "state" });

    const currentWindow = getCurrentWindow();
    let confirmingClose = false;
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      if (inFlight.current) {
        event.preventDefault();
      } else if (projectRef.current?.dirty) {
        event.preventDefault();
        if (confirmingClose) return;
        confirmingClose = true;
        try {
          if (await confirmDiscard()) await currentWindow.destroy();
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
    project.sources.find(({ id }) => id === (figure.recipe.source_id ?? null)) ?? {
      id: figure.recipe.source_id ?? null,
      name: project.figure_input?.name ?? "Figure input",
      columns: project.figure_input?.columns ?? project.columns,
    }
  ) : undefined;
  const initialOptions = figure && configuring
    ? figure.recipe.options : previous?.kind === "plugin" ? previous.options : undefined;

  function pluginCommands(menu: PluginDefinition["menu"]) {
    return plugins.filter((plugin) => plugin.menu === menu && plugin.id !== "nigiro.filter" && plugin.id !== "example.scaled_xy").map((plugin) => {
      const columns = columnFields(plugin).length;
      const required = plugin.distinct_columns ? columns : Math.min(columns, 1);
      return {
        label: `${plugin.name}…`,
        request: project?.sources.some(({ columns }) => columns.length >= required)
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
    else if (request.action === "settings") { setError(""); setSettingsDialog(true); }
    else if (request.action === "choose_scale") { setError(""); setInputDialog("scale"); }
    else if (request.action === "choose_step") { setError(""); setStepDialog(request.step); }
    else if (request.action === "figure_settings") { setError(""); setFigureDialog("figure"); }
    else if (request.action === "choose_export") setExportDialog(request.target);
    else if (request.action === "manage_item") setItemDialog(request.change);
    else void run(request);
  }

  const menuBusy = busy || stepDialog !== null || settingsDialog || inputDialog !== null || exportDialog !== null || figureDialog !== null || itemDialog !== null;
  const openCommands: MenuCommand[] = [
    { label: "New…", request: { action: "new" }, shortcut: "N" },
    { label: "Import Data…", request: { action: "import_data" } },
    { label: "Open Project…", request: { action: "open" }, shortcut: "O" },
    { label: "Try Sample Data", request: { action: "sample" } },
  ];
  const exportCommands: MenuCommand[] = [
    { label: "Export Figure…", request: exportName ? { action: "choose_export", target: "figure" } : null },
    { label: "Export Python Script…", request: exportName ? { action: "choose_export", target: "script" } : null },
  ];
  const figureSettings: MenuCommand = {
    label: "Figure Settings…", request: exportName ? { action: "figure_settings" } : null,
  };
  const scaleCommand: MenuCommand = {
    label: "Scalar multiplication…",
    request: project?.sources.some((source) => source.kind === "raw" && source.columns.length)
      ? { action: "choose_scale" } : null,
  };
  const plotCommands = pluginCommands("plot");
  const filterPlugin = plugins.find((plugin) => plugin.id === "nigiro.filter");
  const filterCommand: MenuCommand = { label: "Filter…", request: filterPlugin && project?.sources.length
    ? { action: "choose_plugin", plugin: filterPlugin } : null };
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
    let groups = [openCommands];
    const clicked = event.target.closest<HTMLElement>("[data-item-kind][data-item-id]");
    const activeFigure = project?.figures.find(({ id }) => id === project.figure_id);
    const historyStep = event.target.closest<HTMLElement>("[data-workflow-id]");
    if (historyStep && project) {
      const index = project.workflow.steps.findIndex(({ id }) => String(id) === historyStep.dataset.workflowId);
      const step = project.workflow.steps[index];
      if (!step) return;
      label = "Recorded step actions";
      groups = [[
        { label: "Edit Step…", request: step.options.length ? { action: "choose_step", step } : null },
        { label: "Move Earlier", request: index > 0 ? { action: "move_step", step_id: step.id, direction: -1 } : null },
        { label: "Move Later", request: index < project.workflow.steps.length - 1 ? { action: "move_step", step_id: step.id, direction: 1 } : null },
      ]];
    } else if (clicked?.dataset.itemKind === "source" && project) {
      const index = project.sources.findIndex(({ id }) => (id ?? "") === clicked.dataset.itemId);
      const source = project.sources[index];
      if (!source) return;
      label = "Source actions";
      groups = [itemCommands({ kind: "source", id: source.id }, source.name), [
        { label: "Move Earlier", request: index > 0 ? { action: "move_source", source_id: source.id, destination: index - 1 } : null },
        { label: "Move Later", request: index < project.sources.length - 1 ? { action: "move_source", source_id: source.id, destination: index + 1 } : null },
      ]];
    } else if (clicked?.dataset.itemKind === "figure" || (activeFigure && event.target.closest(".figure-pane"))) {
      const target = clicked ? project?.figures.find(({ id }) => String(id) === clicked.dataset.itemId) : activeFigure;
      if (!target) return;
      label = "Figure actions";
      const commands = itemCommands({ kind: "figure", id: target.id }, target.name);
      groups = figure && activeFigure?.id === target.id ? [[figureSettings], commands, exportCommands] : [commands];
    } else if (event.target.closest(".source-pane") && (plotCommands.length || analysisCommands.length)) {
      label = "Worksheet actions";
      groups = [[scaleCommand, filterCommand], plotCommands, analysisCommands].filter((group) => group.length);
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

  return (
    <div className="app" onContextMenu={openContextMenu} onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("[data-workflow-id]")) openContextMenu(event);
    }}>
      <header className="app-bar">
        <div className="brand"><ChartNoAxesCombined size={21} /><span>Nigiro</span></div>
        <MenuBar
          busy={menuBusy}
          onRun={runMenu}
          menus={[
            {
              label: "File",
              groups: [
                openCommands,
                [
                  { label: "Save", request: project ? saveRequest(project) : null, shortcut: "S" },
                  {
                    label: "Save As…",
                    request: project ? { action: "save_as", name: projectStem(project) } : null,
                    shortcut: "Shift+S",
                  },
                ],
                exportCommands,
              ],
            },
            {
              label: "Edit",
              groups: [[{ label: "Settings…", request: { action: "settings" } }]],
            },
            {
              label: "Plot",
              groups: [plotCommands],
            },
            {
              label: "Analysis",
              groups: [analysisCommands, [{ label: "Operations", request: null, submenu: [scaleCommand, filterCommand] }]],
            },
            {
              label: "Plugins",
              groups: [[{ label: "Install Python Plugin…", request: { action: "install_plugin" } }]],
            },
          ]}
        />
        {project && (
          <div className="project-name">
            <FileSpreadsheet size={17} />
            <span title={project.file_name ?? "Untitled"}>
              {project.file_name ?? "Untitled"}
            </span>
            {project.dirty && <span className="dirty" title="Unsaved changes" aria-label="Unsaved changes" />}
          </div>
        )}
      </header>
      {stepDialog && <WorkflowStepDialog step={stepDialog} busy={busy} error={error} onRun={run}
        onClose={() => { setStepDialog(null); setError(""); }} />}
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
          onClose={() => { setSettingsDialog(false); setError(""); }}
          onApply={async (style, appearance, run_automatically) => {
            if (appearance && await run({ action: "set_preferences", style, appearance, run_automatically })) setSettingsDialog(false);
          }} />
      )}
      {project && figure && project.figure_id !== null && figureDialog && (
        <FigureSettings
          initial={project.figure_style}
          busy={busy} saveError={error}
          onSaveGlobal={async (section, key, value, unit) => {
            const global = project.global_figure_style;
            const axis = section;
            const units = { ...(axis === "figure" ? global.units : axisSettings(global, axis).units) };
            if (unit) units[key] = unit;
            else delete units[key];
            const style = axis === "figure" ? { ...global, [key]: value, units }
              : { ...global, [axis]: { ...axisSettings(global, axis), [key]: value, units } };
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
      {error && !stepDialog && !inputDialog && !settingsDialog && !figureDialog && <div className="error-banner" role="alert">{error}</div>}
      {project ? (
        <ProjectEditor key={projectKey} {...{ project, busy, run, capture }}
          onConfigure={figure && !figure.overlay_inputs && project.figure_id !== null
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
    </div>
  );
}
