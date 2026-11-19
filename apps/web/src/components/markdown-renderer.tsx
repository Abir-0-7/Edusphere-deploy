import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((piece, index) =>
    piece.startsWith('`') && piece.endsWith('`') ? (
      <code key={index} className="rounded bg-slate-100 px-1 font-mono text-sm">
        {piece.slice(1, -1)}
      </code>
    ) : (
      <span key={index}>{piece}</span>
    ),
  );
}

/** Render plain course text and bounded fenced code as escaped React nodes. */
export function MarkdownRenderer({ markdown, className = '' }: { markdown: string; className?: string }) {
  const blocks = markdown.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className={`min-w-0 break-words text-slate-800 ${className}`}>
      {blocks.map((block, index) => {
        const code = /^```([\w-]*)\n([\s\S]*?)\n```$/.exec(block);
        if (code) {
          return (
            <pre
              key={index}
              className="my-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-sm text-slate-100"
            >
              <code>{code[2]}</code>
            </pre>
          );
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(block.trim());
        if (heading) {
          const Tag = heading[1]!.length === 1 ? 'h2' : 'h3';
          return (
            <Tag key={index} className="my-3 font-semibold">
              {inline(heading[2]!)}
            </Tag>
          );
        }
        const lines = block.split('\n');
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="my-3 list-disc space-y-1 pl-6">
              {lines.map((line, item) => (
                <li key={item}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="my-3 whitespace-pre-wrap leading-7">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}
