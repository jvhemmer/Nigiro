import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ChartNoAxesCombined, FileSpreadsheet, History, SlidersHorizontal, Table2,
} from "lucide-react";
import { DockWorkspace } from "./DockWorkspace";
import { ExportDialog } from "./ExportDialog";
import { FigureSettings } from "./FigureSettings";
import type { StyleSection } from "./figureStyle";
import { FigurePlot, type CaptureFigure } from "./FitPlot";
import { saveFigure, type ExportSettings, type ExportTarget } from "./exportFigure";
import { MenuBar, type MenuRequest } from "./MenuBar";
import { PlotDialog } from "./PlotDialog";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, plotNames, workspace,
  type FigureElement, type PlotKind, type Project, type RecordedStep, type Request,
} from "./workspace";

type Run = (request: Request) => Promise<void>;

interface FitColumns {
  x: number;
  y: number;
}

function lastFit(project: Project) {
  return [...project.operations].reverse().find((step) => step.kind === "linear_fit");
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

function stepLabel(operation: RecordedStep, columns: string[]) {
  switch (operation.kind) {
    case "correct_cell":
      return `Set row ${operation.row + 1}, ${columns[operation.column]} to ${JSON.stringify(operation.value)}`;
    case "plot":
      return `${plotNames[operation.plot_type]} plot of ${columns[operation.y]} against ${columns[operation.x]}`;
    case "linear_fit":
      return `Fit ${columns[operation.y]} against ${columns[operation.x]}`;
    case "figure_color":
      return `Change ${elementNames[operation.element].toLowerCase()} color to ${operation.color}`;
    case "figure_style":
      return "Change figure settings";
  }
}

function FitSettings({ columns, selection, busy, onChange }: {
  columns: string[];
  selection: FitColumns;
  busy: boolean;
  onChange: (selection: FitColumns) => void;
}) {
  const options = columns.map((name, index) => (
    <option key={index} value={index}>{name || `Column ${index + 1}`}</option>
  ));

  return (
    <section className="fit-settings">
      <div className="section-header"><h2>Linear fit</h2></div>
      {(["x", "y"] as const).map((axis) => (
        <label key={axis}>
          <span>{axis.toUpperCase()} column</span>
          <select
            value={selection[axis]}
            disabled={busy}
            onChange={(event) => onChange({ ...selection, [axis]: Number(event.target.value) })}
          >
            {options}
          </select>
        </label>
      ))}
    </section>
  );
}

function ColorField({
  element, color, busy, run,
}: { element: FigureElement; color: string; busy: boolean; run: Run }) {
  const [draft, setDraft] = useState(color);
  return (
    <form
      className="color-field"
      onSubmit={(event) => { event.preventDefault(); void run({ action: "color", element, color: draft }); }}
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

function FigurePanel({ project, onSelect, onEdit, busy, capture }: {
  project: Project;
  onSelect: (element: FigureElement) => void;
  onEdit: (section: StyleSection) => void;
  busy: boolean;
  capture: Ref<CaptureFigure>;
}) {
  const recipe = lastFit(project);
  const fit = project.fit;
  const plot = project.plot;
  const axes = plot ?? recipe;
  const data = plot ?? fit;
  const revision = project.operations.reduce((previous, step, index) =>
    step.kind === "linear_fit" || step.kind === "plot" ? index : previous, 0);

  return (
    <div className="figure-pane">
      {data && axes ? (
        <>
          <div className="figure-toolbar">
            <p className="figure-hint muted">Select a line or point to edit its color</p>
            <button type="button" disabled={busy} onClick={() => onEdit("figure")}>Figure settings…</button>
          </div>
          <FigurePlot
            capture={capture}
            data={data}
            xLabel={project.columns[axes.x]}
            yLabel={project.columns[axes.y]}
            colors={project.colors}
            style={project.figure_style}
            revision={revision}
            onEdit={onEdit}
            onSelect={onSelect}
          />
          {fit && <dl className="fit-summary">
            <div><dt>Slope</dt><dd>{formatNumber(fit.slope)}</dd></div>
            <div><dt>Intercept</dt><dd>{formatNumber(fit.intercept)}</dd></div>
            <div><dt>R²</dt><dd>{formatNumber(fit.r_squared)}</dd></div>
            <div><dt>Observations</dt><dd>{fit.x.length.toLocaleString()}</dd></div>
            <div><dt>Omitted</dt><dd>{fit.omitted_rows.toLocaleString()}</dd></div>
          </dl>}
          {plot && <p className="figure-hint muted">{plot.y_values.length} observations · {plot.omitted_rows} omitted</p>}
        </>
      ) : (
        <div className="empty-figure">
          <ChartNoAxesCombined size={36} strokeWidth={1.5} />
          {project.plot_error || project.fit_error
            ? <p role="alert">{project.plot_error || project.fit_error}</p>
            : <p>Choose a plot type from <strong>Plot</strong> to create a figure.</p>}
        </div>
      )}
    </div>
  );
}

function AnalysisPanel({ project, busy, run, element, onSelect, fitColumns, onFitColumnsChange }: {
  project: Project;
  busy: boolean;
  run: Run;
  element: FigureElement;
  onSelect: (element: FigureElement) => void;
  fitColumns: FitColumns;
  onFitColumnsChange: (selection: FitColumns) => void;
}) {
  const selected = project.fit ? element : "observations";
  return (
    <div className="inspector">
      <FitSettings
        columns={project.columns}
        selection={fitColumns}
        busy={busy}
        onChange={onFitColumnsChange}
      />
      {(project.fit || project.plot) && (
        <section className="element-settings" aria-labelledby="element-heading">
          <div className="section-header"><h2 id="element-heading">Figure element</h2></div>
          <div className="element-list">
            {(["observations", "fit"] as const).filter((item) => item !== "fit" || project.fit).map((item) => (
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
            key={`${selected}:${project.colors[selected]}`}
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

function ProjectEditor({ project, busy, run, fitColumns, onFitColumnsChange, onEdit, capture }: {
  project: Project;
  capture: Ref<CaptureFigure>;
  busy: boolean;
  run: Run;
  fitColumns: FitColumns;
  onFitColumnsChange: (selection: FitColumns) => void;
  onEdit: (section: StyleSection) => void;
}) {
  const [element, setElement] = useState<FigureElement>("fit");
  return (
    <DockWorkspace panels={[
      {
        id: "figure", title: "Figure", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel project={project} onSelect={setElement} onEdit={onEdit} busy={busy} capture={capture} />,
      },
      {
        id: "worksheet", title: "Worksheet", icon: Table2,
        position: { referencePanel: "figure", direction: "left" },
        initialWidth: 320, minimumWidth: 170, minimumHeight: 150,
        content: (
          <Worksheet
            columns={project.columns}
            rows={project.rows}
            originalRows={project.original_rows}
            busy={busy}
            onCorrect={(row, column, value) => void run({ action: "correct", row, column, value })}
          />
        ),
      },
      {
        id: "history", title: "Recorded steps", icon: History,
        position: { referencePanel: "worksheet", direction: "below" },
        initialHeight: 180, minimumWidth: 150, minimumHeight: 90,
        content: (
          <div className="history">
            <ol>
              <li>Import {project.source_name}</li>
              {project.operations.map((step, index) => <li key={index}>{stepLabel(step, project.columns)}</li>)}
            </ol>
          </div>
        ),
      },
      {
        id: "analysis", title: "Analysis", icon: SlidersHorizontal,
        position: { referencePanel: "figure", direction: "right" },
        initialWidth: 230, minimumWidth: 186,
        content: (
          <AnalysisPanel {...{ project, busy, run, element, fitColumns, onFitColumnsChange }} onSelect={setElement} />
        ),
      },
    ]} />
  );
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectKey, setProjectKey] = useState(0);
  const [fitColumns, setFitColumns] = useState<FitColumns>({ x: 0, y: 0 });
  const [plotDialog, setPlotDialog] = useState<PlotKind | null>(null);
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
        if (response.project && (replace || !projectRef.current)) {
          const recipe = lastFit(response.project);
          setFitColumns({ x: recipe?.x ?? 0, y: recipe?.y ?? Math.min(1, response.project.columns.length - 1) });
        }
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

  const exportName = project && (project.fit || project.plot) ? projectStem(project) : null;
  const currentRecipe = project && (project.plot ?? lastFit(project));
  const previousPlot = project?.operations.slice().reverse().find((step) => step.kind === "plot");

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
    if (request.action === "choose_plot") setPlotDialog(request.plot_type);
    else if (request.action === "figure_settings") setFigureDialog("figure");
    else if (request.action === "choose_export") setExportDialog(request.target);
    else void run(request);
  }
  const canFit = project && fitColumns.x !== fitColumns.y;

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand"><ChartNoAxesCombined size={21} /><span>Nigiro</span></div>
        <MenuBar
          busy={busy || plotDialog !== null || exportDialog !== null || figureDialog !== null}
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
                (Object.keys(plotNames) as PlotKind[]).map((plot_type) => ({
                  label: `${plotNames[plot_type]}…`,
                  request: project && project.columns.length >= 2 ? { action: "choose_plot", plot_type } as const : null,
                })),
                [{ label: "Figure Settings…", request: exportName ? { action: "figure_settings" } : null }],
              ],
            },
            {
              label: "Analysis",
              groups: [[{ label: "Linear Fit", request: canFit ? { action: "fit", ...fitColumns } : null }]],
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
      {project && plotDialog && (
        <PlotDialog kind={plotDialog} columns={project.columns}
          initialX={previousPlot?.x ?? 0} initialY={previousPlot?.y ?? 1}
          onClose={() => setPlotDialog(null)}
          onPlot={(x, y) => {
            setPlotDialog(null);
            void run({ action: "plot", plot_type: plotDialog, x, y });
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
      {project && currentRecipe && figureDialog && (
        <FigureSettings
          initial={project.figure_style}
          defaults={project.default_figure_style}
          initialSection={figureDialog}
          labels={{ x: project.columns[currentRecipe.x], y: project.columns[currentRecipe.y], residual: "Residual" }}
          fit={!!project.fit}
          bar={project.plot?.plot_type === "bar"}
          line={!!project.fit || project.plot?.plot_type === "line"}
          onClose={() => setFigureDialog(null)}
          onApply={(style) => {
            setFigureDialog(null);
            void run({ action: "figure_style", style });
          }}
        />
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {project ? (
        <ProjectEditor key={projectKey} {...{ project, busy, run, fitColumns, capture }}
          onFitColumnsChange={setFitColumns} onEdit={setFigureDialog} />
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
