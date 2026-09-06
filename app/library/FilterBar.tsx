"use client";

import { UNCATEGORIZED, type ListFilters } from "@/lib/documents";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";
const SORT_OPTIONS = [
  { id: "recent", label: "Recently read" },
  { id: "created", label: "Date added" },
  { id: "title", label: "Title" },
  { id: "progress", label: "Progress" },
] as const;

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  type: ListFilters["type"] | "";
  onTypeChange: (t: ListFilters["type"] | "") => void;
  category: string;
  onCategoryChange: (c: string) => void;
  categories: { name: string; count: number }[];
  sort: NonNullable<ListFilters["sort"]>;
  onSortChange: (s: NonNullable<ListFilters["sort"]>) => void;
  tag: string;
  onClearTag: () => void;
};

export default function FilterBar({
  query,
  onQueryChange,
  type,
  onTypeChange,
  category,
  onCategoryChange,
  categories,
  sort,
  onSortChange,
  tag,
  onClearTag,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full min-w-48 sm:w-auto sm:flex-1">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search titles and full text…"
          className={`w-full rounded-xl border border-zinc-300 bg-transparent py-2 px-3 text-sm outline-none transition focus:border-blue-500 dark:border-zinc-700 ${FOCUS_RING}`}
        />
      </div>
      <select
        value={type}
        onChange={(e) => onTypeChange(e.target.value as ListFilters["type"] | "")}
        aria-label="Filter by source"
        className={`rounded-xl border border-zinc-300 bg-transparent px-2.5 py-2 text-sm outline-none transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 ${FOCUS_RING}`}
      >
        <option value="">All sources</option>
        <option value="file">Documents</option>
        <option value="text">Pasted text</option>
        <option value="url">Web links</option>
      </select>
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        aria-label="Filter by category"
        className={`rounded-xl border border-zinc-300 bg-transparent px-2.5 py-2 text-sm outline-none transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 ${FOCUS_RING}`}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count})
          </option>
        ))}
        <option value={UNCATEGORIZED}>Uncategorized</option>
      </select>
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as NonNullable<ListFilters["sort"]>)}
        aria-label="Sort by"
        className={`rounded-xl border border-zinc-300 bg-transparent px-2.5 py-2 text-sm outline-none transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 ${FOCUS_RING}`}
      >
        {SORT_OPTIONS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {tag && (
        <button
          onClick={onClearTag}
          className={`rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-300 ${FOCUS_RING}`}
        >
          #{tag} ×
        </button>
      )}
    </div>
  );
}
