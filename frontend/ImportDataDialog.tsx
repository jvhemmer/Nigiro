import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import type { ImportPreview, ImportReview, Request, TextImportSettings } from "./workspace";

const delimiters = [
  [",", "Comma"], ["\t", "Tab"], [";", "Semicolon"], ["|", "Pipe"],
  ["whitespace", "Spaces or tabs"], ["single", "Single column"],
];
const encodings = [
  ["utf-8-sig", "UTF-8"], ["utf-16", "UTF-16 (with BOM)"], ["utf-16-le", "UTF-16 LE"],
  ["utf-16-be", "UTF-16 BE"], ["cp1252", "Windows-1252"], ["latin-1", "Latin-1"],
];

export function ImportDataDialog({ review, busy, error, onClose, onImport }: {
  review: ImportReview;
  busy: boolean;
  error: string;
  onClose: () => void;
  onImport: (request: Extract<Request, { action: "import_configured" }>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [settings, setSettings] = useState(review.suggested);
  const [result, setResult] = useState<{ settings: TextImportSettings; preview: ImportPreview }>({
    settings: review.suggested, preview: review.preview,
  });
  const [showRaw, setShowRaw] = useState(false);
  const path = review.paths[review.index];
  const previewPending = result.settings !== settings;
  const preview = result.preview;
  const custom = !delimiters.some(([value]) => value === settings.delimiter);
  const raw = showRaw || !!preview.error;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (settings === review.suggested) {
      setResult({ settings, preview: review.preview });
      return;
    }
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const preview = await invoke<ImportPreview>("workspace", { request: { action: "import_preview", path, settings } });
        if (current) setResult({ settings, preview });
      } catch (reason) {
        if (current) setResult({ settings, preview: { columns: [], rows: [], raw: [], error: String(reason) } });
      }
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [path, review.preview, review.suggested, settings]);

  function update<Key extends keyof TextImportSettings>(key: Key, value: TextImportSettings[Key]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return <dialog ref={dialog} className="settings-dialog import-data-dialog" aria-labelledby={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy || previewPending || preview.error) return;
      const chosen = [...review.settings];
      chosen[review.index] = settings;
      onImport({ action: "import_configured", paths: review.paths, settings: chosen, replacement: review.replacement });
    }}>
      <h2 id={title}>{review.replacement ? "Replace Imported Data" : "Import Options"}</h2>
      <div className="import-data-content">
        <p className="import-file-name" title={path}>
          {path.split(/[/\\]/).pop()} {review.paths.length > 1 && `(${review.index + 1} of ${review.paths.length})`}
        </p>
        {settings === review.suggested && review.error !== preview.error && <p className="muted">{review.error}</p>}
        <fieldset disabled={busy} className="fit-settings import-data-fields">
          <label><span>Delimiter</span><select aria-label="Delimiter" value={custom ? "custom" : settings.delimiter}
            onChange={(event) => update("delimiter", event.target.value === "custom" ? "" : event.target.value)}>
            {delimiters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="custom">Custom</option>
          </select></label>
          {custom && <label><span>Delimiter character</span><input required maxLength={2} value={settings.delimiter}
            onChange={(event) => update("delimiter", event.target.value)} /></label>}
          <label><span>Encoding</span><select aria-label="Encoding" value={settings.encoding} onChange={(event) => update("encoding", event.target.value)}>
            {encodings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label title="Skip lines that start with this prefix."><span>Comment prefix</span><input placeholder="#" value={settings.comment}
            onChange={(event) => update("comment", event.target.value)} /></label>
          <label><span>Skip first rows</span><input type="number" required min={0} value={Number.isFinite(settings.skip_rows) ? settings.skip_rows : ""}
            onChange={(event) => update("skip_rows", event.target.valueAsNumber)} /></label>
          <label><span>Header row (0 for none)</span><input type="number" required min={0} value={Number.isFinite(settings.header_row) ? settings.header_row : ""}
            onChange={(event) => update("header_row", event.target.valueAsNumber)} /></label>
          <label><span>Ignore lines</span><input placeholder="2,5-8" value={settings.ignore_rows}
            onChange={(event) => update("ignore_rows", event.target.value)} /></label>
        </fieldset>
        <p className="muted">Line numbers start at 1 in the original file. An earlier line is skipped when you select a header row after it.</p>
        <div className="import-preview-heading">
          <span>Preview · first 20 {raw ? "lines" : "rows"}</span>
          {preview.raw.length > 0 && <button type="button" disabled={!!preview.error}
            onClick={() => setShowRaw(!showRaw)}>{showRaw ? "Show table" : "Show original lines"}</button>}
        </div>
        <div className="import-preview" aria-busy={previewPending}>
          {raw ? <ol>{(preview.raw.length ? preview.raw : review.preview.raw).map((line, index) => <li key={index}><code>{line || " "}</code></li>)}</ol>
            : <table aria-label="Import preview"><thead><tr>{preview.columns.map((column, index) => (
              <th key={index}>{column || `Column ${index + 1}`}</th>
            ))}</tr></thead><tbody>{preview.rows.map((row, index) => (
              <tr key={index}>{row.map((cell, position) => <td key={position}>{cell}</td>)}</tr>
            ))}</tbody></table>}
        </div>
        {(error || (!previewPending && preview.error)) && <p className="error-banner" role="alert">{error || preview.error}</p>}
      </div>
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={busy || previewPending || !!preview.error}>
          {review.replacement ? "Replace file" : "Import data"}
        </button>
      </footer>
    </form>
  </dialog>;
}
