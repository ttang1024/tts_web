import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBookmark,
  fetchBookmarks,
  fetchCategories,
  fetchDocuments,
  removeDocument,
  saveDocument,
  updateDocument,
} from "@/lib/documents";
import { exportLibrary, importLibrary } from "@/lib/backup";

// One library, built up across these tests in order — they share a process and
// therefore a database (see tests/run.mjs).
test("saving a document puts it in the library", async () => {
  const doc = await saveDocument({ title: "First", text: "Hello there. How are you?" });
  assert.equal(doc.title, "First");
  assert.equal((await fetchDocuments()).length, 1);
});

test("saving the same text again refreshes rather than duplicating", async () => {
  await saveDocument({ title: "First again", text: "Hello there. How are you?" });
  const docs = await fetchDocuments();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, "First again");
});

test("a write is visible to the very next read", async () => {
  // The library caches the deserialized document list for a couple of seconds;
  // a local write has to drop it, or the page shows stale rows.
  const doc = await saveDocument({ title: "Second", text: "A different document." });
  assert.equal((await fetchDocuments()).length, 2);

  await updateDocument(doc.id, { title: "Renamed" });
  assert.equal((await fetchDocuments()).find((d) => d.id === doc.id)?.title, "Renamed");

  await removeDocument(doc.id);
  assert.equal((await fetchDocuments()).length, 1);
});

test("documents carry a speech rate derived from their own text", async () => {
  const chinese = await saveDocument({ title: "中文", text: "这是一段中文文本，用来测试。" });
  const english = await saveDocument({ title: "English", text: "This is an English document." });
  const docs = await fetchDocuments();
  const rateOf = (id: number) => docs.find((d) => d.id === id)!.speech_rate;
  assert.ok(rateOf(chinese.id) < rateOf(english.id));
  await removeDocument(chinese.id);
  await removeDocument(english.id);
});

test("filters and sorting", async () => {
  const doc = await saveDocument({ title: "Notes", text: "Something about badgers." });
  await updateDocument(doc.id, { tags: ["wildlife"], category: "Nature" });

  assert.equal((await fetchDocuments({ q: "badgers" })).length, 1, "searches the body");
  assert.equal((await fetchDocuments({ q: "Notes" })).length, 1, "searches the title");
  assert.equal((await fetchDocuments({ q: "penguins" })).length, 0);
  assert.equal((await fetchDocuments({ tag: "wildlife" })).length, 1);
  assert.equal((await fetchDocuments({ category: "Nature" })).length, 1);
  assert.equal((await fetchDocuments({ category: "Other" })).length, 0);
  assert.deepEqual(await fetchCategories(), [{ name: "Nature", count: 1 }]);

  const byTitle = await fetchDocuments({ sort: "title" });
  assert.deepEqual(
    byTitle.map((d) => d.title),
    [...byTitle.map((d) => d.title)].sort((a, b) => a.localeCompare(b))
  );
  await removeDocument(doc.id);
});

test("a document over the character limit is refused", async () => {
  await assert.rejects(
    () => saveDocument({ title: "Huge", text: "x".repeat(100_001) }),
    /limit is 100,000/
  );
});

test("exporting produces a dated file holding documents and bookmarks", async () => {
  const [doc] = await fetchDocuments();
  await createBookmark(doc.id, { sentenceIndex: 1, kind: "highlight", note: "nice" });

  const { blob, filename } = await exportLibrary();
  assert.match(filename, /^tts-library-\d{4}-\d{2}-\d{2}\.json$/);

  const backup = JSON.parse(await blob.text());
  assert.equal(backup.format, "tts-web-library");
  assert.equal(backup.documents.length, 1);
  assert.equal(backup.bookmarks.length, 1);
  assert.equal(backup.documents[0].text, "Hello there. How are you?");
});

test("importing a backup of what is already here changes nothing", async () => {
  const { blob } = await exportLibrary();
  const json = await blob.text();

  const result = await importLibrary(new File([json], "backup.json"));
  assert.deepEqual(result, {
    documentsAdded: 0,
    documentsMerged: 1,
    bookmarksAdded: 0,
    skipped: 0,
  });
  assert.equal((await fetchDocuments()).length, 1);
  assert.equal((await fetchBookmarks((await fetchDocuments())[0].id)).length, 1);
});

test("importing keeps whichever reading position is further along", async () => {
  const [doc] = await fetchDocuments();
  await updateDocument(doc.id, { progressIndex: 7 });
  const { blob } = await exportLibrary();
  const json = await blob.text();

  // Fall behind, then re-import: the backup's position wins.
  await updateDocument(doc.id, { progressIndex: 0 });
  await importLibrary(new File([json], "backup.json"));
  assert.equal((await fetchDocuments())[0].progress_index, 7);

  // Get ahead of the backup: this library's position wins instead.
  await updateDocument(doc.id, { progressIndex: 12 });
  await importLibrary(new File([json], "backup.json"));
  assert.equal((await fetchDocuments())[0].progress_index, 12);
});

test("a file that isn't a backup is refused with a readable message", async () => {
  await assert.rejects(() => importLibrary(new File(["not json"], "x.json")), /valid JSON/);
  await assert.rejects(
    () => importLibrary(new File([JSON.stringify({ format: "something-else" })], "x.json")),
    /exported by this app/
  );
  await assert.rejects(
    () =>
      importLibrary(
        new File([JSON.stringify({ format: "tts-web-library", version: 99, documents: [] })], "x.json")
      ),
    /newer version/
  );
});
