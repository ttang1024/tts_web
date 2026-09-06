"use client";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

type Props = {
  titles: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteDialog({ titles, busy, onCancel, onConfirm }: Props) {
  const count = titles.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold">
          Delete {count} document{count > 1 ? "s" : ""}?
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">This cannot be undone.</p>
        <ul className="mt-4 flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {titles.map((title, i) => (
            <li
              key={i}
              title={title}
              className="shrink-0 truncate rounded-lg border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800"
            >
              {title}
            </li>
          ))}
        </ul>
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
            className={`rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
