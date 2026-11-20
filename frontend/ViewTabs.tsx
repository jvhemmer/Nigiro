import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function ViewTabs<T extends string | number | null>({ id, label, items, selected, busy, onSelect }: {
  id: string;
  label: string;
  items: { id: T; name: string }[];
  selected: T;
  busy: boolean;
  onSelect: (id: T) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const index = items.findIndex((item) => item.id === selected);

  useLayoutEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index, items.length, overflow]);

  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey
        || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const before = element.scrollLeft;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientWidth
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      element.scrollLeft += event.deltaY * unit;
      if (element.scrollLeft !== before) event.preventDefault();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("wheel", onWheel, { passive: false });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, [items.length]);

  function scroll(direction: number) {
    const element = strip.current;
    if (element) element.scrollBy({ left: direction * Math.max(24, element.clientWidth - 24) });
  }

  if (items.length === 0) return null;

  return (
    <div className="tab-navigation">
      {overflow && <button className="tab-scroll" type="button" aria-label={`Scroll ${label.toLowerCase()} left`} onClick={() => scroll(-1)}>
        <ChevronLeft size={13} aria-hidden="true" />
      </button>}
      <div className="view-tabs" ref={strip} role="tablist" aria-label={label}>
        {items.map((item, position) => (
          <button key={item.id ?? "raw"} id={viewTabId(id, item.id)} type="button" role="tab"
            aria-selected={position === index} aria-controls={id} aria-disabled={busy}
            tabIndex={position === Math.max(0, index) ? 0 : -1} title={item.name}
            onClick={() => { if (!busy && item.id !== selected) onSelect(item.id); }}
            onKeyDown={(event) => {
              const last = items.length - 1;
              let next: number;
              switch (event.key) {
                case "Home": next = 0; break;
                case "End": next = last; break;
                case "ArrowLeft": next = position === 0 ? last : position - 1; break;
                case "ArrowRight": next = position === last ? 0 : position + 1; break;
                default: return;
              }
              event.preventDefault();
              strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>
            {item.name}
          </button>
        ))}
      </div>
      {overflow && <button className="tab-scroll" type="button" aria-label={`Scroll ${label.toLowerCase()} right`} onClick={() => scroll(1)}>
        <ChevronRight size={13} aria-hidden="true" />
      </button>}
    </div>
  );
}

export function viewTabId(panelId: string, value: string | number | null) {
  return `${panelId}-tab-${value ?? "raw"}`;
}
