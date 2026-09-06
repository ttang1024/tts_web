import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  createBookmark,
  fetchBookmarks,
  removeBookmark,
  updateBookmark,
  type Bookmark,
} from "@/lib/documents";

// Bookmarks/highlights for the current document: loading, the "b"/"h"
// keyboard shortcuts, and CRUD against the local library. `currentRef`/`flatRef`
// are the Reader's live-value refs (current sentence index, flattened
// sentence list) so this can read them without going stale or forcing the
// Reader to resubscribe effects on every sentence change.
export function useBookmarks(
  documentId: number | null | undefined,
  currentRef: RefObject<number>,
  flatRef: RefObject<string[]>,
  onError: (message: string | null) => void
) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarksBusy, setBookmarksBusy] = useState(false);
  const bookmarksRef = useRef<Bookmark[]>(bookmarks);
  bookmarksRef.current = bookmarks;

  // Load once per document.
  useEffect(() => {
    setBookmarks([]);
    if (documentId == null) return;
    let cancelled = false;
    fetchBookmarks(documentId)
      .then((bs) => {
        if (!cancelled) setBookmarks(bs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Adds or removes a bookmark/highlight on the current sentence.
  const toggleMark = useCallback(
    async (kind: "bookmark" | "highlight") => {
      if (documentId == null || bookmarksBusy) return;
      const idx = currentRef.current;
      const existing = bookmarksRef.current.find(
        (b) => b.sentence_index === idx && b.kind === kind
      );
      setBookmarksBusy(true);
      onError(null);
      try {
        if (existing) {
          await removeBookmark(documentId, existing.id);
          setBookmarks((bs) => bs.filter((b) => b.id !== existing.id));
        } else {
          const quote = flatRef.current[idx]?.slice(0, 200) ?? null;
          const created = await createBookmark(documentId, { sentenceIndex: idx, kind, quote });
          setBookmarks((bs) => [...bs, created].sort((a, b) => a.sentence_index - b.sentence_index));
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to update bookmark.");
      } finally {
        setBookmarksBusy(false);
      }
    },
    [documentId, bookmarksBusy, currentRef, flatRef, onError]
  );

  async function deleteMark(id: number) {
    if (documentId == null) return;
    try {
      await removeBookmark(documentId, id);
      setBookmarks((bs) => bs.filter((b) => b.id !== id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete bookmark.");
    }
  }

  async function saveNote(id: number, note: string) {
    if (documentId == null) return;
    try {
      const updated = await updateBookmark(documentId, id, { note: note.trim() || null });
      setBookmarks((bs) => bs.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save note.");
    }
  }

  // Bookmark/highlight keyboard shortcuts ("b" / "h"), bound once; reads live
  // state through a ref since it never resubscribes.
  const toggleMarkRef = useRef(toggleMark);
  toggleMarkRef.current = toggleMark;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (e.key === "b") void toggleMarkRef.current("bookmark");
      else if (e.key === "h") void toggleMarkRef.current("highlight");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const marksByIndex = useMemo(() => {
    const map = new Map<number, { highlight: boolean; bookmark: boolean }>();
    for (const b of bookmarks) {
      const entry = map.get(b.sentence_index) ?? { highlight: false, bookmark: false };
      if (b.kind === "highlight") entry.highlight = true;
      else entry.bookmark = true;
      map.set(b.sentence_index, entry);
    }
    return map;
  }, [bookmarks]);

  return { bookmarks, bookmarksBusy, marksByIndex, toggleMark, deleteMark, saveNote };
}
