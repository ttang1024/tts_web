"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, Upload, Trash2 } from "lucide-react";
import { downloadBlob } from "@/lib/tts";
import { exportLibrary, importLibrary } from "@/lib/backup";
import {
  audioCacheCount,
  clearAudioCache,
  formatBytes,
  storageEstimate,
} from "@/lib/audioCache";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";
const BUTTON =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-zinc-600 transition hover:bg-zinc-200 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-700";

// The library, its bookmarks, reading positions, and every sentence of audio
// already synthesized all live in this browser and nowhere else. This row is
// where that becomes visible and manageable: back the library up to a file,
// merge one back in (from another browser, or after clearing site data), see
// what the cache is costing, and drop it.
export default function StorageBar({
  onImported,
  onError,
}: {
  onImported: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"export" | "import" | "clear" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cached, setCached] = useState(0);
  const [usage, setUsage] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshUsage = useCallback(() => {
    void audioCacheCount().then(setCached);
    void storageEstimate().then((e) => setUsage(e?.usage ?? null));
  }, []);
  useEffect(refreshUsage, [refreshUsage]);

  async function exportAll() {
    setBusy("export");
    setStatus(null);
    try {
      const { blob, filename } = await exportLibrary();
      downloadBlob(blob, filename);
      setStatus(`Saved ${filename}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    setBusy("import");
    setStatus(null);
    try {
      const result = await importLibrary(file);
      const parts = [
        `${result.documentsAdded} added`,
        `${result.documentsMerged} already here`,
      ];
      if (result.bookmarksAdded) parts.push(`${result.bookmarksAdded} bookmarks`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      setStatus(`Imported: ${parts.join(", ")}.`);
      onImported();
      refreshUsage();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function clearCache() {
    setBusy("clear");
    setStatus(null);
    try {
      await clearAudioCache();
      setStatus("Cached audio cleared.");
      refreshUsage();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't clear the cache.");
    } finally {
      setBusy(null);
    }
  }

  const Spinner = <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-zinc-50 px-4 py-2.5 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">
        This browser
      </span>

      <button
        onClick={exportAll}
        disabled={busy !== null}
        className={`${BUTTON} ${FOCUS_RING}`}
      >
        {busy === "export" ? Spinner : <Download className="h-3.5 w-3.5" aria-hidden />}
        Export backup
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className={`${BUTTON} ${FOCUS_RING}`}
      >
        {busy === "import" ? Spinner : <Upload className="h-3.5 w-3.5" aria-hidden />}
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input so re-picking the same file fires change again.
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />

      {cached > 0 && (
        <button
          onClick={clearCache}
          disabled={busy !== null}
          title="Sentences you have already heard replay from here instead of being synthesized again."
          className={`${BUTTON} ${FOCUS_RING}`}
        >
          {busy === "clear" ? Spinner : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          Clear {cached.toLocaleString()} cached sentences
        </button>
      )}

      {usage !== null && <span>{formatBytes(usage)} stored</span>}
      {status && <span className="text-zinc-600 dark:text-zinc-300">{status}</span>}
    </div>
  );
}
