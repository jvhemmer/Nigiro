import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const elements = {
  R: { label: "Resistor", names: ["R"], units: ["Ω"], guesses: [10], lower: [0], upper: [1e5] },
  L: { label: "Inductor", names: ["L"], units: ["H"], guesses: [1e-6], lower: [1e-9], upper: [1e6] },
  C: { label: "Capacitor", names: ["C"], units: ["F"], guesses: [1e-5], lower: [1e-12], upper: [1] },
  CPE: { label: "Constant phase element", names: ["Q", "alpha"], units: ["S·s^α", ""], guesses: [1e-5, 0.9], lower: [1e-12, 0], upper: [1, 1] },
  WarburgSemiInf: { label: "Semi-infinite Warburg", names: ["sigma"], units: ["Ω·s⁻½"], guesses: [10], lower: [0], upper: [1e9] },
  WarburgFiniteOpen: { label: "Finite Warburg (open)", names: ["sigma", "tau"], units: ["Ω·s⁻½", "s"], guesses: [10, 0.01], lower: [0, 1e-9], upper: [1e5, 1e6] },
  WarburgFiniteShort: { label: "Finite Warburg (short)", names: ["sigma", "tau"], units: ["Ω·s⁻½", "s"], guesses: [10, 0.01], lower: [0, 1e-9], upper: [1e5, 1e6] },
};

type ElementKind = keyof typeof elements;
type GroupKind = "Series" | "Parallel";
type CircuitNode = { type: GroupKind; blocks: CircuitNode[] } | { type: ElementKind; parameters: ParameterDraft[] };
type ParameterDraft = { name: string; x0: string; lower: string; upper: string; fixed: boolean; shared: boolean };
type NodePath = number[];

function readCircuit(value: string): CircuitNode | null {
  function convert(node: unknown): CircuitNode {
    if (!node || typeof node !== "object" || !("type" in node) || typeof node.type !== "string") throw new Error();
    if (node.type === "Series" || node.type === "Parallel") {
      if (!("blocks" in node) || !Array.isArray(node.blocks) || !node.blocks.length) throw new Error();
      return { type: node.type, blocks: node.blocks.map(convert) };
    }
    if (!Object.prototype.hasOwnProperty.call(elements, node.type) || !("parameters" in node) || !Array.isArray(node.parameters)) throw new Error();
    const type = node.type as ElementKind;
    if (node.parameters.length !== elements[type].names.length) throw new Error();
    const parameters = node.parameters.map((parameter: unknown) => {
      if (!parameter || typeof parameter !== "object" || !("name" in parameter) || typeof parameter.name !== "string"
        || !("x0" in parameter) || typeof parameter.x0 !== "number" || !Number.isFinite(parameter.x0)
        || !("lower" in parameter) || (parameter.lower !== null && (typeof parameter.lower !== "number" || !Number.isFinite(parameter.lower)))
        || !("upper" in parameter) || (parameter.upper !== null && (typeof parameter.upper !== "number" || !Number.isFinite(parameter.upper)))
        || !("fixed" in parameter) || typeof parameter.fixed !== "boolean"
        || !("shared" in parameter) || typeof parameter.shared !== "boolean") throw new Error();
      return {
        name: parameter.name, x0: String(parameter.x0),
        lower: parameter.lower === null ? "" : String(parameter.lower),
        upper: parameter.upper === null ? "" : String(parameter.upper),
        fixed: parameter.fixed, shared: parameter.shared,
      };
    });
    return { type, parameters };
  }
  try { return convert(JSON.parse(value)); } catch { return null; }
}

function parametersOf(node: CircuitNode): ParameterDraft[] {
  return "blocks" in node ? node.blocks.flatMap(parametersOf) : node.parameters;
}

function newElement(type: ElementKind, root?: CircuitNode): CircuitNode {
  const used = new Set(root ? parametersOf(root).map(({ name }) => name) : []);
  const spec = elements[type];
  return { type, parameters: spec.names.map((prefix, index) => {
    let name = prefix;
    for (let number = 2; used.has(name); number++) name = prefix + number;
    used.add(name);
    return { name, x0: String(spec.guesses[index]), lower: String(spec.lower[index]),
      upper: String(spec.upper[index]), fixed: false, shared: false };
  }) };
}

function replaceNode(node: CircuitNode, path: NodePath, replacement: CircuitNode): CircuitNode {
  if (!path.length) return replacement;
  if (!("blocks" in node)) throw new Error("Invalid circuit selection.");
  const [index, ...rest] = path;
  return { ...node, blocks: node.blocks.map((block, child) => index === child ? replaceNode(block, rest, replacement) : block) };
}

function selectedNode(node: CircuitNode, path: NodePath): CircuitNode {
  return path.reduce((current, index) => "blocks" in current ? current.blocks[index] : current, node);
}

function circuitLabel(node: CircuitNode): string {
  return "blocks" in node
    ? `(${node.blocks.map(circuitLabel).join(node.type === "Series" ? " + " : " ∥ ")})`
    : node.parameters.map(({ name }) => name).join(", ");
}

export function describeCircuit(value: string): string {
  const node = readCircuit(value);
  return node ? circuitLabel(node) : "Invalid circuit";
}

function saveCircuit(root: CircuitNode) {
  const prior = new Map<string, string>();
  function convert(node: CircuitNode): unknown {
    if ("blocks" in node) return { type: node.type, blocks: node.blocks.map(convert) };
    return { type: node.type, parameters: node.parameters.map((draft, index) => {
      const name = draft.name.trim();
      const x0 = Number(draft.x0);
      const lower = draft.lower.trim() ? Number(draft.lower) : null;
      const upper = draft.upper.trim() ? Number(draft.upper) : null;
      if (!name || !draft.x0.trim() || !Number.isFinite(x0) || (lower !== null && !Number.isFinite(lower))
        || (upper !== null && !Number.isFinite(upper)) || x0 < (lower ?? -Infinity) || x0 > (upper ?? Infinity)) {
        throw new Error(`Enter a name, finite guess, and valid bounds for ${name || elements[node.type].names[index]}.`);
      }
      if ((node.type === "WarburgFiniteOpen" || node.type === "WarburgFiniteShort")
        && index === 1 && (lower === null || lower <= 0)) {
        throw new Error(`Enter a positive lower bound for ${name}, the diffusion time.`);
      }
      const parameter = { name, x0, lower, upper, fixed: draft.fixed || (lower !== null && lower === upper), shared: draft.shared };
      const reference = JSON.stringify(parameter);
      if (prior.has(name) && (!draft.shared || prior.get(name) !== reference)) {
        throw new Error(`Use a unique name for ${name}, or give all shared parameters with that name identical settings.`);
      }
      prior.set(name, reference);
      return parameter;
    }) };
  }
  return JSON.stringify(convert(root));
}

function CircuitSymbol({ type }: { type: ElementKind }) {
  return <svg className="circuit-symbol" viewBox="0 0 60 20" aria-hidden="true">
    {type === "R" ? <path d="M0 10h10l4-6 5 12 5-12 5 12 5-12 5 12 5-12 5 6h11" />
      : type === "C" ? <path d="M0 10h26m8 0h26M26 2v16m8-16v16" />
      : type === "L" ? <path d="M0 10h10a5 5 0 0 1 10 0 5 5 0 0 1 10 0 5 5 0 0 1 10 0 5 5 0 0 1 10 0h10" />
      : <><path d="M0 10h10m40 0h10M10 2h40v16H10z" />
          <text x="30" y="13.5">{type === "CPE" ? "CPE" : type === "WarburgFiniteOpen" ? "Wₒ" : type === "WarburgFiniteShort" ? "Wₛ" : "W"}</text></>}
  </svg>;
}

function CircuitDiagram({ node, path, selection, onSelect }: {
  node: CircuitNode;
  path: NodePath;
  selection: NodePath;
  onSelect: (path: NodePath) => void;
}) {
  const active = path.join(".") === selection.join(".");
  const select = () => onSelect(path);
  if ("blocks" in node) {
    return <div className="circuit-group">
      <button type="button" className="circuit-group-label" aria-pressed={active} onClick={select}>{node.type}</button>
      <div className={node.type === "Series" ? "circuit-series" : "circuit-parallel"}>
        {node.blocks.map((block, index) => <div key={index} className="circuit-branch">
          <CircuitDiagram node={block} path={[...path, index]} selection={selection} onSelect={onSelect} />
        </div>)}
      </div>
    </div>;
  }
  const name = circuitLabel(node);
  return <button type="button" className="circuit-element" aria-pressed={active} onClick={select}
    title={elements[node.type].label} aria-label={`${elements[node.type].label} ${name}`}>
    <CircuitSymbol type={node.type} />
    <span>{name}</span>
  </button>;
}

function CircuitDesigner({ value, onApply, onClose }: { value: string; onApply: (value: string) => void; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [root, setRoot] = useState(() => readCircuit(value));
  const [selection, setSelection] = useState<NodePath>([]);
  const [element, setElement] = useState<ElementKind>("R");
  const [error, setError] = useState("");
  const node = root ? selectedNode(root, selection) : null;
  const parentPath = selection.slice(0, -1);
  const parent = root && selection.length ? selectedNode(root, parentPath) : null;
  const index = selection.at(-1) ?? 0;
  const siblings = parent && "blocks" in parent ? parent.blocks : [];

  useEffect(() => { dialog.current?.showModal(); }, []);

  function add(kind: GroupKind) {
    if (!root || !node) {
      setRoot(newElement(element));
      setSelection([]);
      return;
    }
    const added = newElement(element, root);
    const blocks = "blocks" in node && node.type === kind ? [...node.blocks, added] : [node, added];
    setRoot(replaceNode(root, selection, { type: kind, blocks }));
    setSelection([...selection, blocks.length - 1]);
  }

  function move(direction: number) {
    if (!root || !parent || !("blocks" in parent)) return;
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const blocks = [...siblings];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setRoot(replaceNode(root, parentPath, { ...parent, blocks }));
    setSelection([...parentPath, target]);
  }

  function remove() {
    if (!root || !parent || !("blocks" in parent) || siblings.length < 2) return;
    const blocks = siblings.filter((_, position) => position !== index);
    setRoot(replaceNode(root, parentPath, blocks.length === 1 ? blocks[0] : { ...parent, blocks }));
    setSelection(blocks.length === 1 ? parentPath : [...parentPath, Math.min(index, blocks.length - 1)]);
  }

  function updateParameter(position: number, changes: Partial<ParameterDraft>) {
    if (!root || !node || !("parameters" in node)) return;
    const parameters = node.parameters.map((parameter, index) => index === position ? { ...parameter, ...changes } : parameter);
    setRoot(replaceNode(root, selection, { ...node, parameters }));
  }

  return createPortal(<dialog ref={dialog} className="settings-dialog circuit-dialog" aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!root) { setError("Add an element to the circuit."); return; }
      try { onApply(saveCircuit(root)); } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }}>
      <h2 id={id}>Circuit designer</h2>
      <div className="circuit-toolbar">
        <select aria-label="Element to add" value={element} onChange={(event) => setElement(event.target.value as ElementKind)}>
          {(Object.keys(elements) as ElementKind[]).map((type) => <option key={type} value={type}>{elements[type].label}</option>)}
        </select>
        <button type="button" onClick={() => add("Series")}>{root ? "Add in series" : "Add element"}</button>
        {root && <button type="button" onClick={() => add("Parallel")}>Add in parallel</button>}
      </div>
      <div className="circuit-designer-body">
        <div className="circuit-canvas">
          {root ? <div className="circuit-schematic">
            <CircuitDiagram node={root} path={[]} selection={selection} onSelect={setSelection} />
          </div> : <p className="muted">The saved circuit could not be read. Add an element to start a replacement.</p>}
        </div>
        <aside className="circuit-inspector">
          {node && <h3>{"blocks" in node ? `${node.type} group` : elements[node.type].label}</h3>}
          {node && "blocks" in node && <p className="muted">Select an element to edit its parameters.</p>}
          {node && "parameters" in node && node.parameters.map((parameter, parameterIndex) => {
            const spec = elements[node.type];
            const unit = spec.units[parameterIndex];
            return <fieldset key={parameterIndex} className="fit-settings plugin-fields">
              <legend>{spec.names[parameterIndex]}{unit && ` (${unit})`}</legend>
              <label><span>Name</span><input value={parameter.name} onChange={(event) => updateParameter(parameterIndex, { name: event.target.value })} /></label>
              {(["x0", "lower", "upper"] as const).map((field, index) => <label key={field}>
                <span>{["Initial guess", "Lower bound", "Upper bound"][index]}</span>
                <input value={parameter[field]} placeholder={field === "x0" ? undefined : "Unbounded"}
                  onChange={(event) => updateParameter(parameterIndex, { [field]: event.target.value })} />
              </label>)}
              <label className="circuit-check"><span>Fixed</span><input type="checkbox" checked={parameter.fixed}
                onChange={(event) => updateParameter(parameterIndex, { fixed: event.target.checked })} /></label>
              <label className="circuit-check" title="Use the same name and settings on each shared parameter."><span>Shared</span>
                <input type="checkbox" checked={parameter.shared}
                  onChange={(event) => updateParameter(parameterIndex, { shared: event.target.checked })} /></label>
            </fieldset>;
          })}
          {parent && <div className="circuit-toolbar">
            <button type="button" disabled={index === 0} onClick={() => move(-1)}>Move earlier</button>
            <button type="button" disabled={index >= siblings.length - 1} onClick={() => move(1)}>Move later</button>
            <button type="button" disabled={siblings.length < 2} onClick={remove}>Remove</button>
          </div>}
        </aside>
      </div>
      {error && <p role="alert" className="figure-settings-error">{error}</p>}
      <footer>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!root}>Apply circuit</button>
      </footer>
    </form>
  </dialog>, document.body);
}

export function CircuitField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const description = describeCircuit(value);
  return <div className="circuit-field">
    <span title={description}>{description}</span>
    <button type="button" onClick={() => setOpen(true)}>Edit Circuit…</button>
    {open && <CircuitDesigner value={value} onClose={() => setOpen(false)}
      onApply={(circuit) => { onChange(circuit); setOpen(false); }} />}
  </div>;
}
