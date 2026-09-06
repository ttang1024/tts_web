"use client";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

type Props = {
  total: number;
  selectedCount: number;
  bulkBusy: boolean;
  onToggleSelectAll: () => void;
  onPlaySelected: () => void;
  onMergeSelected: () => void;
  onDeleteSelected: () => void;
};

export default function SelectionToolbar({
  total,
  selectedCount,
  bulkBusy,
  onToggleSelectAll,
  onPlaySelected,
  onMergeSelected,
  onDeleteSelected,
}: Props) {
  return (
    <div className="sticky top-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-2.5 text-sm shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <button
        onClick={onToggleSelectAll}
        className={`font-medium text-blue-600 hover:underline dark:text-blue-400 ${FOCUS_RING}`}
      >
        {selectedCount === total ? "Deselect all" : "Select all"}
      </button>
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {selectedCount} selected
      </span>
      <button
        onClick={onPlaySelected}
        disabled={selectedCount === 0}
        className={`rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        Play selected
      </button>
      <button
        onClick={onMergeSelected}
        disabled={selectedCount < 2}
        title={selectedCount < 2 ? "Select at least two documents to merge" : undefined}
        className={`rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        Merge selected
      </button>
      <button
        onClick={onDeleteSelected}
        disabled={selectedCount === 0 || bulkBusy}
        className={`ml-auto rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        {bulkBusy ? "Deleting…" : "Delete selected"}
      </button>
    </div>
  );
}
