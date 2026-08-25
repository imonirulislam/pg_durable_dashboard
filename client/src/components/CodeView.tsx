import { useState } from 'react';
import { reconstruct } from '../dsl';
import type { InstanceNode } from '../types';

interface Props {
  nodes: InstanceNode[];
  label: string | null;
}

// Light, regex-based highlighting — this is a handful of df.* calls and SQL
// string literals, not a language worth a real tokenizer for.
function highlight(line: string): { key: string; className?: string; text: string }[] {
  const parts: { key: string; className?: string; text: string }[] = [];
  const pattern = /(df\.[a-z_]+)|('(?:[^']|'')*')/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(line))) {
    if (match.index > last) parts.push({ key: `t${i++}`, text: line.slice(last, match.index) });
    const className = match[1] ? 'code-fn' : 'code-str';
    parts.push({ key: `m${i++}`, className, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ key: `t${i++}`, text: line.slice(last) });
  return parts;
}

export default function CodeView({ nodes, label }: Props) {
  const [copied, setCopied] = useState(false);
  const lines = reconstruct(nodes, label);
  const source = lines.map((l) => `${'  '.repeat(l.indent)}${l.text}`).join('\n');

  const copy = () => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (nodes.length === 0) {
    return <div className="empty">no graph data yet.</div>;
  }

  return (
    <div className="code-view">
      <div className="code-view-toolbar">
        <span className="code-view-note">
          reconstructed from the executed node tree — pg_durable stores no original source
        </span>
        <button type="button" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="code-view-source">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="code-view-line" data-node-id={line.nodeId ?? undefined}>
              {'  '.repeat(line.indent)}
              {highlight(line.text).map((part) =>
                part.className ? (
                  <span key={part.key} className={part.className}>
                    {part.text}
                  </span>
                ) : (
                  part.text
                )
              )}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
