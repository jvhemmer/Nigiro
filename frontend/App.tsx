import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ChartNoAxesCombined, Database, FileSpreadsheet, History, SlidersHorizontal, Table2,
} from "lucide-react";
import { DockWorkspace, useRevealDockPanel } from "./DockWorkspace";
import { ExportDialog } from "./ExportDialog";
import { FigureSettings } from "./FigureSettings";
import type { StyleSection } from "./figureStyle";
import { FigurePlot, type CaptureFigure } from "./FitPlot";
import { saveFigure, type ExportSettings, type ExportTarget } from "./exportFigure";
import { MenuBar, type MenuRequest } from "./MenuBar";
import { columnFields, PluginDialog } from "./PluginDialog";
import { ViewTabs, viewTabId } from "./ViewTabs";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, plotNames, workspace,
  type FigureElement, type PluginDefinition, type PluginRun, type Project, type RecordedStep, type Request,
} from "./workspace";

type Run = (request: Request) => Promise<void>;

function matchesPlugin(run: PluginRun, plugin: PluginDefinition) {
  return run.plugin_id === plugin.id && run.version === plugin.version && run.checksum === plugin.checksum;
}

function projectStem(project: Project) {
  const fileName = (project.file_name ?? project.source_name).split(/[\\/]/).at(-1);
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

function stepLabel(operation: RecordedStep, columns: string[], plugins: PluginDefinition[]) {
  switch (operation.kind) {
    case "correct_cell":
      return `Set row ${operation.row + 1}, ${columns[operation.column]} to ${JSON.stringify(operation.value)}`;
    case "plot":
      return `${plotNames[operation.plot_type]} plot of ${columns[operation.y]} against ${columns[operation.x]}`;
    case "linear_fit":
      return `Fit ${columns[operation.y]} against ${columns[operation.x]}`;
    case "plugin":
      return `Run ${plugins.find((plugin) => matchesPlugin(operation, plugin))?.name ?? operation.plugin_id}`;
    case "figure_color":
      return `Change ${elementNames[operation.element].toLowerCase()} color to ${operation.color}`;
    case "figure_style":
    case "figure_appearance":
      return "Change figure settings";
    case "residual_figure":
      return "Create residual figure";
  }
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

function FigurePanel({ project, onSelect, onEdit, busy, capture, run }: {
  project: Project;
  onSelect: (element: FigureElement) => void;
  onEdit: (section: StyleSection) => void;
  busy: boolean;
  run: Run;
  capture: Ref<CaptureFigure>;
}) {
  const panelId = useId();
  const data = project.figure;
  const summary = Object.entries(data?.summary ?? {});
  const figureId = project.figure_id;

  return (
    <div className="figure-pane">
      {project.figures.length > 0 && (
        <div className="view-picker">
          <ViewTabs id={panelId} label="Figures" items={project.figures} selected={figureId} busy={busy}
            onSelect={(id) => { if (id !== null) void run({ action: "select_figure", figure_id: id }); }} />
          {data && <button type="button" disabled={busy} onClick={() => onEdit("figure")}>Figure settings…</button>}
        </div>
      )}
      <div className="figure-content" id={panelId} role={figureId !== null ? "tabpanel" : undefined}
        aria-labelledby={figureId !== null ? viewTabId(panelId, figureId) : undefined}>
        {data && figureId !== null ? (
          <>
            <FigurePlot
              key={figureId}
              capture={capture}
              data={data}
              colors={project.colors}
              style={project.figure_style}
              revision={figureId}
              onEdit={onEdit}
              onSelect={onSelect}
            />
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

function AnalysisPanel({ project, busy, run, element, onSelect, onConfigure }: {
  project: Project;
  busy: boolean;
  run: Run;
  element: FigureElement;
  onSelect: (element: FigureElement) => void;
  onConfigure?: () => void;
}) {
  const available = (["observations", "fit"] as const).filter((role) => project.figure?.elements?.includes(role));
  const selected = available.includes(element) ? element : available[0];
  const input = project.sources.find((source) => source.id === (project.figure?.recipe.source_id ?? null));
  return (
    <div className="inspector">
      {project.figure && <section className="fit-settings">
        <div className="section-header"><h2>{project.figure.definition.name}</h2></div>
        {input && <p className="figure-input muted">Input · {input.name}</p>}
        {onConfigure && <button type="button" disabled={busy} onClick={onConfigure}>Plugin settings…</button>}
      </section>}
      {selected && project.figure_id !== null && (
        <section className="element-settings" aria-labelledby="element-heading">
          <div className="section-header"><h2 id="element-heading">Figure element</h2></div>
          <div className="element-list">
            {available.map((item) => (
              <button
                key={item}
                aria-pressed={item === selected}
                onClick={() => onSelect(item)}
              >
                <span
                  className={item === "fit" ? "swatch line-swatch" : "swatch"}
                  style={{ backgroundColor: project.colors[item] }}
                />
                {elementNames[item]}
              </button>
            ))}
          </div>
          <ColorField
            key={`${project.figure_id}:${selected}:${project.colors[selected]}`}
            figureId={project.figure_id}
            element={selected}
            color={project.colors[selected]}
            busy={busy}
            run={run}
          />
        </section>
      )}
    </div>
  );
}

function WorksheetPanel({ project, busy, run }: { project: Project; busy: boolean; run: Run }) {
  const panelId = useId();
  return (
    <div className="source-pane">
      <div className="view-picker">
        <ViewTabs id={panelId} label="Worksheet sources" items={project.sources} selected={project.source_id}
          busy={busy} onSelect={(id) => void run({ action: "select_source", source_id: id })} />
      </div>
      <div className="source-content" id={panelId} role="tabpanel" aria-labelledby={viewTabId(panelId, project.source_id)}>
        <Worksheet key={project.source_id ?? "raw"}
          columns={project.source_table?.columns ?? project.columns}
          rows={project.source_table?.rows ?? project.rows}
          originalRows={project.source_id === null ? project.original_rows : undefined}
          busy={busy}
          onCorrect={(row, column, value) => void run({ action: "correct", row, column, value })} />
      </div>
    </div>
  );
}

function SourcesPanel({ project, busy, run }: { project: Project; busy: boolean; run: Run }) {
  const reveal = useRevealDockPanel();
  return (
    <ul className="source-list" aria-label="Project sources">
      {project.sources.map((source) => (
        <li key={source.id ?? "raw"}>
          <button type="button" title={source.name} aria-current={source.id === project.source_id} disabled={busy}
            onClick={async () => {
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

function ProjectEditor({ project, plugins, busy, run, onConfigure, onEdit, capture }: {
  project: Project;
  capture: Ref<CaptureFigure>;
  busy: boolean;
  run: Run;
  plugins: PluginDefinition[];
  onConfigure?: () => void;
  onEdit: (section: StyleSection) => void;
}) {
  const [element, setElement] = useState<FigureElement>("fit");
  return (
    <DockWorkspace panels={[
      {
        id: "figure", title: "Figure", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel project={project} onSelect={setElement} onEdit={onEdit} busy={busy} capture={capture} run={run} />,
      },
      {
        id: "worksheet", title: "Worksheet", icon: Table2,
        position: { referencePanel: "figure", direction: "left" },
        initialWidth: 320, minimumWidth: 170, minimumHeight: 150,
        content: <WorksheetPanel project={project} busy={busy} run={run} />,
      },
      {
        id: "sources", title: "Sources", icon: Database,
        position: { referencePanel: "worksheet", direction: "above" },
        initialHeight: 115, minimumWidth: 150, minimumHeight: 65,
        content: <SourcesPanel project={project} busy={busy} run={run} />,
      },
      {
        id: "history", title: "Recorded steps", icon: History,
        position: { referencePanel: "worksheet", direction: "below" },
        initialHeight: 180, minimumWidth: 150, minimumHeight: 90,
        content: (
          <div className="history">
            <ol>
              <li>Import {project.source_name}</li>
              {project.operations.map((step, index) => <li key={index}>{stepLabel(step, project.columns, plugins)}</li>)}
            </ol>
          </div>
        ),
      },
      {
        id: "analysis", title: "Analysis", icon: SlidersHorizontal,
        position: { referencePanel: "figure", direction: "right" },
        initialWidth: 230, minimumWidth: 186,
        content: (
          <AnalysisPanel {...{ project, busy, run, element, onConfigure }} onSelect={setElement} />
        ),
      },
    ]} />
  );
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectKey, setProjectKey] = useState(0);
  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);
  const [pluginDialog, setPluginDialog] = useState<{ plugin: PluginDefinition; figureId?: number } | null>(null);
  const [figureDialog, setFigureDialog] = useState<StyleSection | null>(null);
  const [exportDialog, setExportDialog] = useState<ExportTarget | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({ format: "pdf", scale: 3 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectRef = useRef(project);
  const inFlight = useRef(false);
  const capture = useRef<CaptureFigure>(null);

  const run = useCallback<Run>(async (request) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const replace = ["sample", "import_csv", "open"].includes(request.action);
      if (replace && projectRef.current?.dirty && !await confirmDiscard()) return;
      const response = await workspace(request);
      if (response) {
        setPlugins(response.plugins);
        projectRef.current = response.project;
        setProject(response.project);
        if (replace) setProjectKey((key) => key + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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

  const figure = project?.figure;
  const figureNumber = project ? project.figures.findIndex((item) => item.id === project.figure_id) + 1 : 0;
  const exportName = project && figure
    ? projectStem(project) + (project.figures.length > 1 ? `-figure-${figureNumber}` : "") : null;
  const editableTraces = figure?.traces.filter((_, index) => figure.elements?.[index]) ?? [];
  const sourceColumns = project?.source_table?.columns ?? project?.columns ?? [];
  const inputId = pluginDialog?.figureId !== undefined ? figure?.recipe.source_id : project?.source_id;
  const sourceName = project?.sources.find((source) => source.id === (inputId ?? null))?.name;
  const previous = project?.operations.slice().reverse().find((step) =>
    step.kind === "plugin" && pluginDialog && matchesPlugin(step, pluginDialog.plugin));
  const configuring = pluginDialog?.figureId !== undefined;
  const initialOptions = figure && configuring
    ? figure.recipe.options : previous?.kind === "plugin" ? previous.options : undefined;

  function pluginCommands(menu: PluginDefinition["menu"]) {
    return plugins.filter((plugin) => plugin.menu === menu).map((plugin) => {
      const columns = columnFields(plugin).length;
      const required = plugin.distinct_columns ? columns : Math.min(columns, 1);
      return {
        label: `${plugin.name}…`,
        request: project && sourceColumns.length >= required ? { action: "choose_plugin", plugin } as const : null,
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
      await saveFigure(exportName, target, settings, capture.current, project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function runMenu(request: MenuRequest) {
    if (request.action === "choose_plugin") setPluginDialog({ plugin: request.plugin });
    else if (request.action === "figure_settings") setFigureDialog("figure");
    else if (request.action === "choose_export") setExportDialog(request.target);
    else void run(request);
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand"><ChartNoAxesCombined size={21} /><span>Nigiro</span></div>
        <MenuBar
          busy={busy || pluginDialog !== null || exportDialog !== null || figureDialog !== null}
          onRun={runMenu}
          menus={[
            {
              label: "File",
              groups: [
                [
                  { label: "Import CSV…", request: { action: "import_csv" } },
                  { label: "Open Project…", request: { action: "open" }, shortcut: "O" },
                  { label: "Try Sample Data", request: { action: "sample" } },
                ],
                [
                  { label: "Save", request: project ? saveRequest(project) : null, shortcut: "S" },
                  {
                    label: "Save As…",
                    request: project ? { action: "save_as", name: projectStem(project) } : null,
                    shortcut: "Shift+S",
                  },
                ],
                [
                  { label: "Export Figure…", request: exportName ? { action: "choose_export", target: "figure" } : null },
                  { label: "Export Python Script…", request: exportName ? { action: "choose_export", target: "script" } : null },
                ],
              ],
            },
            {
              label: "Plot",
              groups: [
                pluginCommands("plot"),
                [{ label: "Figure Settings…", request: exportName ? { action: "figure_settings" } : null }],
              ],
            },
            {
              label: "Analysis",
              groups: [pluginCommands("analysis")],
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
            <span title={project.file_name ?? project.source_name}>
              {project.file_name ?? project.source_name}
            </span>
            {project.dirty && <span className="dirty" title="Unsaved changes" aria-label="Unsaved changes" />}
          </div>
        )}
      </header>
      {project && pluginDialog && (
        <PluginDialog plugin={pluginDialog.plugin}
          columns={configuring ? project.figure_input?.columns ?? project.columns : sourceColumns}
          previous={initialOptions} configuring={configuring} sourceName={sourceName}
          onClose={() => setPluginDialog(null)}
          onRun={(options) => {
            setPluginDialog(null);
            void run({
              action: "run_plugin", plugin_id: pluginDialog.plugin.id, version: pluginDialog.plugin.version,
              checksum: pluginDialog.plugin.checksum, figure_id: pluginDialog.figureId, options,
            });
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
      {project && figure && project.figure_id !== null && figureDialog && (
        <FigureSettings
          initial={project.figure_style}
          defaults={project.default_figure_style}
          initialSection={figureDialog}
          labels={{ x: figure.x_label ?? "", y: figure.y_label ?? "", residual: "Residual" }}
          fit={!!figure.residual_panel}
          categoricalX={!!figure.categorical_x}
          bar={editableTraces.some((trace) => trace.type === "bar")}
          markers={editableTraces.some((trace) => trace.type === "scatter" && trace.mode?.includes("markers"))}
          line={editableTraces.some((trace) => trace.type === "scatter" && trace.mode?.includes("lines"))}
          onClose={() => setFigureDialog(null)}
          onApply={(style) => {
            setFigureDialog(null);
            if (project.figure_id !== null) void run({ action: "figure_style", style, figure_id: project.figure_id });
          }}
        />
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {project ? (
        <ProjectEditor key={projectKey} {...{ project, plugins, busy, run, capture }}
          onConfigure={figure && project.figure_id !== null
            ? () => setPluginDialog({ plugin: figure.definition, figureId: project.figure_id ?? undefined }) : undefined} onEdit={setFigureDialog} />
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
