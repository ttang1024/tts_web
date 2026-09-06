// The library. Same API the pages and hooks were already written against —
// list/read/update/delete/merge documents and their bookmarks — but backed by
// the browser's own IndexedDB rather than a server database, so the app needs
// nothing behind it but static hosting and the two synthesis routes.

import {
  estimateSpeechSeconds,
  segmentText,
  segmentMarkdown,
  speechRate,
  stripMarkdown,
} from "@/lib/shared";
import { chapterStartTimes, planChapters } from "@/lib/chapters";
import { BOOKMARKS, DOCUMENTS, add, del, get, getAll, hashText, put, tx } from "@/lib/idb";

export type DocumentSummary = {
  id: number;
  title: string;
  source_type: "file" | "text" | "url";
  source: string | null;
  char_count: number;
  sentence_count: number;
  voice: string | null;
  progress_index: number;
  tags: string;
  category: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  // Characters this document's language is spoken at per second — derived from
  // the text, not stored, so no migration and no stale value after an edit.
  // Lists only ever have a character count to work from, and 3,000 characters
  // of Chinese is a very different listen from 3,000 characters of English.
  speech_rate: number;
};

// The stored shape. `speech_rate` is the one summary field that isn't a column
// here: it is derived from the text every time a summary is built.
export type DocumentRecord = Omit<DocumentSummary, "speech_rate"> & {
  text: string;
  text_hash: string;
};

export type ListFilters = {
  q?: string;
  type?: DocumentSummary["source_type"];
  tag?: string;
  category?: string;
  sort?: "recent" | "created" | "title" | "progress";
};

// Sentinel category filter value selecting documents with no category assigned.
export const UNCATEGORIZED = "__uncategorized__";

// Same ceiling the extraction route enforces, applied to text that never went
// through it (pasted text, merges).
export const MAX_CHARS = 100_000;

export function isMarkdownSource(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown)$/i.test(name);
}

function countSentences(text: string, sourceType: string, source: string | null): number {
  const markdown = sourceType === "file" && isMarkdownSource(source);
  return (markdown ? segmentMarkdown(text) : segmentText(text)).flat().length;
}

function summaryOf(doc: DocumentRecord): DocumentSummary {
  const { text, text_hash: _hash, ...rest } = doc;
  return { ...rest, speech_rate: speechRate(text) };
}

// Listing and counting categories both need every document, and the library
// re-runs both on every filter change and (debounced) every keystroke typed
// into the search box. Each of those reads deserializes the full text of the
// whole library out of IndexedDB, which for a shelf of books is tens of
// megabytes of structured-clone work per keystroke. Hold the deserialized
// snapshot briefly instead: local writes drop it immediately, and the short TTL
// bounds how stale a write from another tab can leave it.
const SNAPSHOT_TTL_MS = 2_000;
let snapshot: { at: number; docs: Promise<DocumentRecord[]> } | null = null;

export function invalidateLibraryCache(): void {
  snapshot = null;
}

// Callers treat the result as read-only (fetchDocuments copies each record via
// summaryOf; fetchCategories only counts), so one snapshot can back them all.
async function allDocuments(): Promise<DocumentRecord[]> {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.docs;
  const docs = tx(DOCUMENTS, "readonly", (t) =>
    getAll<DocumentRecord>(t.objectStore(DOCUMENTS))
  );
  const entry = { at: Date.now(), docs };
  snapshot = entry;
  // A failed read shouldn't be remembered for the next two seconds.
  docs.catch(() => {
    if (snapshot === entry) snapshot = null;
  });
  return docs;
}

const SORTS: Record<
  NonNullable<ListFilters["sort"]>,
  (a: DocumentSummary, b: DocumentSummary) => number
> = {
  recent: (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id,
  created: (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || b.id - a.id,
  progress: (a, b) =>
    b.progress_index / Math.max(b.sentence_count, 1) -
      a.progress_index / Math.max(a.sentence_count, 1) || b.id - a.id,
};

export async function fetchDocuments(filters: ListFilters = {}): Promise<DocumentSummary[]> {
  const docs = await allDocuments();
  const needle = filters.q?.toLowerCase().trim();
  return docs
    .filter((doc) => {
      if (filters.type && doc.source_type !== filters.type) return false;
      if (filters.tag && !doc.tags.split(",").includes(filters.tag)) return false;
      if (filters.category === UNCATEGORIZED) {
        if (doc.category) return false;
      } else if (filters.category && doc.category !== filters.category) {
        return false;
      }
      if (needle) {
        // Title first (cheap), then the body — the same "search what you read"
        // behaviour the SQLite full-text index gave, without the index.
        return (
          doc.title.toLowerCase().includes(needle) || doc.text.toLowerCase().includes(needle)
        );
      }
      return true;
    })
    .map(summaryOf)
    .sort(SORTS[filters.sort ?? "recent"] ?? SORTS.recent);
}

export async function fetchCategories(): Promise<{ name: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const doc of await allDocuments()) {
    if (doc.category) counts.set(doc.category, (counts.get(doc.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function fetchDocument(id: number): Promise<DocumentRecord> {
  const doc = await tx(DOCUMENTS, "readonly", (t) =>
    get<DocumentRecord>(t.objectStore(DOCUMENTS), id)
  );
  if (!doc) throw new Error("That document is no longer in the library.");
  return doc;
}

export type SaveInput = {
  title: string;
  text: string;
  sourceType?: DocumentSummary["source_type"];
  source?: string | null;
  voice?: string | null;
};

// Adds a document, or refreshes the existing entry when the identical text is
// already in the library (re-reading the same file shouldn't pile up
// duplicates, and it should keep the progress already made on it).
export async function saveDocument(input: SaveInput): Promise<DocumentSummary> {
  const text = input.text;
  if (text.length > MAX_CHARS) {
    throw new Error(
      `Document has ${text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}.`
    );
  }
  const hash = await hashText(text);
  const sourceType = input.sourceType ?? "text";
  const source = input.source ?? null;
  const now = new Date().toISOString();

  const saved = await tx(DOCUMENTS, "readwrite", async (t) => {
    const store = t.objectStore(DOCUMENTS);
    const [existing] = await getAll<DocumentRecord>(store.index("text_hash"), hash);
    if (existing) {
      const updated: DocumentRecord = {
        ...existing,
        title: input.title || existing.title,
        voice: input.voice ?? existing.voice,
        updated_at: now,
      };
      await put(store, updated);
      return summaryOf(updated);
    }

    const record: Omit<DocumentRecord, "id"> = {
      title: input.title || "Untitled",
      source_type: sourceType,
      source,
      text,
      text_hash: hash,
      char_count: text.length,
      sentence_count: countSentences(text, sourceType, source),
      voice: input.voice ?? null,
      progress_index: 0,
      tags: "",
      category: null,
      summary: null,
      created_at: now,
      updated_at: now,
    };
    const id = Number(await add(store, record));
    return summaryOf({ ...record, id });
  });
  invalidateLibraryCache();
  return saved;
}

// Saves pasted text to the library. Returns null instead of throwing —
// reading still works when the library can't be written to (private-mode
// quotas, storage disabled).
export async function createDocument(input: SaveInput): Promise<DocumentSummary | null> {
  try {
    return await saveDocument({ ...input, sourceType: input.sourceType ?? "text" });
  } catch {
    return null;
  }
}

export type DocumentPatch = {
  progressIndex?: number;
  voice?: string;
  title?: string;
  tags?: string[];
  // Empty string clears the category; undefined leaves it untouched.
  category?: string;
  summary?: string;
  text?: string;
};

export async function updateDocument(
  id: number,
  patch: DocumentPatch
): Promise<DocumentSummary> {
  if (patch.text !== undefined && patch.text.length > MAX_CHARS) {
    throw new Error(
      `Document has ${patch.text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}.`
    );
  }
  const hash = patch.text !== undefined ? await hashText(patch.text) : null;

  const updated = await tx(DOCUMENTS, "readwrite", async (t) => {
    const store = t.objectStore(DOCUMENTS);
    const existing = await get<DocumentRecord>(store, id);
    if (!existing) throw new Error("That document is no longer in the library.");

    const next: DocumentRecord = { ...existing, updated_at: new Date().toISOString() };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.voice !== undefined) next.voice = patch.voice;
    if (patch.tags !== undefined) next.tags = patch.tags.join(",");
    if (patch.category !== undefined) next.category = patch.category || null;
    if (patch.summary !== undefined) next.summary = patch.summary;
    if (patch.progressIndex !== undefined) next.progress_index = patch.progressIndex;

    if (patch.text !== undefined) {
      // An edit invalidates the old summary, and can shorten the document past
      // where the reader had got to.
      next.text = patch.text;
      next.text_hash = hash!;
      next.char_count = patch.text.length;
      next.sentence_count = countSentences(patch.text, next.source_type, next.source);
      next.summary = null;
      next.progress_index = Math.min(next.progress_index, Math.max(next.sentence_count - 1, 0));
    }

    await put(store, next);
    return summaryOf(next);
  });
  invalidateLibraryCache();
  return updated;
}

// Fire-and-forget progress/voice updates; reading shouldn't break when the
// library can't be written to.
export function patchDocument(
  id: number,
  patch: { progressIndex?: number; voice?: string }
): void {
  void updateDocument(id, patch).catch(() => {});
}

export async function summarizeDocument(id: number): Promise<DocumentSummary> {
  const doc = await fetchDocument(id);
  const res = await fetch("/api/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: doc.text }),
  });
  const body = (await res.json().catch(() => null)) as
    | { summary?: string; error?: string }
    | null;
  if (!res.ok || !body?.summary) {
    throw new Error(body?.error ?? `Summary failed (${res.status}).`);
  }
  return updateDocument(id, { summary: body.summary });
}

// Whether AI summaries are configured on this deployment, so the library can
// hide the button rather than offer something that will always fail.
export async function summariesEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/summary");
    return res.ok && (await res.json()).enabled === true;
  } catch {
    return false;
  }
}

export async function removeDocument(id: number): Promise<void> {
  await tx([DOCUMENTS, BOOKMARKS], "readwrite", async (t) => {
    await del(t.objectStore(DOCUMENTS), id);
    const index = t.objectStore(BOOKMARKS).index("document_id");
    for (const bookmark of await getAll<Bookmark>(index, id)) {
      await del(t.objectStore(BOOKMARKS), bookmark.id);
    }
  });
  invalidateLibraryCache();
}

// Merges documents into one new document. `ids` gives the synthesis sequence
// — the order the source texts are joined in.
export async function mergeDocuments(ids: number[], title?: string): Promise<DocumentSummary> {
  if (ids.length < 2) throw new Error("Select at least two documents to merge.");
  const sources: DocumentRecord[] = [];
  for (const id of ids) sources.push(await fetchDocument(id));
  const text = sources.map((d) => d.text).join("\n\n").trim();
  if (!text) throw new Error("No text to merge.");
  return saveDocument({
    title:
      title?.trim() || `Merged: ${sources.map((d) => d.title).join(" + ")}`.slice(0, 200),
    text,
    sourceType: "text",
  });
}

// ---------------------------------------------------------------------------
// Bookmarks & highlights
// ---------------------------------------------------------------------------

export type Bookmark = {
  id: number;
  document_id: number;
  sentence_index: number;
  kind: "bookmark" | "highlight";
  note: string | null;
  quote: string | null;
  created_at: string;
};

export async function fetchBookmarks(documentId: number): Promise<Bookmark[]> {
  const list = await tx(BOOKMARKS, "readonly", (t) =>
    getAll<Bookmark>(t.objectStore(BOOKMARKS).index("document_id"), documentId)
  );
  return list.sort((a, b) => a.sentence_index - b.sentence_index || a.id - b.id);
}

export async function createBookmark(
  documentId: number,
  input: {
    sentenceIndex: number;
    kind?: "bookmark" | "highlight";
    note?: string | null;
    quote?: string | null;
  }
): Promise<Bookmark> {
  const record: Omit<Bookmark, "id"> = {
    document_id: documentId,
    sentence_index: input.sentenceIndex,
    kind: input.kind ?? "bookmark",
    note: input.note ?? null,
    quote: input.quote ?? null,
    created_at: new Date().toISOString(),
  };
  return tx(BOOKMARKS, "readwrite", async (t) => {
    const id = Number(await add(t.objectStore(BOOKMARKS), record));
    return { ...record, id };
  });
}

export async function updateBookmark(
  _documentId: number,
  bookmarkId: number,
  patch: { note?: string | null }
): Promise<Bookmark> {
  return tx(BOOKMARKS, "readwrite", async (t) => {
    const store = t.objectStore(BOOKMARKS);
    const existing = await get<Bookmark>(store, bookmarkId);
    if (!existing) throw new Error("That bookmark no longer exists.");
    const next = { ...existing, ...(patch.note !== undefined ? { note: patch.note } : {}) };
    await put(store, next);
    return next;
  });
}

export async function removeBookmark(_documentId: number, bookmarkId: number): Promise<void> {
  await tx(BOOKMARKS, "readwrite", (t) => del(t.objectStore(BOOKMARKS), bookmarkId));
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export type Chapter = { title: string; charOffset: number; charCount: number; startSeconds: number };

// Chapter detection is pure text analysis (lib/chapters), so with the document
// already in the browser this needs no network round trip — it stays async
// only because the reader loads it from a document id.
export async function fetchChapters(documentId: number): Promise<Chapter[]> {
  const doc = await fetchDocument(documentId);
  const planned = planChapters(doc.text, doc.source);
  const speech = isMarkdownSource(doc.source) ? stripMarkdown(doc.text) : doc.text;
  const starts = chapterStartTimes(planned, estimateSpeechSeconds(speech));
  return planned.map((chapter, i) => ({
    title: chapter.title,
    charOffset: chapter.charOffset,
    charCount: chapter.charCount,
    startSeconds: starts[i],
  }));
}
