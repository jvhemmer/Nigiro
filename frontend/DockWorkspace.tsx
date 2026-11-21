import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
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
  reveal: (id: string) => void;
}

const Dock = createContext<DockContext>({ panels: [], collapse: () => {}, reveal: () => {} });
const storageKey = "nigiro.dock-layout.v1";

export function useRevealDockPanel() {
  return useContext(Dock).reveal;
}

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
    const entries = Object.entries(layout.panels);
    if (!entries.length ||
        !entries.every(([id, panel]) => panel.contentComponent === "dock" && panels.some((item) => item.id === id))) {
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

  useEffect(() => {
    function endResize() {
      document.documentElement.classList.remove("dock-resizing");
    }
    window.addEventListener("pointerup", endResize, true);
    window.addEventListener("pointercancel", endResize, true);
    window.addEventListener("blur", endResize);
    return () => {
      window.removeEventListener("pointerup", endResize, true);
      window.removeEventListener("pointercancel", endResize, true);
      window.removeEventListener("blur", endResize);
      endResize();
    };
  }, []);

  function startResize(event: PointerEvent<HTMLElement>) {
    if (event.button === 0 && event.target instanceof Element && event.target.closest(".dv-sash.dv-enabled")) {
      document.documentElement.classList.add("dock-resizing");
    }
  }

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
        for (const { icon: _icon, content: _content, ...options } of panels) {
          if (api.getPanel(options.id)) continue;
          const position = options.position;
          const reference = position && "referencePanel" in position ? position.referencePanel : undefined;
          const anchor = typeof reference === "string" ? api.getPanel(reference) : undefined;
          const placement = anchor?.group.api.isVisible ? position : { direction: "left" as const };
          api.addPanel({ initialWidth: 190, ...options, position: placement, component: "dock", renderer: "always" });
        }
        if (api.panels.length !== panels.length || panels.some(({ id }) => !api.getPanel(id))) {
          api.fromJSON(defaultLayout.current, { reuseExistingPanels: true });
        }
      } catch {
        api.fromJSON(defaultLayout.current, { reuseExistingPanels: true });
      }
    }
    for (const group of api.groups) group.model.header.hidden = false;
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

  function reveal(id: string) {
    const panel = api?.getPanel(id);
    if (!panel) return;
    if (!panel.group.api.isVisible) restore(id);
    else if (!panel.api.isActive) panel.api.setActive();
  }

  return (
    <Dock.Provider value={{ panels, collapse, reveal }}>
      <main className="workspace" onPointerDownCapture={startResize}>
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
            singleTabMode="default"
            scrollbars="native"
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
