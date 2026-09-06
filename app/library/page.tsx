"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Reader from "../Reader";
import ErrorBanner from "../ErrorBanner";
import { segmentText, segmentMarkdown, stripMarkdown, VOICES } from "@/lib/shared";
import { downloadBlob, isAbortError, safeFilename, synthesizeTextToMp3 } from "@/lib/tts";
import { isMarkdownSource } from "@/lib/documents";
import {
  fetchCategories,
  fetchDocument,
  fetchDocuments,
  mergeDocuments,
  patchDocument,
  removeDocument,
  summarizeDocument,
  summariesEnabled,
  updateDocument,
  type DocumentSummary,
  type ListFilters,
} from "@/lib/documents";
import { loadVoicePref } from "@/lib/voicePref";
import DocumentRow from "./DocumentRow";
import MergeDialog from "./MergeDialog";
import DeleteDialog from "./DeleteDialog";
import FilterBar from "./FilterBar";
import SelectionToolbar from "./SelectionToolbar";
import MiniPlayerBar from "./MiniPlayerBar";
import StorageBar from "./StorageBar";
import { useQueuePlayback, AUTO_STOP_OPTIONS } from "./useQueuePlayback";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

export default function Library() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ListFilters["type"] | "">("");
  const [tag, setTag] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [sort, setSort] = useState<NonNullable<ListFilters["sort"]>>("recent");
  // Bumped to force a refetch after something outside the filters changes the
  // library — importing a backup, say.
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // The merge dialog's working state: the selected documents in the order
  // they'll be joined in (the synthesis sequence), reorderable before
  // confirming. `null` means the dialog is closed.
  const [mergeOrder, setMergeOrder] = useState<DocumentSummary[] | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    ids: number[];
    titles: string[];
    bulk: boolean;
  } | null>(null);
  const [reading, setReading] = useState<{
    id: number;
    title: string;
    paragraphs: string[][];
    voice: string;
    initialIndex: number;
    isMarkdown: boolean;
    text: string;
  } | null>(null);

  const queuePlayback = useQueuePlayback((doc) => void open(doc));

  // AI summaries need ANTHROPIC_API_KEY on the deployment; without it the
  // button is hidden rather than offering something guaranteed to fail.
  useEffect(() => {
    void summariesEnabled().then(setAiEnabled);
  }, []);

  // Refetch on filter changes, with a short debounce for typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDocuments({
        q: query || undefined,
        type: type || undefined,
        tag: tag || undefined,
        category: category || undefined,
        sort,
      })
        .then(setDocuments)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Failed to load the library.")
        );
    }, 250);
    return () => clearTimeout(timer);
  }, [query, type, tag, category, sort, reading, refreshKey]);

  function refreshCategories() {
    fetchCategories()
      .then(setCategories)
      .catch(() => { });
  }

  useEffect(refreshCategories, [reading, refreshKey]);

  function patchLocal(updated: DocumentSummary) {
    setDocuments((docs) => docs?.map((d) => (d.id === updated.id ? updated : d)) ?? null);
  }

  async function open(summary: DocumentSummary) {
    setError(null);
    setBusyId(summary.id);
    try {
      const doc = await fetchDocument(summary.id);
      const markdown =
        doc.source_type === "file" && /\.(md|markdown)$/i.test(doc.source ?? "");
      const paragraphs = markdown ? segmentMarkdown(doc.text) : segmentText(doc.text);
      if (paragraphs.length === 0) throw new Error("No readable text found.");
      setReading({
        id: doc.id,
        title: doc.title,
        paragraphs,
        voice: doc.voice ?? loadVoicePref(),
        initialIndex: doc.progress_index,
        isMarkdown: markdown,
        text: doc.text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the document.");
    } finally {
      setBusyId(null);
    }
  }

  function playSelected() {
    if (!documents) return;
    const list = documents.filter((d) => selectedIds.has(d.id));
    if (queuePlayback.playSelected(list)) {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }

  function playAllOrSelected() {
    if (!documents) return;
    if (selectedIds.size > 0) {
      playSelected();
    } else {
      queuePlayback.playAll(documents);
    }
  }

  function requestDelete(id: number) {
    const doc = documents?.find((d) => d.id === id);
    setDeleteTarget({ ids: [id], titles: doc ? [doc.title] : [], bulk: false });
  }

  function toggleSelectMode() {
    setSelectMode((on) => !on);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: number) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((ids) =>
      documents && ids.size === documents.length ? new Set() : new Set(documents?.map((d) => d.id))
    );
  }

  function requestDeleteSelected() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const titles = documents?.filter((d) => selectedIds.has(d.id)).map((d) => d.title) ?? [];
    setDeleteTarget({ ids, titles, bulk: true });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { ids, bulk } = deleteTarget;
    setError(null);
    setBulkBusy(true);
    const results = await Promise.allSettled(ids.map((id) => removeDocument(id)));
    const failed = new Set(ids.filter((_, i) => results[i].status === "rejected"));
    setDocuments((docs) => docs?.filter((d) => !ids.includes(d.id) || failed.has(d.id)) ?? null);
    if (bulk) {
      setSelectedIds(failed);
      if (failed.size === 0) setSelectMode(false);
    }
    if (failed.size > 0) {
      setError(`Failed to delete ${failed.size} document${failed.size > 1 ? "s" : ""}.`);
    }
    setBulkBusy(false);
    setDeleteTarget(null);
  }

  function openMergeDialog() {
    if (!documents || selectedIds.size < 2) return;
    const list = documents.filter((d) => selectedIds.has(d.id));
    setMergeOrder(list);
    setMergeTitle(`Merged: ${list.map((d) => d.title).join(" + ")}`.slice(0, 120));
  }

  function moveMergeItem(index: number, dir: -1 | 1) {
    setMergeOrder((list) => {
      if (!list) return list;
      const target = index + dir;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function reorderMergeItem(from: number, to: number) {
    setMergeOrder((list) => {
      if (!list) return list;
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function confirmMerge() {
    if (!mergeOrder || mergeOrder.length < 2) return;
    setError(null);
    setMergeBusy(true);
    try {
      const created = await mergeDocuments(
        mergeOrder.map((d) => d.id),
        mergeTitle.trim() || undefined
      );
      setDocuments((docs) => (docs ? [created, ...docs] : [created]));
      refreshCategories();
      setMergeOrder(null);
      setSelectMode(false);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge documents.");
    } finally {
      setMergeBusy(false);
    }
  }

  async function saveEdit(id: number, patch: { title: string; tags: string; category: string }) {
    setError(null);
    try {
      const updated = await updateDocument(id, {
        title: patch.title.trim() || undefined,
        tags: patch.tags.split(",").map((t) => t.trim()).filter(Boolean),
        category: patch.category.trim(),
      });
      patchLocal(updated);
      setEditingId(null);
      refreshCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    }
  }

  async function summarize(id: number) {
    setError(null);
    setBusyId(id);
    try {
      const updated = await summarizeDocument(id);
      patchLocal(updated);
      setExpandedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summary failed.");
    } finally {
      setBusyId(null);
    }
  }

  // The synthesis route has no copy of the document, so its text is sent with
  // the request. Markdown symbols are stripped first so they aren't read out.
  async function download(
    doc: DocumentSummary,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void }
  ) {
    setError(null);
    try {
      const full = await fetchDocument(doc.id);
      const speech =
        full.source_type === "file" && isMarkdownSource(full.source)
          ? stripMarkdown(full.text)
          : full.text;
      const name = safeFilename(full.title);
      const blob = await synthesizeTextToMp3(
        speech,
        full.voice ?? loadVoicePref(),
        name,
        options
      );
      downloadBlob(blob, `${name}.mp3`);
    } catch (err) {
      // Cancelling isn't a failure worth a banner.
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : "Download failed.");
      }
    }
  }

  function toggleSummary(doc: DocumentSummary) {
    if (doc.summary) setExpandedId((id) => (id === doc.id ? null : doc.id));
    else void summarize(doc.id);
  }

  if (reading) {
    return (
      <Reader
        // Forces a full remount whenever a different document is opened, so
        // it starts from clean playback state instead of inheriting the
        // previous one's (current sentence, playing/loading, audio element).
        key={reading.id}
        title={reading.title}
        paragraphs={reading.paragraphs}
        voice={reading.voice}
        voices={VOICES}
        documentId={reading.id}
        isMarkdown={reading.isMarkdown}
        initialIndex={reading.initialIndex}
        text={reading.text}
        stopSignal={queuePlayback.stopSignal}
        onProgress={(i) => patchDocument(reading.id, { progressIndex: i })}
        onVoiceChange={(v) => patchDocument(reading.id, { voice: v })}
        onTextSave={(t) => setReading((r) => (r ? { ...r, text: t } : r))}
        onTitleSave={(t) => setReading((r) => (r ? { ...r, title: t } : r))}
        onClose={() => {
          queuePlayback.close();
          setReading(null);
        }}
      />
    );
  }

  return (
    <main
      className={`mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-16 ${
        queuePlayback.queue ? "pb-28" : ""
      }`}
    >
      <header className="space-y-3 border-b border-zinc-100 pb-6 dark:border-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {/* The heading beside it already names the page, so the mark is
                decorative and stays out of the accessibility tree. */}
            <Image src="/icon.png" alt="" width={36} height={36} priority className="mt-0.5 h-9 w-9 shrink-0" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Library</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Everything you have read or converted. Open an entry to continue
                reading where you left off.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {documents && documents.length > 0 && (
              <>
                <button
                  onClick={playAllOrSelected}
                  className={`rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 hover:shadow ${FOCUS_RING}`}
                >
                  Play all
                </button>
                <button
                  onClick={toggleSelectMode}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    selectMode
                      ? "bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  } ${FOCUS_RING}`}
                >
                  {selectMode ? "Cancel" : "Select"}
                </button>
              </>
            )}
            <Link
              href="/"
              className={`rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
            >
              New document
            </Link>
          </div>
        </div>
      </header>

      <StorageBar
        onImported={() => setRefreshKey((k) => k + 1)}
        onError={setError}
      />

      {documents && documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-zinc-50 px-4 py-2.5 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={queuePlayback.loopQueue}
              onChange={(e) => queuePlayback.setLoopQueue(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Loop playback
          </label>
          <label className="flex items-center gap-1.5">
            Auto-stop
            <select
              value={queuePlayback.autoStopMinutes}
              onChange={(e) => queuePlayback.setAutoStopMinutes(Number(e.target.value))}
              aria-label="Auto-stop playback after"
              className={`rounded-md border border-zinc-300 bg-transparent px-1.5 py-1 outline-none dark:border-zinc-700 dark:bg-zinc-900 ${FOCUS_RING}`}
            >
              {AUTO_STOP_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Off" : `${m} min`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        type={type}
        onTypeChange={setType}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        sort={sort}
        onSortChange={setSort}
        tag={tag}
        onClearTag={() => setTag("")}
      />

      {selectMode && documents && documents.length > 0 && (
        <SelectionToolbar
          total={documents.length}
          selectedCount={selectedIds.size}
          bulkBusy={bulkBusy}
          onToggleSelectAll={toggleSelectAll}
          onPlaySelected={playSelected}
          onMergeSelected={openMergeDialog}
          onDeleteSelected={requestDeleteSelected}
        />
      )}

      <ErrorBanner message={error} />

      {documents === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : documents.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
          <p className="font-medium">
            {query || type || tag || category ? "Nothing matches the filters" : "Your library is empty"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
            Documents, pasted text, and web links appear here once you read or
            convert them.
          </p>
        </div>
      ) : (
        <>
          <datalist id="category-suggestions">
            {categories.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                editing={editingId === doc.id}
                selectMode={selectMode}
                selected={selectedIds.has(doc.id)}
                busy={busyId === doc.id}
                anyBusy={busyId !== null}
                expanded={expandedId === doc.id}
                onOpen={queuePlayback.openSingle}
                onToggleSelected={toggleSelected}
                onCategoryClick={setCategory}
                onTagClick={setTag}
                onToggleSummary={toggleSummary}
                aiEnabled={aiEnabled}
                onDownload={download}
                onStartEdit={(d) => setEditingId(d.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={saveEdit}
                onDelete={requestDelete}
              />
            ))}
          </ul>
        </>
      )}

      {mergeOrder && (
        <MergeDialog
          order={mergeOrder}
          title={mergeTitle}
          busy={mergeBusy}
          onTitleChange={setMergeTitle}
          onMove={moveMergeItem}
          onReorder={reorderMergeItem}
          onCancel={() => setMergeOrder(null)}
          onConfirm={confirmMerge}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          titles={deleteTarget.titles}
          busy={bulkBusy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

      {queuePlayback.queue && (
        <MiniPlayerBar
          queue={queuePlayback.queue}
          queueIndex={queuePlayback.queueIndex}
          loopQueue={queuePlayback.loopQueue}
          onEnded={queuePlayback.handleEnded}
          onNext={queuePlayback.skipNext}
          onPrev={queuePlayback.skipPrev}
          onStop={queuePlayback.stopQueue}
        />
      )}
    </main>
  );
}
