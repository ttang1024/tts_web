// Lightweight Markdown rendering for the reader. We only need inline emphasis,
// code, and links plus a handful of block types, and the reader already works
// sentence-by-sentence — so rather than pull in a full Markdown library we
// classify each sentence's block kind and render its inline marks.
import type { ReactNode } from "react";

export type BlockKind = "heading" | "list" | "quote" | "paragraph";

export type Block = {
  kind: BlockKind;
  level: number; // heading level 1-6; 0 otherwise
  text: string; // the sentence with its leading block marker removed
};

// Strips a leading block marker (heading #, list bullet, blockquote >) off a
// sentence and reports what it was, so the reader can pick a wrapper element.
export function classifyBlock(sentence: string): Block {
  const heading = /^(#{1,6})[ \t]+(.*)$/.exec(sentence);
  if (heading) return { kind: "heading", level: heading[1].length, text: heading[2] };

  const list = /^([-*+]|\d+[.)])[ \t]+(.*)$/.exec(sentence);
  if (list) return { kind: "list", level: 0, text: list[2] };

  if (/^>[ \t]?/.test(sentence)) return { kind: "quote", level: 0, text: sentence.replace(/^>[ \t]?/, "") };

  return { kind: "paragraph", level: 0, text: sentence };
}

// A fresh regex per call: renderInline recurses for nested emphasis, and a
// shared /g regex's lastIndex would be clobbered by the inner call.
const inlinePattern = () =>
  /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

// Renders inline Markdown (bold, italic, code, links) to React nodes.
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  const inline = inlinePattern();
  while ((match = inline.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      nodes.push(<strong key={key++}>{renderInline(match[2])}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={key++}>{renderInline(match[4])}</em>);
    } else if (match[5] != null) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800"
        >
          {match[5]}
        </code>
      );
    } else if (match[6] != null) {
      nodes.push(
        <a
          key={key++}
          href={match[7]}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400"
        >
          {renderInline(match[6])}
        </a>
      );
    }
    lastIndex = inline.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
