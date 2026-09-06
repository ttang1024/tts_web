"use client";

import { SkipBack, SkipForward, Play, Pause, Square, Repeat, LoaderCircle } from "lucide-react";
import type { DocumentSummary } from "@/lib/documents";
import { useMiniPlayer } from "./useMiniPlayer";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

type Props = {
  queue: DocumentSummary[];
  queueIndex: number;
  loopQueue: boolean;
  onEnded: () => void;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
};

// Plays a Play all / Play selected queue inline on the library list, so
// starting playback doesn't navigate away to the full Reader.
export default function MiniPlayerBar({ queue, queueIndex, loopQueue, onEnded, onNext, onPrev, onStop }: Props) {
  const player = useMiniPlayer(queue, queueIndex, onEnded);
  const canPrev = queueIndex > 0 || loopQueue;
  const canNext = queueIndex < queue.length - 1 || loopQueue;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-1px_8px_rgba(0,0,0,0.04)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{player.title || "Loading…"}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            Queue {queueIndex + 1}/{queue.length}
            {player.total > 0 ? ` · Sentence ${player.current + 1}/${player.total}` : ""}
            {loopQueue && (
              <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
                · <Repeat className="inline h-3 w-3" /> Looping
              </span>
            )}
          </p>
          {player.error && <p className="truncate text-xs text-red-600 dark:text-red-400">{player.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous file"
            className={`rounded-full px-2.5 py-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={player.togglePlay}
            disabled={player.total === 0 && !player.loading}
            aria-label={player.playing ? "Pause" : "Play"}
            className={`rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-500 disabled:opacity-40 ${FOCUS_RING}`}
          >
            {player.loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : player.playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next file"
            className={`rounded-full px-2.5 py-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            onClick={onStop}
            aria-label="Stop queue"
            className={`rounded-full px-2.5 py-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            <Square className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
