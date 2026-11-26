import { lazy, Suspense, useState } from "react";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export function NotesPanel({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [preview, setPreview] = useState(false);
  return <div className="notes-panel">
    <div className="notes-toolbar" role="group" aria-label="Notes view">
      <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
    </div>
    {preview ? (
      <div className="notes-preview">
        <Suspense fallback={<p role="status">Loading preview…</p>}>
          <MarkdownContent text={text} />
        </Suspense>
      </div>
    ) : <textarea aria-label="Project notes" value={text} placeholder="Write project notes in Markdown…"
      onChange={(event) => onChange(event.target.value)} />}
  </div>;
}
