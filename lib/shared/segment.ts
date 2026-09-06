// Pure text utilities shared by the synthesis routes (extraction, TTS) and the
// reader UI. Keep this file free of Node-only, DOM-only, or heavy imports — it
// runs on both sides.

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SENTENCE_REGEX = /[^.!?。！？\n]+[.!?。！？]*["'”’)]?\s*/g;

function splitSentences(paragraph: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    return Array.from(segmenter.segment(paragraph), (s) => s.segment.trim()).filter(
      Boolean
    );
  }
  return (paragraph.match(SENTENCE_REGEX) ?? [paragraph])
    .map((s) => s.trim())
    .filter(Boolean);
}

// Splits normalized text into paragraphs of sentences for the read-along view.
// Single newlines (common in PDF extractions) are treated as soft wraps.
export function segmentText(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((p) => splitSentences(p.replace(/\n/g, " ").trim()))
    .filter((p) => p.length > 0);
}

// Lines that start their own Markdown block (heading, list item, blockquote,
// table row) rather than flowing as prose.
const MD_BLOCK_LINE = /^[ \t]*(#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|\|)/;
const MD_FENCE = /^[ \t]*(```|~~~)/;
const MD_HR = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/;
const MD_TABLE_DIVIDER = /^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/;

// Like segmentText, but keeps Markdown block structure: headings, list items,
// and blockquotes each become their own single-sentence "paragraph" (so the
// reader can style them), while regular prose paragraphs are sentence-split as
// usual. The Markdown source is preserved on each sentence for rendering.
export function segmentMarkdown(text: string): string[][] {
  const blocks: string[][] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length) {
      const sentences = splitSentences(prose.join(" ").trim());
      if (sentences.length) blocks.push(sentences);
      prose = [];
    }
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || MD_FENCE.test(line) || MD_HR.test(line) || MD_TABLE_DIVIDER.test(line)) {
      // Blank lines and fence/rule/divider noise just end the current block.
      flushProse();
      continue;
    }
    if (MD_BLOCK_LINE.test(line)) {
      flushProse();
      blocks.push([trimmed]);
    } else {
      prose.push(trimmed);
    }
  }
  flushProse();
  return blocks;
}

// Strips Markdown syntax to plain prose for speech, so the synthesizer never
// reads symbols like "#", "*", or link URLs aloud. Conservative: it only
// removes well-formed Markdown so plain text passes through unchanged.
export function stripMarkdown(md: string): string {
  return md
    .replace(MD_FENCE, "") // opening/closing code fence on its own line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // link -> link text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1") // reference link -> text
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "") // heading markers
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "") // blockquote markers
    .replace(MD_HR, "") // horizontal rule
    .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, "") // list markers
    .replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, "") // table divider rows
    .replace(/\|/g, " ") // table cell separators
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(\*|_)(.+?)\1/g, "$2") // italic
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`([^`]+)`/g, "$1"); // inline code
}

// The Edge TTS websocket rejects very large payloads, so long documents are
// synthesized in chunks and the MP3 frames concatenated.
export function chunkText(text: string, maxLen = 2500): string[] {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？]?\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxLen && current) {
      chunks.push(current);
      current = "";
    }
    // A single sentence longer than maxLen gets hard-split.
    if (sentence.length > maxLen) {
      for (let i = 0; i < sentence.length; i += maxLen) {
        chunks.push(sentence.slice(i, i + maxLen));
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current);

  return chunks.map((c) => c.trim()).filter(Boolean);
}
