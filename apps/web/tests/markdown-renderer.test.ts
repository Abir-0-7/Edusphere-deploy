import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../src/components/markdown-renderer';

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(MarkdownRenderer, { markdown }));
}

describe('shared Markdown renderer', () => {
  it('ignores raw HTML, rejects unsafe links, and does not fetch embedded images', () => {
    const html = render(
      '<script>alert("xss")</script>\n\n[unsafe](javascript:alert(1))\n\n![pixel](https://tracker.example/pixel.png)',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('unsafe');
  });

  it('renders GFM tables, fenced code as text, and bounded math output', () => {
    const html = render(
      '| Name | Value |\n| --- | ---: |\n| x | 2 |\n\n```python\nprint("<img>")\n```\n\n$\\frac{1}{2}$',
    );
    expect(html).toContain('<table');
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
    expect(html).toContain('katex');
  });
});
