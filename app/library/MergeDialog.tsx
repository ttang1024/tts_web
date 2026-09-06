"use client";

import { useState } from "react";
import { GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import type { DocumentSummary } from "@/lib/documents";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

type Props = {
  order: DocumentSummary[];
  title: string;
  busy: boolean;
  onTitleChange: (title: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function MergeDialog({
  order,
  title,
  busy,
  onTitleChange,
  onMove,
  onReorder,
  onCancel,
  onConfirm,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function handleDrop(index: number) {
    if (dragIndex !== null && dragIndex !== index) {
      onReorder(dragIndex, index);
    }
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold">Merge {order.length} documents</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Drag to reorder the documents, then confirm.
        </p>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Title for the merged document"
          aria-label="Merged document title"
          className={`mt-4 w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 ${FOCUS_RING}`}
        />
        <ol className="mt-4 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {order.map((doc, i) => (
            <li
              key={doc.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null) setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(i);
              }}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                dragIndex === i
                  ? "border-blue-400 bg-blue-50/50 dark:border-blue-600 dark:bg-blue-950/30"
                  : overIndex === i
                    ? "border-blue-300 dark:border-blue-700"
                    : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <span
                draggable={!busy}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragIndex(i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                aria-label={`Drag to reorder ${doc.title}`}
                className="shrink-0 cursor-grab select-none px-0.5 text-zinc-400 active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" />
              </span>
              <span className="w-5 shrink-0 text-center text-xs text-zinc-400">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={doc.title}>
                {doc.title}
              </span>
              <button
                onClick={() => onMove(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${doc.title} up`}
                className={`rounded px-1 py-0.5 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => onMove(i, 1)}
                disabled={i === order.length - 1}
                aria-label={`Move ${doc.title} down`}
                className={`rounded px-1 py-0.5 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
