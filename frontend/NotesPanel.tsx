import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownPlugins = [remarkGfm];

export function NotesPanel({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [preview, setPreview] = useState(false);
  return <div className="notes-panel">
    <div className="notes-toolbar" role="group" aria-label="Notes view">
      <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
    </div>
    {preview ? (
      <div className="notes-preview">
        <Markdown remarkPlugins={markdownPlugins} skipHtml
          components={{ a: ({ node: _node, ...link }) => <a {...link} target="_blank" rel="noopener noreferrer" /> }}>
          {text}
        </Markdown>
      </div>
    ) : <textarea aria-label="Project notes" value={text} placeholder="Write project notes in Markdown…"
      onChange={(event) => onChange(event.target.value)} />}
  </div>;
}
