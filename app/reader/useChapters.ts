import { useEffect, useState } from "react";
import { fetchChapters, type Chapter } from "@/lib/documents";

// Detected chapters for the current document. Chapters are given as
// character offsets into the raw document text; `chapterIndex` maps one onto
// the nearest sentence using `charsBefore` (each sentence's own running
// character offset, computed by the Reader from its live segmentation) —
// approximate, since segmentation can shift text slightly, but close enough
// for navigation.
export function useChapters(documentId: number | null | undefined) {
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    setChapters([]);
    if (documentId == null) return;
    let cancelled = false;
    fetchChapters(documentId)
      .then((cs) => {
        if (!cancelled) setChapters(cs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  function chapterIndex(chapter: Chapter, charsBefore: number[], flatLength: number): number {
    let idx = charsBefore.findIndex((offset) => offset >= chapter.charOffset);
    if (idx === -1) idx = flatLength - 1;
    return Math.min(idx, Math.max(flatLength - 1, 0));
  }

  return { chapters, chapterIndex };
}
