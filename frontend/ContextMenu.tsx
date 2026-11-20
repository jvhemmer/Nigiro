import { Fragment, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { MenuCommand, MenuRequest } from "./MenuBar";

export interface ContextMenuState {
  x: number;
  y: number;
  label: string;
  groups: MenuCommand[][];
  returnFocus: HTMLElement | null;
}

export function ContextMenu({ menu, onClose, onRun }: {
  menu: ContextMenuState;
  onClose: () => void;
  onRun: (request: MenuRequest) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!element) return;
    element.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - element.offsetWidth))}px`;
    element.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - element.offsetHeight))}px`;
    element.querySelector("button")?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !popup.current?.contains(event.target)) onClose();
    }
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function close() {
    menu.returnFocus?.focus({ preventScroll: true });
    onClose();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll("button"));
    const index = items.findIndex((item) => item === document.activeElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + direction + items.length) % items.length;
    items[next]?.focus();
  }

  return createPortal(
    <div className="menu-popup" ref={popup} role="menu" aria-label={menu.label} onKeyDown={navigate}>
      {menu.groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <div className="menu-separator" role="separator" />}
          {group.map(({ label, request, disabledReason }, position) => (
            <button className="menu-command" type="button" role="menuitem" tabIndex={-1}
              key={`${label}-${position}`} aria-disabled={!request} title={disabledReason} onClick={() => {
                if (!request) return;
                close();
                onRun(request);
              }}>
              <span>{label}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
