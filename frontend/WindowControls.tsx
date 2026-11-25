import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

const resizeDirections = ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"] as const;

export function dragTitleBar(event: MouseEvent<HTMLElement>, onError: (message: string) => void) {
  if (!isTauri() || event.button !== 0 || !(event.target instanceof Element)
    || event.target.closest("button, input, .command-search, .menu-bar, .window-resize")) return;
  const window = getCurrentWindow();
  void (event.detail === 2 ? window.toggleMaximize() : window.startDragging()).catch((error) => onError(String(error)));
}

export function WindowControls({ onError }: { onError: (message: string) => void }) {
  const desktop = isTauri();
  const nativeResizeBorder = /Mac/.test(navigator.platform);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const window = getCurrentWindow();
    let active = true;
    function update() {
      void window.isMaximized().then((value) => { if (active) setMaximized(value); })
        .catch((error) => { if (active) onError(String(error)); });
    }
    update();
    const release = window.onResized(update);
    void release.catch((error) => { if (active) onError(String(error)); });
    return () => {
      active = false;
      void release.then((unlisten) => unlisten(), () => {});
    };
  }, [desktop, onError]);

  if (!desktop) return null;
  const window = getCurrentWindow();
  const run = (action: Promise<void>) => { void action.catch((error) => onError(String(error))); };
  return <>
    <div className="window-controls">
      <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => run(window.minimize())}><Minus size={14} /></button>
      <button type="button" aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"} onClick={() => run(window.toggleMaximize())}>
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button type="button" className="window-close" aria-label="Close window" title="Close" onClick={() => run(window.close())}><X size={15} /></button>
    </div>
    {!nativeResizeBorder && !maximized && resizeDirections.map((direction) => <div aria-hidden="true" key={direction}
      className="window-resize" data-direction={direction} onMouseDown={(event) => {
        if (event.button === 0) {
          event.stopPropagation();
          run(window.startResizeDragging(direction));
        }
      }} />)}
  </>;
}
