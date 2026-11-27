import { Maximize, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { stepIcon } from "./actionIcons";
import { StepFilterMenu, visibleWorkflowSteps, type StepFilter } from "./StepFilterMenu";
import type { WorkflowPort, WorkflowStep } from "./workspace";

const nodeWidth = 240;
const titleHeight = 38;
const portHeight = 22;
const margin = 22;
const minZoom = 0.2;
const maxZoom = 2;

type Point = { x: number; y: number };
export type WorkflowNodePositions = Record<number, Point>;
type Node = Point & {
  step: WorkflowStep;
  index: number;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  height: number;
  column: number;
};

type Drag = Point & { start: Point; stepId?: number };
const clampZoom = (zoom: number) => Math.max(minZoom, Math.min(maxZoom, zoom));

function arrange(steps: { step: WorkflowStep; index: number }[]) {
  const byStep = new Map<number, Node>();
  const nextRow = new Map<number, number>();
  for (const { index, step } of steps) {
    const inputs = step.ports?.inputs ?? [];
    const outputs = step.ports?.outputs ?? [];
    const sources = inputs.flatMap(({ producer }) => {
      const node = producer === undefined ? undefined : byStep.get(producer);
      return node ? [node] : [];
    });
    const column = sources.reduce((rightmost, source) => Math.max(rightmost, source.column + 1), 0);
    const height = titleHeight + portHeight * Math.max(1, inputs.length, outputs.length) + 8;
    const sourceTop = sources.length ? sources.reduce((top, source) => top + source.y, 0) / sources.length : margin;
    const y = Math.max(sourceTop, nextRow.get(column) ?? margin);
    const x = margin + column * (nodeWidth + 96);
    byStep.set(step.id, { step, index, inputs, outputs, height, column, x, y });
    nextRow.set(column, y + height + 28);
  }
  return [...byStep.values()];
}

function connection(start: Point, end: Point) {
  const bend = Math.max(36, Math.abs(end.x - start.x) / 2);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

function editable(step: WorkflowStep | undefined) {
  return !!(step?.parameters || step?.files?.length);
}

export function WorkflowGraph({ steps, statusLabels, busy, hiddenFilters, onToggleFilter, initialPositions, onClose, onEdit, onSelect }: {
  steps: WorkflowStep[];
  statusLabels: Record<WorkflowStep["status"], string>;
  busy: boolean;
  hiddenFilters: ReadonlySet<StepFilter>;
  onToggleFilter: (filter: StepFilter, shown: boolean) => void;
  initialPositions: WorkflowNodePositions;
  onClose: (positions: WorkflowNodePositions) => void;
  onEdit: (step: WorkflowStep) => void;
  onSelect: (step: WorkflowStep) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<number>();
  const [zoom, setZoom] = useState(1);
  const [positions, setPositions] = useState(initialPositions);
  const layout = useMemo(() => arrange(visibleWorkflowSteps(steps, hiddenFilters)), [steps, hiddenFilters]);
  const stepOrder = useMemo(() => new Map(steps.map(({ id }, index) => [id, index])), [steps]);
  const nodes = layout.map((node) => ({ ...node, ...positions[node.step.id] }));
  const byStep = new Map(nodes.map((node) => [node.step.id, node]));
  const width = nodes.reduce((right, node) => Math.max(right, node.x + nodeWidth + margin), 2 * margin);
  const height = nodes.reduce((bottom, node) => Math.max(bottom, node.y + node.height + margin), 2 * margin);
  const active = selected === undefined ? undefined : byStep.get(selected);

  useEffect(() => { dialog.current?.showModal(); }, []);

  function select(step: WorkflowStep) {
    setSelected(step.id);
    onSelect(step);
  }

  function fit() {
    const view = viewport.current;
    if (!view) return;
    setZoom(clampZoom(Math.min(1, view.clientWidth / width, view.clientHeight / height)));
    view.scrollTo(0, 0);
  }

  function start(event: ReactPointerEvent<HTMLElement>, node?: Node) {
    const view = viewport.current;
    if (event.button !== 0 || !view) return;
    if (node) select(node.step);
    drag.current = {
      x: event.clientX, y: event.clientY, stepId: node?.step.id,
      start: node ?? { x: view.scrollLeft, y: view.scrollTop },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const view = viewport.current;
    const current = drag.current;
    if (!current || !view) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const id = current.stepId;
    if (id === undefined) {
      view.scrollTo(current.start.x - dx, current.start.y - dy);
      return;
    }
    if (dx === 0 && dy === 0) return;
    setPositions((previous) => ({ ...previous, [id]: {
      x: Math.max(margin, current.start.x + dx / zoom), y: Math.max(margin, current.start.y + dy / zoom),
    } }));
  }

  const stop = () => { drag.current = null; };
  const portY = (node: Node, index: number) => node.y + titleHeight + (index + 0.5) * portHeight;
  return <dialog ref={dialog} className="settings-dialog workflow-graph" aria-label="Recorded steps flowchart"
    onCancel={(event) => { event.preventDefault(); onClose(positions); }} onContextMenu={(event) => event.stopPropagation()}>
    <header className="workflow-graph-header">
      <h2>Recorded steps flowchart</h2>
      <div className="workflow-graph-tools">
        <StepFilterMenu hidden={hiddenFilters} onToggle={onToggleFilter} portalContainer={dialog} />
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= minZoom}
          onClick={() => setZoom((value) => clampZoom(value / 1.25))}><Minus size={15} /></button>
        <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= maxZoom}
          onClick={() => setZoom((value) => clampZoom(value * 1.25))}><Plus size={15} /></button>
        <button type="button" aria-label="Fit flowchart" title="Fit flowchart" disabled={!nodes.length}
          onClick={fit}><Maximize size={15} /></button>
        <button type="button" aria-label="Reset node positions" title="Reset node positions" disabled={!Object.keys(positions).length}
          onClick={() => setPositions({})}><RotateCcw size={15} /></button>
      </div>
      <button type="button" aria-label="Close flowchart" title="Close flowchart" onClick={() => onClose(positions)}><X size={16} /></button>
    </header>
    <div className="workflow-graph-viewport" ref={viewport}
      onPointerDown={(event) => {
        if (!(event.target instanceof Element) || event.target.closest(".workflow-node")) return;
        start(event);
      }} onPointerMove={move} onLostPointerCapture={stop}>
      {!nodes.length ? <p className="dock-empty">{steps.length ? "No steps match the filters." : "Record a step to see it here."}</p> :
        <div className="workflow-graph-size" style={{ width: width * zoom, height: height * zoom }}>
          <div className="workflow-graph-canvas" style={{ width, height, transform: `scale(${zoom})` }}>
            <svg className="workflow-graph-connections" width={width} height={height} aria-hidden="true">
              {nodes.flatMap((node) => node.inputs.flatMap((input, index) => {
                const source = input.producer === undefined ? undefined : byStep.get(input.producer);
                if (!source) return [];
                const from = source.outputs.findIndex((port) => port.id === input.id);
                if (from < 0) return [];
                return [<path key={`${node.step.id}:${input.id}`}
                  data-related={selected === node.step.id || selected === source.step.id || undefined}
                  data-out-of-order={source.index >= node.index || undefined}
                  d={connection({ x: source.x + nodeWidth, y: portY(source, from) }, { x: node.x, y: portY(node, index) })} />];
              }))}
            </svg>
            {nodes.map((node) => {
              const { step, x, y, index, inputs, outputs } = node;
              const Icon = stepIcon(step);
              return <section key={step.id} className="workflow-node" data-selected={step.id === selected || undefined}
                data-failed={step.status === "failed" || undefined}
                style={{ left: x, top: y, width: nodeWidth, height: node.height }}>
                <button type="button" className="workflow-node-title" aria-pressed={step.id === selected}
                  title={step.label} onClick={() => select(step)}
                  onDoubleClick={() => { if (!busy && editable(step)) onEdit(step); }}
                  onPointerDown={(event) => start(event, node)} onLostPointerCapture={stop}>
                  <Icon size={15} aria-hidden="true" />
                  <span>{index + 1}. {step.label}</span>
                  <small data-status={step.status}>{statusLabels[step.status]}</small>
                </button>
                <div className="workflow-node-ports">
                  <ul role="list" aria-label="Inputs">{inputs.map((port) => {
                    const producerOrder = port.producer === undefined ? undefined : stepOrder.get(port.producer);
                    const invalid = port.producer !== undefined && (producerOrder === undefined || producerOrder >= index);
                    return <li key={port.id} data-invalid={invalid || undefined}
                      title={invalid ? `${port.label} · ${producerOrder === undefined ? "Producer was removed" : "Producer runs later"}` : port.label}>
                      {port.label}
                    </li>;
                  })}</ul>
                  <ul role="list" aria-label="Outputs">{outputs.map((port) => <li key={port.id} title={port.label}>{port.label}</li>)}</ul>
                </div>
              </section>;
            })}
          </div>
        </div>}
    </div>
    <footer className="workflow-graph-footer">
      <span>{active ? active.step.label : "Drag nodes to arrange the view."}</span>
      {active && <button type="button" disabled={busy || !editable(active.step)} onClick={() => onEdit(active.step)}>Edit step…</button>}
    </footer>
  </dialog>;
}
