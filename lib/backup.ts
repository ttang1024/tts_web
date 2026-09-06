// ---------------------------------------------------------------------------
// Library backup: export everything to a JSON file, and merge one back in.
//
// The library lives in the reader's own browser (lib/idb) — which is what lets
// the app run with nothing behind it but two synthesis routes, but also means
// "clear browsing data", a new laptop, or a different browser loses every
// document, bookmark, and reading position with no way back. This is that way
// back, and doubles as how you move a library between machines.
//
// Import merges rather than replaces: a document already present (same text,
// recognised by its content hash, exactly as saveDocument dedupes) keeps its
// place and takes whichever reading position is further along, so importing a
// backup twice, or into a library already in use, is safe.
// ---------------------------------------------------------------------------

import {
  BOOKMARKS,
  DOCUMENTS,
  add,
  getAll,
  hashText,
  put,
  tx,
} from "@/lib/idb";
import {
  MAX_CHARS,
  invalidateLibraryCache,
  type Bookmark,
  type DocumentRecord,
} from "@/lib/documents";

const FORMAT = "tts-web-library";
const FORMAT_VERSION = 1;

export type BackupFile = {
  format: typeof FORMAT;
  version: number;
  exported_at: string;
  documents: DocumentRecord[];
  bookmarks: Bookmark[];
};

export type ImportResult = {
  documentsAdded: number;
  documentsMerged: number;
  bookmarksAdded: number;
  skipped: number;
};

export async function exportLibrary(): Promise<{ blob: Blob; filename: string }> {
  const [documents, bookmarks] = await tx([DOCUMENTS, BOOKMARKS], "readonly", async (t) => [
    await getAll<DocumentRecord>(t.objectStore(DOCUMENTS)),
    await getAll<Bookmark>(t.objectStore(BOOKMARKS)),
  ]);

  const backup: BackupFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    documents,
    bookmarks,
  };
  const date = backup.exported_at.slice(0, 10);
  return {
    blob: new Blob([JSON.stringify(backup)], { type: "application/json" }),
    filename: `tts-library-${date}.json`,
  };
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't a library backup (it isn't valid JSON).");
  }
  const file = parsed as Partial<BackupFile> | null;
  if (!file || file.format !== FORMAT || !Array.isArray(file.documents)) {
    throw new Error("That file isn't a library backup exported by this app.");
  }
  if (num(file.version, 1) > FORMAT_VERSION) {
    throw new Error("That backup was written by a newer version of this app.");
  }
  return {
    format: FORMAT,
    version: num(file.version, 1),
    exported_at: str(file.exported_at),
    documents: file.documents as DocumentRecord[],
    bookmarks: Array.isArray(file.bookmarks) ? (file.bookmarks as Bookmark[]) : [],
  };
}

// A document from the file, normalized to the shape the store expects. Returns
// null for entries with no usable text — a truncated or hand-edited backup
// shouldn't take the whole import down with it.
function normalizeDocument(raw: DocumentRecord): Omit<DocumentRecord, "id" | "text_hash"> | null {
  const text = str(raw?.text);
  if (!text.trim() || text.length > MAX_CHARS) return null;
  const now = new Date().toISOString();
  const sourceType = raw?.source_type;
  return {
    title: str(raw?.title) || "Untitled",
    source_type:
      sourceType === "file" || sourceType === "url" || sourceType === "text" ? sourceType : "text",
    source: typeof raw?.source === "string" ? raw.source : null,
    text,
    char_count: text.length,
    sentence_count: Math.max(num(raw?.sentence_count), 0),
    voice: typeof raw?.voice === "string" ? raw.voice : null,
    progress_index: Math.max(num(raw?.progress_index), 0),
    tags: str(raw?.tags),
    category: typeof raw?.category === "string" && raw.category ? raw.category : null,
    summary: typeof raw?.summary === "string" ? raw.summary : null,
    created_at: str(raw?.created_at) || now,
    updated_at: str(raw?.updated_at) || now,
  };
}

export async function importLibrary(file: File): Promise<ImportResult> {
  const backup = parseBackup(await file.text());

  // Hashing is async and not an IndexedDB operation, so it has to happen before
  // the transaction opens — awaiting a non-IDB promise inside one lets it
  // auto-commit out from under the rest of the work.
  const incoming: { record: Omit<DocumentRecord, "id" | "text_hash">; hash: string; oldId: number }[] =
    [];
  let skipped = 0;
  for (const raw of backup.documents) {
    const record = normalizeDocument(raw);
    if (!record) {
      skipped++;
      continue;
    }
    const hash = str(raw?.text_hash) || (await hashText(record.text));
    incoming.push({ record, hash, oldId: num(raw?.id, -1) });
  }

  const result: ImportResult = {
    documentsAdded: 0,
    documentsMerged: 0,
    bookmarksAdded: 0,
    skipped,
  };

  await tx([DOCUMENTS, BOOKMARKS], "readwrite", async (t) => {
    const documents = t.objectStore(DOCUMENTS);
    const bookmarks = t.objectStore(BOOKMARKS);
    // Backup id -> id in this library, so bookmarks land on the right document.
    const idMap = new Map<number, number>();

    for (const { record, hash, oldId } of incoming) {
      const [existing] = await getAll<DocumentRecord>(documents.index("text_hash"), hash);
      if (existing) {
        // Same text already here: keep it, but take anything the backup knows
        // and this copy doesn't, and the further-along reading position.
        const merged: DocumentRecord = {
          ...existing,
          progress_index: Math.max(existing.progress_index, record.progress_index),
          voice: existing.voice ?? record.voice,
          tags: existing.tags || record.tags,
          category: existing.category ?? record.category,
          summary: existing.summary ?? record.summary,
          updated_at:
            record.updated_at > existing.updated_at ? record.updated_at : existing.updated_at,
        };
        await put(documents, merged);
        idMap.set(oldId, existing.id);
        result.documentsMerged++;
      } else {
        const id = Number(await add(documents, { ...record, text_hash: hash }));
        idMap.set(oldId, id);
        result.documentsAdded++;
      }
    }

    // Bookmarks already on a merged document shouldn't double up, so each
    // target document's existing marks are read once and matched against.
    const existingByDoc = new Map<number, Bookmark[]>();
    for (const raw of backup.bookmarks) {
      const documentId = idMap.get(num(raw?.document_id, -1));
      if (documentId === undefined) continue;

      let existing = existingByDoc.get(documentId);
      if (!existing) {
        existing = await getAll<Bookmark>(bookmarks.index("document_id"), documentId);
        existingByDoc.set(documentId, existing);
      }
      const record: Omit<Bookmark, "id"> = {
        document_id: documentId,
        sentence_index: Math.max(num(raw?.sentence_index), 0),
        kind: raw?.kind === "highlight" ? "highlight" : "bookmark",
        note: typeof raw?.note === "string" ? raw.note : null,
        quote: typeof raw?.quote === "string" ? raw.quote : null,
        created_at: str(raw?.created_at) || new Date().toISOString(),
      };
      const duplicate = existing.some(
        (b) =>
          b.sentence_index === record.sentence_index &&
          b.kind === record.kind &&
          (b.note ?? null) === record.note
      );
      if (duplicate) continue;

      const id = Number(await add(bookmarks, record));
      existing.push({ ...record, id });
      result.bookmarksAdded++;
    }
  });

  invalidateLibraryCache();
  return result;
}
