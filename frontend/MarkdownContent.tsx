import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const syntax = [remarkGfm, remarkMath];
const math: [typeof rehypeKatex, { output: "mathml"; trust: false }] = [
  rehypeKatex, { output: "mathml", trust: false },
];

export default function MarkdownContent({ text }: { text: string }) {
  return <div className="markdown-content">
    <Markdown remarkPlugins={syntax} rehypePlugins={[math]} skipHtml
      components={{ a: ({ node: _node, ...link }) => <a {...link} target="_blank" rel="noopener noreferrer" /> }}>
      {text}
    </Markdown>
  </div>;
}
