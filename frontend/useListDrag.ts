import { useRef, useState, type DragEvent } from "react";

export function useListDrag(busy: boolean, move: (from: number, to: number) => void) {
  const origin = useRef<number | null>(null);
  const [marker, setMarker] = useState<{ index: number; edge: "before" | "after" } | null>(null);

  function position(event: DragEvent<HTMLElement>, index: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    return { index, edge } as const;
  }

  function end() {
    origin.current = null;
    setMarker(null);
  }

  return (index: number) => ({
    draggable: !busy,
    "data-drop-edge": marker?.index === index ? marker.edge : undefined,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (busy) { event.preventDefault(); return; }
      origin.current = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (busy || origin.current === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const target = position(event, index);
      setMarker((current) => current?.index === target.index && current.edge === target.edge ? current : target);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const from = origin.current;
      if (busy || from === null) return;
      event.preventDefault();
      const boundary = index + (position(event, index).edge === "after" ? 1 : 0);
      const to = boundary > from ? boundary - 1 : boundary;
      end();
      if (to !== from) move(from, to);
    },
    onDragEnd: end,
  });
}
