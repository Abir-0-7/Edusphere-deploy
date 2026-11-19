'use client';

import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-5 text-2xl font-bold leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-xl font-semibold leading-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold leading-tight">{children}</h3>,
  p: ({ children }) => <p className="my-3 whitespace-pre-wrap leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-emerald-700 pl-4 text-slate-700">{children}</blockquote>
  ),
  hr: () => <hr className="my-5 border-slate-200" />,
  a: ({ href, children }) =>
    href ? (
      <a href={href} rel="noreferrer" className="break-words text-emerald-900 underline underline-offset-2">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-6 text-slate-100">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code
      className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-slate-900 ${className ?? ''}`}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-300 bg-slate-100 px-3 py-2 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-slate-300 px-3 py-2 align-top">{children}</td>,
};

const mathSafeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', 'language-math', 'math-inline', 'math-display'],
    ],
  },
};

function safeUrlTransform(url: string, key: string): string {
  if (key !== 'href') return '';
  const value = url.trim();
  if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** Render untrusted lesson/AI Markdown as React nodes; raw HTML and remote images are omitted. */
export function MarkdownRenderer({ markdown, className = '' }: { markdown: string; className?: string }) {
  return (
    <div className={`min-w-0 break-words text-slate-800 ${className}`}>
      <ReactMarkdown
        skipHtml
        disallowedElements={['img']}
        urlTransform={safeUrlTransform}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeSanitize, mathSafeSchema],
          [rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000 }],
        ]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
