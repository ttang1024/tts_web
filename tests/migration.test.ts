import "fake-indexeddb/auto";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fetchBookmarks, fetchDocuments } from "@/lib/documents";
import { audioCacheCount, readCachedAudio, writeCachedAudio } from "@/lib/audioCache";

// Anyone already using the app has a version 1 database. Opening it at version 2
// (which added the audio store) must not cost them their library, so this builds
// the v1 schema exactly as it shipped and then goes in through the app's code.
function seedVersion1(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tts-library", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const documents = db.createObjectStore("documents", { keyPath: "id", autoIncrement: true });
      documents.createIndex("text_hash", "text_hash", { unique: false });
      const bookmarks = db.createObjectStore("bookmarks", { keyPath: "id", autoIncrement: true });
      bookmarks.createIndex("document_id", "document_id", { unique: false });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["documents", "bookmarks"], "readwrite");
      transaction.objectStore("documents").add({
        title: "Old book",
        source_type: "file",
        source: "book.epub",
        text: "Chapter one. It was a dark and stormy night.",
        text_hash: "seeded",
        char_count: 44,
        sentence_count: 2,
        voice: "en-US-AriaNeural",
        progress_index: 1,
        tags: "fiction",
        category: null,
        summary: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      });
      transaction.objectStore("bookmarks").add({
        document_id: 1,
        sentence_index: 1,
        kind: "bookmark",
        note: null,
        quote: null,
        created_at: "2026-01-02T00:00:00.000Z",
      });
      transaction.oncomplete = () => {
        // Close it, or the upgrade to v2 blocks.
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

before(seedVersion1);

test("a version 1 library survives the upgrade", async () => {
  const docs = await fetchDocuments();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, "Old book");
  assert.equal(docs[0].progress_index, 1, "reading position kept");
  assert.equal(docs[0].tags, "fiction");
});

test("bookmarks survive the upgrade", async () => {
  const [doc] = await fetchDocuments();
  assert.equal((await fetchBookmarks(doc.id)).length, 1);
});

test("the store added by the upgrade is usable", async () => {
  await writeCachedAudio("en-US-AriaNeural", "Chapter one.", new Uint8Array([1, 2, 3]), []);
  assert.equal(await audioCacheCount(), 1);
  assert.equal((await readCachedAudio("en-US-AriaNeural", "Chapter one."))?.mp3.length, 3);
});
