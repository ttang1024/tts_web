import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { findMatches, foldForSearch, nearestMatch, stepMatch } from "@/lib/shared";

// Find-in-document for the reader. The browser's own find highlights text on
// the page but can't move playback; this jumps the reader — and, if it is
// playing, the audio — to the matching sentence.
//
// Matches are counted as you type, but moving to one happens on Enter (or the
// next/previous buttons) rather than on every keystroke: incremental jumping
// would restart playback on every letter typed.
export function useFind(
  flat: string[],
  currentRef: RefObject<number>,
  select: (index: number) => void
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index into `matches` of the one being read, or null before the first jump:
  // the first Enter goes to the match nearest where the reader already is, and
  // only after that does Enter mean "the next one".
  const [position, setPosition] = useState<number | null>(null);
  const positionRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Folding a whole book on every keystroke would be the expensive part of
  // searching one, so it happens once per document — and not at all until the
  // find bar is actually opened, so opening a document costs nothing extra.
  const folded = useMemo(() => (open ? flat.map(foldForSearch) : []), [flat, open]);
  const matches = useMemo(() => findMatches(folded, query), [folded, query]);

  const reset = useCallback(() => {
    positionRef.current = null;
    setPosition(null);
  }, []);

  const changeQuery = useCallback(
    (value: string) => {
      setQuery(value);
      reset();
    },
    [reset]
  );

  const openFind = useCallback(() => {
    setOpen(true);
    // Focus once the bar has rendered, selecting what's there so typing
    // replaces the previous search.
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  const closeFind = useCallback(() => {
    setOpen(false);
    setQuery("");
    reset();
  }, [reset]);

  // Moves to the next (delta 1) or previous (delta -1) match, wrapping around.
  const goToMatch = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const next =
        positionRef.current === null
          ? nearestMatch(matches, currentRef.current)
          : stepMatch(matches, positionRef.current, delta);
      positionRef.current = next;
      setPosition(next);
      select(matches[next]);
    },
    [matches, currentRef, select]
  );

  return {
    findOpen: open,
    findQuery: query,
    findInputRef: inputRef,
    matches,
    // 1-based for display; 0 until the reader has jumped to one.
    matchNumber: position === null ? 0 : position + 1,
    changeQuery,
    openFind,
    closeFind,
    goToMatch,
  };
}
