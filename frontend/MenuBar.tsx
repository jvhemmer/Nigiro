import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import type { ExportTarget } from "./exportFigure";
import type { ItemAction } from "./ItemDialog";
import type { PluginDefinition, Request, WorkflowStep } from "./workspace";

export type MenuRequest = Request
  | { action: "choose_plugin"; plugin: PluginDefinition }
  | { action: "choose_overlay" }
  | { action: "figure_settings" }
  | { action: "settings" }
  | { action: "choose_scalar" }
  | { action: "choose_array" }
  | { action: "choose_save_workflow" }
  | { action: "choose_run_workflow" }
  | { action: "choose_step"; step: WorkflowStep }
  | { action: "choose_workflow_ports"; step: WorkflowStep }
  | { action: "choose_export"; target: ExportTarget }
  | { action: "manage_item"; change: ItemAction };

export interface MenuCommand {
  label: string;
  request: MenuRequest | null;
  shortcut?: string;
  icon?: LucideIcon;
  keywords?: string;
  disabledReason?: string;
  submenu?: MenuCommand[];
}

export interface Menu {
  label: string;
  groups: MenuCommand[][];
}

interface MenuBarProps {
  menus: Menu[];
  busy: boolean;
  onRun: (request: MenuRequest) => void;
}

export function MenuBar({ menus, busy, onRun }: MenuBarProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<{ index: number; last: boolean } | null>(null);

  function showMenu(index: number, last = false) {
    setActive(index);
    setOpen({ index, last });
  }

  const closeMenu = useCallback(() => {
    if (open) triggers.current[open.index]?.focus();
    setOpen(null);
  }, [open]);

  const runCommand = useCallback((command: MenuCommand) => {
    if (busy || !command.request) return;
    closeMenu();
    void onRun(command.request);
  }, [busy, closeMenu, onRun]);

  useLayoutEffect(() => {
    if (!open) return;
    const element = popup.current;
    const trigger = triggers.current[open.index];
    if (!element || !trigger) return;

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      element.style.top = `${rect.bottom + 2}px`;
      element.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - element.offsetWidth))}px`;
    };
    position();
    const items = element.querySelectorAll("button");
    if (items.length) items[open.last ? items.length - 1 : 0].focus();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)
        && !popup.current?.contains(event.target)) setOpen(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = (event.shiftKey ? "Shift+" : "") + event.key.toUpperCase();
      const command = menus.flatMap(({ groups }) => groups.flat()).find((item) => item.shortcut === key);
      if (command) {
        event.preventDefault();
        runCommand(command);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [menus, runCommand]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;

    if (key === "Tab") {
      if (open) closeMenu();
      return;
    }
    if (key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (open && key === "ArrowRight" && event.target instanceof Element) {
      const child = event.target.closest(".menu-submenu")?.querySelector<HTMLButtonElement>(".menu-submenu-popup button");
      if (child) {
        event.preventDefault();
        child.focus();
        return;
      }
    }
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      const direction = key === "ArrowRight" ? 1 : -1;
      const next = (active + direction + menus.length) % menus.length;
      if (open) showMenu(next);
      else triggers.current[next]?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
    event.preventDefault();

    if (!open) {
      if (key === "Home" || key === "End") {
        triggers.current[key === "Home" ? 0 : menus.length - 1]?.focus();
      } else {
        showMenu(active, key === "ArrowUp");
      }
      return;
    }

    const items = Array.from(popup.current?.querySelectorAll("button") ?? []).filter((item) => item.getClientRects().length);
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const direction = key === "ArrowDown" ? 1 : -1;
    const next = key === "Home" ? 0 : key === "End" ? items.length - 1
      : (current + direction + items.length) % items.length;
    items[next].focus();
  }

  const shortcutPrefix = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div
      className="menu-bar"
      ref={root}
      role="menubar"
      aria-label="Application menu"
      onKeyDown={navigate}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)
          && !popup.current?.contains(event.relatedTarget)) setOpen(null);
      }}
    >
      {menus.map(({ label, groups }, index) => {
        const expanded = open?.index === index;
        const triggerId = `${id}-trigger-${index}`;
        const menuId = `${id}-menu-${index}`;
        return (
          <div className="menu-group" role="none" key={label}>
            <button
              className="menu-trigger"
              type="button"
              id={triggerId}
              ref={(button) => { triggers.current[index] = button; }}
              role="menuitem"
              tabIndex={active === index ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? menuId : undefined}
              onFocus={() => setActive(index)}
              onClick={() => expanded ? closeMenu() : showMenu(index)}
            >
              {label}
            </button>
            {expanded && createPortal(
              <div className={groups.some((group) => group.some((command) => command.submenu)) ? "menu-popup menu-with-submenu" : "menu-popup"} id={menuId} ref={popup} role="menu" aria-labelledby={triggerId}>
                {groups.filter((group) => group.length).map((group, groupIndex) => (
                  <Fragment key={group[0].label}>
                    {groupIndex > 0 && <div className="menu-separator" role="separator" />}
                    {group.map((command, commandIndex) => command.submenu ? (
                      <div className="menu-submenu" key={command.label}>
                        <button className="menu-command" type="button" role="menuitem" tabIndex={-1}
                          aria-haspopup="menu" onClick={(event) => event.currentTarget.nextElementSibling?.querySelector("button")?.focus()}>
                          <span className="menu-command-label">
                          {command.icon && <command.icon size={14} aria-hidden="true" />}
                          <span>{command.label}</span>
                        </span><span aria-hidden="true">›</span>
                        </button>
                        <div className="menu-popup menu-submenu-popup" role="menu" aria-label={command.label}>
                          {command.submenu.map((item) => <button className="menu-command" type="button"
                            key={item.label} role="menuitem" tabIndex={-1} aria-disabled={busy || !item.request}
                            onClick={() => runCommand(item)}>
                            <span className="menu-command-label">
                              {item.icon && <item.icon size={14} aria-hidden="true" />}
                              <span>{item.label}</span>
                            </span>
                          </button>)}
                        </div>
                      </div>
                    ) : (
                      <button
                        className="menu-command"
                        type="button"
                        key={`${command.label}:${commandIndex}`}
                        role="menuitem"
                        tabIndex={-1}
                        aria-disabled={busy || !command.request}
                        onClick={() => runCommand(command)}
                      >
                        <span className="menu-command-label">
                          {command.icon && <command.icon size={14} aria-hidden="true" />}
                          <span>{command.label}</span>
                        </span>
                        {command.shortcut && <kbd aria-hidden="true">{shortcutPrefix}{command.shortcut}</kbd>}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </div>,
              document.body,
            )}
          </div>
        );
      })}
    </div>
  );
}
