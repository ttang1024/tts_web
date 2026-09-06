// ---------------------------------------------------------------------------
// Chapter detection, ported from the monorepo server. It's pure text analysis
// with no I/O, so with the library in the browser it runs client-side and the
// reader's chapter list needs no round trip at all.
//
// We don't have per-chapter audio durations without rendering each separately,
// so chapter start times are estimated by distributing the total estimated
// listening time across chapters in proportion to their character counts —
// accurate enough for navigation.
// ---------------------------------------------------------------------------

export type PlannedChapter = { title: string; text: string; charOffset: number; charCount: number };

const HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*$/;

function isMarkdownSource(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown)$/i.test(name);
}

// Splits a document into chapters. Markdown is split on its headings; other
// sources fall back to splitting on blank-line-separated blocks that look like
// chapter titles ("Chapter 5", "PART TWO", roman numerals), and otherwise to a
// single chapter.
export function planChapters(text: string, source: string | null | undefined): PlannedChapter[] {
  const markdown = isMarkdownSource(source);
  const lines = text.split("\n");
  const cuts: { index: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (markdown) {
      const m = line.match(HEADING_RE);
      if (m) cuts.push({ index: i, title: m[2].trim() });
    } else if (isChapterHeading(trimmed, lines[i - 1], lines[i + 1])) {
      cuts.push({ index: i, title: trimmed.slice(0, 80) });
    }
  }

  if (cuts.length === 0) {
    const trimmed = text.trim();
    return trimmed
      ? [{ title: "Full document", text: trimmed, charOffset: 0, charCount: trimmed.length }]
      : [];
  }

  // Build chapter bodies from each cut to the next. Text before the first cut
  // (a preamble) becomes its own chapter so no audio is dropped.
  const chapters: PlannedChapter[] = [];
  const boundaries = cuts.map((c) => c.index);
  if (boundaries[0] > 0) {
    const body = lines.slice(0, boundaries[0]).join("\n").trim();
    if (body)
      chapters.push({ title: "Introduction", text: body, charOffset: 0, charCount: body.length });
  }
  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].index;
    const end = c + 1 < cuts.length ? cuts[c + 1].index : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    if (body)
      chapters.push({
        title: cuts[c].title || `Chapter ${c + 1}`,
        text: body,
        charOffset: 0,
        charCount: body.length,
      });
  }

  // Fill in running char offsets.
  let offset = 0;
  for (const ch of chapters) {
    ch.charOffset = offset;
    offset += ch.charCount;
  }
  return chapters;
}

// Heuristic plain-text chapter heading: a short standalone line, surrounded by
// blank lines, that reads like a chapter marker.
function isChapterHeading(line: string, prev: string | undefined, next: string | undefined): boolean {
  if (!line || line.length > 60) return false;
  const blankAround = (prev === undefined || !prev.trim()) && (next === undefined || !next.trim());
  if (!blankAround) return false;
  if (/^(chapter|part|book|section)\b/i.test(line)) return true;
  if (/^[IVXLC]+\.?$/.test(line)) return true; // roman numeral
  if (/^\d{1,3}[.)]?$/.test(line)) return true; // numbered
  return false;
}

// Distributes a total duration (seconds) across chapters by character weight,
// returning each chapter's start time in seconds.
export function chapterStartTimes(chapters: PlannedChapter[], totalSeconds: number): number[] {
  const totalChars = chapters.reduce((sum, c) => sum + Math.max(c.charCount, 1), 0);
  const starts: number[] = [];
  let acc = 0;
  for (const ch of chapters) {
    starts.push((acc / totalChars) * totalSeconds);
    acc += Math.max(ch.charCount, 1);
  }
  return starts;
}
