"use client";

import { useEffect, useRef, useState } from "react";
import { estimateListeningSeconds, formatDuration } from "@/lib/shared";
import type { DocumentSummary } from "@/lib/documents";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";
const SOURCE_LABELS = { file: "Document", text: "Pasted text", url: "Web link" };

// Stable color per category name, picked from a small rotating palette so
// badges stay visually distinct without any per-category configuration.
const CATEGORY_COLORS = [
  "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  "bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
  "bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
];

function categoryColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tagList(doc: DocumentSummary): string[] {
  return doc.tags ? doc.tags.split(",").filter(Boolean) : [];
}

type Props = {
  doc: DocumentSummary;
  editing: boolean;
  selectMode: boolean;
  selected: boolean;
  busy: boolean;
  // Disables opening any other row while one is loading; this row alone
  // shows "Working…" when it's the one busy.
  anyBusy: boolean;
  expanded: boolean;
  onOpen: (doc: DocumentSummary) => void;
  onToggleSelected: (id: number) => void;
  onCategoryClick: (name: string) => void;
  onTagClick: (tag: string) => void;
  onToggleSummary: (doc: DocumentSummary) => void;
  // Whether the deployment has an Anthropic key configured. Without one there
  // is nothing to generate, so the button only shows an existing summary.
  aiEnabled: boolean;
  onStartEdit: (doc: DocumentSummary) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number, patch: { title: string; tags: string; category: string }) => void;
  onDelete: (id: number) => void;
  // Renders the document to MP3; resolves when the download has started (or
  // failed), so the row can show progress for what is a slow operation. The
  // row supplies the signal that cancels it and the callback it reports
  // progress through.
  onDownload: (
    doc: DocumentSummary,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void }
  ) => Promise<void>;
};

export default function DocumentRow({
  doc,
  editing,
  selectMode,
  selected,
  busy,
  anyBusy,
  expanded,
  onOpen,
  onToggleSelected,
  onCategoryClick,
  onTagClick,
  onToggleSummary,
  aiEnabled,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onDownload,
}: Props) {
  // Null when idle, otherwise how far the render has got, as a percentage.
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const downloading = downloadPercent !== null;
  const [draftTitle, setDraftTitle] = useState(doc.title);
  const [draftTags, setDraftTags] = useState(tagList(doc).join(", "));
  const [draftCategory, setDraftCategory] = useState(doc.category ?? "");

  useEffect(() => () => downloadAbortRef.current?.abort(), []);

  function startEdit() {
    setDraftTitle(doc.title);
    setDraftTags(tagList(doc).join(", "));
    setDraftCategory(doc.category ?? "");
    onStartEdit(doc);
  }

  const progress =
    doc.sentence_count > 0 ? Math.min((doc.progress_index + 1) / doc.sentence_count, 1) : 0;

  return (
    <li
      className={`rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${
        selected
          ? "border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            aria-label="Title"
            className="rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
          />
          <input
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            aria-label="Tags"
            placeholder="Tags, comma separated"
            className="rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
          />
          <input
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value)}
            list="category-suggestions"
            aria-label="Category"
            placeholder="Category (leave blank for none)"
            className="rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                onSaveEdit(doc.id, { title: draftTitle, tags: draftTags, category: draftCategory })
              }
              className={`rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 ${FOCUS_RING}`}
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className={`rounded-lg px-3 py-1.5 text-xs transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected(doc.id)}
              aria-label={`Select ${doc.title}`}
              className={`mt-1 h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-700 ${FOCUS_RING}`}
            />
          )}
          <button
            onClick={() => (selectMode ? onToggleSelected(doc.id) : onOpen(doc))}
            disabled={!selectMode && anyBusy}
            className={`min-w-0 flex-1 cursor-pointer text-left disabled:cursor-wait ${FOCUS_RING} rounded-lg`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium" title={doc.title}>
                {busy ? "Working…" : doc.title}
              </span>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {SOURCE_LABELS[doc.source_type]}
              </span>
              {doc.category && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryClick(doc.category!);
                  }}
                  className={`shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80 ${categoryColor(doc.category)}`}
                >
                  {doc.category}
                </span>
              )}
              {tagList(doc).map((t) => (
                <span
                  key={t}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(t);
                  }}
                  className="shrink-0 cursor-pointer rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 transition hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300"
                >
                  #{t}
                </span>
              ))}
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {formatDate(doc.updated_at)} · {doc.char_count.toLocaleString()} characters · ~
              {formatDuration(estimateListeningSeconds(doc.char_count, 1, doc.speech_rate))}
              {doc.source_type === "url" && doc.source ? ` · ${doc.source}` : ""}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                {doc.progress_index + 1} / {doc.sentence_count}
              </span>
            </div>
          </button>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <button
              onClick={async () => {
                // While it is rendering the same button cancels — a book can
                // take minutes, and there is nowhere else to put a second one.
                if (downloading) {
                  downloadAbortRef.current?.abort();
                  return;
                }
                const controller = new AbortController();
                downloadAbortRef.current = controller;
                setDownloadPercent(0);
                try {
                  await onDownload(doc, {
                    signal: controller.signal,
                    onProgress: (fraction) => setDownloadPercent(Math.round(fraction * 100)),
                  });
                } finally {
                  downloadAbortRef.current = null;
                  setDownloadPercent(null);
                }
              }}
              disabled={anyBusy && !downloading}
              className={`rounded-full px-2.5 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${FOCUS_RING}`}
              title={
                downloading ? "Cancel this render" : "Download as MP3 (synthesized on demand)"
              }
            >
              {downloading ? `Rendering ${downloadPercent}% · cancel` : "Download MP3"}
            </button>
            {(aiEnabled || doc.summary) && (
              <button
                onClick={() => onToggleSummary(doc)}
                disabled={anyBusy}
                className={`rounded-full px-2.5 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${FOCUS_RING}`}
              >
                {busy ? "…" : doc.summary ? (expanded ? "Hide summary" : "Summary") : "Summarize"}
              </button>
            )}
            <button
              onClick={startEdit}
              className={`rounded-full px-2.5 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${FOCUS_RING}`}
            >
              Rename / categorize
            </button>
            <button
              onClick={() => onDelete(doc.id)}
              aria-label={`Delete ${doc.title}`}
              className={`rounded-full px-2.5 py-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 ${FOCUS_RING}`}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {expanded && doc.summary && (
        <p className="mt-3 rounded-xl border-l-2 border-blue-400 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-blue-600 dark:bg-zinc-900 dark:text-zinc-300">
          {doc.summary}
        </p>
      )}
    </li>
  );
}
