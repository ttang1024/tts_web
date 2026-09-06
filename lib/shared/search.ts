// Finding text inside an open document. Pure, so the reader can search a book
// without a round trip and the behaviour can be tested on its own.

// Case- and accent-insensitive form, so "cafe" finds "café" and "Über" finds
// "uber" — the kind of near-miss that otherwise looks like a broken search.
// Folding a whole document once per document (not once per keystroke) is what
// keeps searching a book cheap; the reader memoizes the folded sentences.

// The combining marks NFD decomposition leaves behind.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

// Indices of the sentences containing `query`. `folded` is the document's
// sentences already run through foldForSearch.
export function findMatches(folded: string[], query: string): number[] {
  const needle = foldForSearch(query).trim();
  if (!needle) return [];
  const matches: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    if (folded[i].includes(needle)) matches.push(i);
  }
  return matches;
}

// Where in `matches` to start from when the reader is sitting on sentence
// `current`: the first match at or after it, or the last one when every match
// is behind. Returns 0 for an empty list so callers can index safely.
export function nearestMatch(matches: number[], current: number): number {
  if (matches.length === 0) return 0;
  const at = matches.findIndex((index) => index >= current);
  return at === -1 ? matches.length - 1 : at;
}

// Steps through matches, wrapping at both ends — the "3 of 17 / 1 of 17"
// behaviour of every find bar.
export function stepMatch(matches: number[], position: number, delta: number): number {
  if (matches.length === 0) return 0;
  return (((position + delta) % matches.length) + matches.length) % matches.length;
}
