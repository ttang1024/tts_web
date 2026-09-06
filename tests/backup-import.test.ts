import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchBookmarks, fetchDocuments } from "@/lib/documents";
import { importLibrary } from "@/lib/backup";

// Importing into an *empty* library needs its own file: lib/idb caches the open
// connection, so a fresh database means a fresh process (see tests/run.mjs).
//
// The fixture is written out by hand rather than round-tripped through an
// export, so this also covers reading a file that a future version of the app
// (or a person with a text editor) produced: unknown fields, a missing hash, a
// document with no text, and a bookmark pointing at a document that isn't here.
const BACKUP = {
  format: "tts-web-library",
  version: 1,
  exported_at: "2026-02-01T09:00:00.000Z",
  documents: [
    {
      id: 4,
      title: "Old book",
      source_type: "file",
      source: "book.epub",
      text: "Chapter one. It was a dark and stormy night.",
      text_hash: "seeded-hash",
      char_count: 44,
      sentence_count: 2,
      voice: "en-US-AriaNeural",
      progress_index: 1,
      tags: "fiction,evening",
      category: "Novels",
      summary: "A night.",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      something_from_a_later_version: true,
    },
    {
      // No text_hash: the importer has to compute one to dedupe against.
      id: 5,
      title: "Pasted note",
      source_type: "text",
      source: null,
      text: "Remember to water the plants.",
      char_count: 29,
      sentence_count: 1,
      voice: null,
      progress_index: 0,
      tags: "",
      category: null,
      summary: null,
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    },
    // Nothing to read: skipped rather than taking the import down.
    { id: 6, title: "Empty", text: "   ", source_type: "text", source: null },
  ],
  bookmarks: [
    {
      id: 1,
      document_id: 4,
      sentence_index: 1,
      kind: "highlight",
      note: "the opening",
      quote: "It was a dark and stormy night.",
      created_at: "2026-01-02T00:00:00.000Z",
    },
    { id: 2, document_id: 5, sentence_index: 0, kind: "bookmark", note: null, quote: null, created_at: "2026-01-03T00:00:00.000Z" },
    // Points at a document that isn't in the file: dropped, not crashed on.
    { id: 3, document_id: 999, sentence_index: 0, kind: "bookmark", note: null, quote: null, created_at: "2026-01-03T00:00:00.000Z" },
  ],
};

const file = () => new File([JSON.stringify(BACKUP)], "tts-library-2026-02-01.json");

test("importing into an empty library restores everything readable", async () => {
  const result = await importLibrary(file());
  assert.deepEqual(result, {
    documentsAdded: 2,
    documentsMerged: 0,
    bookmarksAdded: 2,
    skipped: 1,
  });
});

test("documents come back with their reading state intact", async () => {
  const restored = await fetchDocuments();
  assert.equal(restored.length, 2);

  const book = restored.find((d) => d.title === "Old book")!;
  assert.equal(book.progress_index, 1);
  assert.equal(book.tags, "fiction,evening");
  assert.equal(book.category, "Novels");
  assert.equal(book.summary, "A night.");
  assert.equal(book.source, "book.epub");
  assert.equal(book.voice, "en-US-AriaNeural");
});

test("bookmarks are remapped onto their new document ids", async () => {
  const book = (await fetchDocuments()).find((d) => d.title === "Old book")!;
  const marks = await fetchBookmarks(book.id);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].kind, "highlight");
  assert.equal(marks[0].note, "the opening");
  // The backup's own ids don't survive; the document link is what matters.
  assert.equal(marks[0].document_id, book.id);
});

test("importing the same file again adds nothing", async () => {
  const result = await importLibrary(file());
  assert.deepEqual(result, {
    documentsAdded: 0,
    documentsMerged: 2,
    bookmarksAdded: 0,
    skipped: 1,
  });
  assert.equal((await fetchDocuments()).length, 2);

  const book = (await fetchDocuments()).find((d) => d.title === "Old book")!;
  assert.equal((await fetchBookmarks(book.id)).length, 1, "bookmarks didn't double up");
});
