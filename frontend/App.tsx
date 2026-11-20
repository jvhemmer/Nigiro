import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine, ChartNoAxesCombined, FileSpreadsheet, FolderOpen,
  History, Save, SlidersHorizontal, Table2, Upload,
} from "lucide-react";
import { DockWorkspace } from "./DockWorkspace";
import { FitPlot } from "./FitPlot";
import { Worksheet } from "./Worksheet";
import {
  elementNames, formatNumber, workspace,
  type FigureElement, type Project, type RecordedStep, type Request,
} from "./workspace";

type Run = (request: Request) => Promise<void>;

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
    case "linear_fit":
      return `Fit ${columns[operation.y]} against ${columns[operation.x]}`;
    case "figure_color":
      return `Change ${elementNames[operation.element].toLowerCase()} color to ${operation.color}`;
  }
}

function FitSettings({ project, busy, run }: { project: Project; busy: boolean; run: Run }) {
  const recipe = [...project.operations].reverse().find((step) => step.kind === "linear_fit");
  const [x, setX] = useState(recipe?.x ?? 0);
  const [y, setY] = useState(recipe?.y ?? Math.min(1, project.columns.length - 1));
  const options = project.columns.map((name, index) => (
    <option key={index} value={index}>{name || `Column ${index + 1}`}</option>
  ));

  return (
    <form
      className="fit-settings"
      onSubmit={(event) => { event.preventDefault(); void run({ action: "fit", x, y }); }}
    >
      <div className="section-header"><h2>Linear fit</h2></div>
      <label>
        <span>X column</span>
        <select value={x} onChange={(event) => setX(Number(event.target.value))} disabled={busy}>
          {options}
        </select>
      </label>
      <label>
        <span>Y column</span>
        <select value={y} onChange={(event) => setY(Number(event.target.value))} disabled={busy}>
          {options}
        </select>
      </label>
      <button className="primary" type="submit" disabled={busy || x === y}>Run linear fit</button>
    </form>
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

function FigurePanel({ project, onSelect }: {
  project: Project;
  onSelect: (element: FigureElement) => void;
}) {
  const recipe = [...project.operations].reverse().find((step) => step.kind === "linear_fit");
  const fit = project.fit;

  return (
    <div className="figure-pane">
      {fit && recipe ? (
        <>
          <p className="figure-hint muted">Select a line or point to edit its color</p>
          <FitPlot
            fit={fit}
            xLabel={project.columns[recipe.x]}
            yLabel={project.columns[recipe.y]}
            colors={project.colors}
            onSelect={onSelect}
          />
          <dl className="fit-summary">
            <div><dt>Slope</dt><dd>{formatNumber(fit.slope)}</dd></div>
            <div><dt>Intercept</dt><dd>{formatNumber(fit.intercept)}</dd></div>
            <div><dt>R²</dt><dd>{formatNumber(fit.r_squared)}</dd></div>
            <div><dt>Observations</dt><dd>{fit.x.length.toLocaleString()}</dd></div>
            <div><dt>Omitted</dt><dd>{fit.omitted_rows.toLocaleString()}</dd></div>
          </dl>
        </>
      ) : (
        <div className="empty-figure">
          <ChartNoAxesCombined size={36} strokeWidth={1.5} />
          {project.fit_error
            ? <p role="alert">{project.fit_error}</p>
            : <p>Choose X and Y columns, then run a linear fit.</p>}
        </div>
      )}
    </div>
  );
}

function AnalysisPanel({ project, busy, run, element, onSelect }: {
  project: Project;
  busy: boolean;
  run: Run;
  element: FigureElement;
  onSelect: (element: FigureElement) => void;
}) {
  return (
    <div className="inspector">
      <FitSettings project={project} busy={busy} run={run} />
      {project.fit && (
        <>
          <section className="element-settings" aria-labelledby="element-heading">
            <div className="section-header"><h2 id="element-heading">Figure element</h2></div>
            <div className="element-list">
              {(["observations", "fit"] as const).map((item) => (
                <button
                  key={item}
                  aria-pressed={item === element}
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
              key={`${element}:${project.colors[element]}`}
              element={element}
              color={project.colors[element]}
              busy={busy}
              run={run}
            />
          </section>
          <section className="export-settings" aria-labelledby="export-heading">
            <div className="section-header">
              <h2 id="export-heading"><ArrowDownToLine size={16} /> Export figure</h2>
            </div>
            <div className="export-buttons">
              {(["svg", "pdf"] as const).map((format) => (
                <button
                  key={format}
                  disabled={busy}
                  onClick={() => void run({ action: "export", name: projectStem(project), format })}
                >{format.toUpperCase()}</button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ProjectEditor({ project, busy, run }: { project: Project; busy: boolean; run: Run }) {
  const [element, setElement] = useState<FigureElement>("fit");
  return (
    <DockWorkspace panels={[
      {
        id: "figure", title: "Figure", icon: ChartNoAxesCombined, minimumWidth: 210,
        content: <FigurePanel project={project} onSelect={setElement} />,
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
          <AnalysisPanel project={project} busy={busy} run={run} element={element} onSelect={setElement} />
        ),
      },
    ]} />
  );
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectKey, setProjectKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectRef = useRef(project);
  const inFlight = useRef(false);

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

    function shortcuts(event: KeyboardEvent) {
      if (event.repeat || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s" && projectRef.current) {
        event.preventDefault();
        void run(event.shiftKey
          ? { action: "save_as", name: projectStem(projectRef.current) }
          : saveRequest(projectRef.current));
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void run({ action: "open" });
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => {
      window.removeEventListener("keydown", shortcuts);
      void unlisten.then((stop) => stop(), () => {});
    };
  }, [run]);

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand"><ChartNoAxesCombined size={21} /><span>Nigiro</span></div>
        {project && (
          <div className="project-name">
            <FileSpreadsheet size={17} />
            <span title={project.file_name ?? project.source_name}>
              {project.file_name ?? project.source_name}
            </span>
            {project.dirty && <span className="dirty" title="Unsaved changes" aria-label="Unsaved changes" />}
          </div>
        )}
        <nav aria-label="Project actions">
          <button disabled={busy} onClick={() => void run({ action: "import_csv" })}>
            <Upload size={16} /> Import CSV
          </button>
          <button disabled={busy} onClick={() => void run({ action: "open" })}>
            <FolderOpen size={16} /> Open project
          </button>
          {project && (
            <>
              <button className="primary" disabled={busy} onClick={() => void run(saveRequest(project))}>
                <Save size={16} /> Save
              </button>
              {project.file_name && (
                <button disabled={busy} onClick={() => void run({ action: "save_as", name: projectStem(project) })}>
                  Save As…
                </button>
              )}
            </>
          )}
        </nav>
      </header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {project ? <ProjectEditor key={projectKey} {...{ project, busy, run }} /> : (
        <main className="welcome">
          <div className="welcome-card">
            <div className="welcome-mark"><ChartNoAxesCombined size={35} strokeWidth={1.7} /></div>
            <h1>Start an analysis</h1>
            <p>Import a CSV to fit a line, save your analysis, and export a figure.</p>
            <div className="welcome-actions">
              <button className="primary" disabled={busy} onClick={() => void run({ action: "import_csv" })}>
                <Upload size={17} /> Import CSV
              </button>
              <button disabled={busy} onClick={() => void run({ action: "sample" })}>
                Try sample data
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
