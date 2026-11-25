import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Menu, MenuCommand, MenuRequest } from "./MenuBar";

function searchEntries(menus: Menu[]) {
  function collect(commands: MenuCommand[], path: string): { command: MenuCommand; path: string }[] {
    return commands.flatMap((command) => command.submenu
      ? collect(command.submenu, `${path} › ${command.label}`) : [{ command, path }]);
  }
  return menus.flatMap(({ label, groups }) => collect(groups.flat(), label));
}

export function CommandSearch({ menus, busy, onRun }: {
  menus: Menu[];
  busy: boolean;
  onRun: (request: MenuRequest) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const mac = /Mac/.test(navigator.platform);

  const results = useMemo(() => {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return searchEntries(menus).flatMap((entry) => {
      const { command, path } = entry;
      if (!command.request) return [];
      const label = command.label.toLowerCase();
      const text = `${label} ${path.toLowerCase()} ${command.keywords ?? ""}`;
      if (!words.every((word) => text.includes(word))) return [];
      return [{ ...entry, rank: words.filter((word) => label.includes(word)).length }];
    }).sort((a, b) => b.rank - a.rank);
  }, [menus, query]);
  const expanded = open && !busy;
  const selected = Math.min(active, results.length - 1);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (busy || event.defaultPrevented || event.repeat || event.altKey || !event.shiftKey
        || !(mac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [busy, mac]);

  useEffect(() => {
    if (expanded && selected >= 0) list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [expanded, selected, query]);

  function dismiss() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  function run(command: MenuCommand) {
    if (busy || !command.request) return;
    dismiss();
    input.current?.blur();
    onRun(command.request);
  }

  return <div className="command-search">
    <div className="command-search-field">
      <Search size={14} aria-hidden="true" />
      <input ref={input} type="text" role="combobox" aria-label="Search actions"
        aria-keyshortcuts={mac ? "Meta+Shift+P" : "Control+Shift+P"} aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && selected >= 0 ? `${listId}-${selected}` : undefined}
        value={query} placeholder="Search actions" disabled={busy}
        onFocus={(event) => {
          previousFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
          setOpen(true);
        }}
        onBlur={dismiss}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && expanded) {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
            if (previousFocus.current?.isConnected) previousFocus.current.focus();
            else event.currentTarget.blur();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!expanded || !results.length) {
              setOpen(true);
              return;
            }
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActive((selected + direction + results.length) % results.length);
          } else if (event.key === "Enter" && expanded && selected >= 0) {
            event.preventDefault();
            run(results[selected].command);
          }
        }} />
      <kbd aria-hidden="true">{mac ? "⌘⇧P" : "Ctrl+Shift+P"}</kbd>
    </div>
    {expanded && <div className="command-results">
      <ul ref={list} id={listId} role="listbox" aria-label="Matching actions">
        {results.map(({ command, path }, index) => <li key={`${path}/${command.label}/${index}`}
          id={`${listId}-${index}`} role="option" aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()} onClick={() => run(command)}>
          {command.icon && <command.icon size={14} aria-hidden="true" />}
          <span>{command.label}</span>
          <small>{path}</small>
        </li>)}
      </ul>
      {!results.length && <p role="status">No actions found.</p>}
    </div>}
  </div>;
}
