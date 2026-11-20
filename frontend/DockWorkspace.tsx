import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact, themeLight,
  type AddPanelOptions, type DockviewApi, type DockviewReadyEvent,
  type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { PanelLeftClose, RotateCcw, type LucideIcon } from "lucide-react";
import "dockview-react/dist/styles/dockview.css";

export interface DockPanel extends Pick<
  AddPanelOptions, "id" | "position" | "initialWidth" | "initialHeight" | "minimumWidth" | "minimumHeight"
> {
  title: string;
  icon: LucideIcon;
  content: ReactNode;
}

interface DockContext {
  panels: DockPanel[];
  collapse: (id: string) => void;
}

const Dock = createContext<DockContext>({ panels: [], collapse: () => {} });
const storageKey = "nigiro.dock-layout.v1";

function DockContent({ api }: IDockviewPanelProps) {
  const panel = useContext(Dock).panels.find((item) => item.id === api.id);
  return <div className="dock-content">{panel?.content}</div>;
}

function DockTab({ api }: IDockviewPanelHeaderProps) {
  const panel = useContext(Dock).panels.find((item) => item.id === api.id);
  if (!panel) return null;
  return (
    <div className="dock-tab" title={`Drag ${panel.title} to move it`}>
      <panel.icon size={15} aria-hidden="true" />
      <span>{panel.title}</span>
    </div>
  );
}

function DockActions({ activePanel }: IDockviewHeaderActionsProps) {
  const { panels, collapse } = useContext(Dock);
  const panel = panels.find((item) => item.id === activePanel?.id);
  if (!panel) return null;
  const label = `Collapse ${panel.title} to sidebar`;
  return (
    <div className="dock-actions">
      <button type="button" className="dock-icon" aria-label={label} title={label}
        onClick={() => collapse(panel.id)}>
        <PanelLeftClose size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function DockEmpty() {
  return <p className="dock-empty">Select a panel in the sidebar to restore it.</p>;
}

const components = { dock: DockContent };

function readLayout(panels: DockPanel[]): SerializedDockview | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    const layout: SerializedDockview = JSON.parse(stored);
    if (Object.keys(layout.panels).length !== panels.length ||
        !panels.every(({ id }) => layout.panels[id]?.contentComponent === "dock")) {
      return null;
    }
    return layout;
  } catch {
    return null;
  }
}

export function DockWorkspace({ panels }: { panels: DockPanel[] }) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const defaultLayout = useRef<SerializedDockview | null>(null);
  const focusRestore = useRef<string | null>(null);

  const syncLayout = useCallback((api: DockviewApi) => {
    const hidden = panels.map(({ id }) => id)
      .filter((id) => api.getPanel(id)?.group.api.isVisible === false);
    setCollapsed((current) =>
      current.length === hidden.length && current.every((id, index) => id === hidden[index])
        ? current : hidden);
    try {
      localStorage.setItem(storageKey, JSON.stringify(api.toJSON()));
    } catch {
      // Docking still works when layout preferences cannot be saved.
    }
  }, [panels]);

  useEffect(() => {
    if (!api) return;
    const subscription = api.onDidLayoutChange(() => syncLayout(api));
    return () => subscription.dispose();
  }, [api, syncLayout]);

  function ready({ api }: DockviewReadyEvent) {
    for (const { icon: _icon, content: _content, ...options } of panels) {
      api.addPanel({ ...options, component: "dock", renderer: "always" });
    }
    defaultLayout.current = api.toJSON();
    const stored = readLayout(panels);
    if (stored) {
      try {
        api.fromJSON(stored, { reuseExistingPanels: true });
        if (api.panels.length !== panels.length || panels.some(({ id }) => !api.getPanel(id))) {
          api.fromJSON(defaultLayout.current, { reuseExistingPanels: true });
        }
      } catch {
        api.fromJSON(defaultLayout.current, { reuseExistingPanels: true });
      }
    }
    syncLayout(api);
    setApi(api);
  }

  function collapse(id: string) {
    const panel = api?.getPanel(id);
    if (!api || !panel || !panel.group.api.isVisible) return;

    const group = panel.group;
    focusRestore.current = id;
    if (group.panels.length === 1) {
      group.api.setVisible(false);
    } else {
      // Hide only this tab. Keep the source group visible and remember its tab position.
      const index = group.panels.indexOf(panel);
      const hidden = api.addGroup({ referenceGroup: group, direction: "right", skipSetActive: true });
      panel.api.moveTo({ group: hidden, position: "center", skipSetActive: true });
      panel.api.updateParameters({ returnGroup: group.id, returnIndex: index });
      hidden.api.setVisible(false);
    }
    syncLayout(api);
  }

  function restore(id: string) {
    const panel = api?.getPanel(id);
    if (!api || !panel) return;

    const { returnGroup, returnIndex } = panel.params ?? {};
    const group = api.groups.find(({ id }) => id === returnGroup);
    if (group?.api.isVisible) {
      panel.api.moveTo({
        group,
        position: "center",
        index: typeof returnIndex === "number" ? returnIndex : undefined,
      });
    } else {
      panel.group.api.setVisible(true);
    }
    panel.api.updateParameters({ returnGroup: undefined, returnIndex: undefined });
    panel.api.setActive();
    panel.focus();
    focusRestore.current = null;
    syncLayout(api);
  }

  function resetLayout() {
    if (!api || !defaultLayout.current) return;
    api.fromJSON(defaultLayout.current, { reuseExistingPanels: true });
    syncLayout(api);
  }

  return (
    <Dock.Provider value={{ panels, collapse }}>
      <main className="workspace">
        <aside className="dock-rail" aria-label="Panel sidebar">
          {panels.filter(({ id }) => collapsed.includes(id)).map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="dock-icon dock-restore"
              aria-label={`Restore ${title}`}
              title={`Restore ${title}`}
              autoFocus={focusRestore.current === id}
              onClick={() => restore(id)}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="dock-icon dock-reset" aria-label="Reset panel layout"
            title="Reset panel layout" onClick={resetLayout}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        </aside>
        <div className="dock-area">
          <DockviewReact
            className="nigiro-dock"
            theme={themeLight}
            components={components}
            defaultTabComponent={DockTab}
            rightHeaderActionsComponent={DockActions}
            watermarkComponent={DockEmpty}
            dndStrategy="pointer"
            disableFloatingGroups
            onReady={ready}
          />
        </div>
      </main>
    </Dock.Provider>
  );
}
