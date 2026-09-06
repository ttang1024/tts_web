import { useEffect, useRef, useState } from "react";
import type { DocumentSummary } from "@/lib/documents";

export const AUTO_STOP_OPTIONS = [0, 15, 30, 60];

// Sequential/looped playback across several documents, plus a queue-spanning
// auto-stop timer (unlike the Reader's own per-document sleep timer, this
// isn't rescheduled as playback advances from one document to the next).
// `openDoc` is the caller's "load and start reading this single document"
// action, used only outside of a queue (see `openSingle`) — queue playback
// (`playAll`/`playSelected`) plays inline on the library list via
// MiniPlayerBar/useMiniPlayer instead, driven by `queue`/`queueIndex` alone.
export function useQueuePlayback(openDoc: (doc: DocumentSummary) => void) {
  const [queue, setQueue] = useState<DocumentSummary[] | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);
  const [loopQueue, setLoopQueue] = useState(false);
  const [autoStopMinutes, setAutoStopMinutes] = useState(0);
  const [stopSignal, setStopSignal] = useState(0);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAutoStop() {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }

  function scheduleAutoStop() {
    clearAutoStop();
    if (autoStopMinutes <= 0) return;
    autoStopTimerRef.current = setTimeout(() => {
      setStopSignal((s) => s + 1);
      setQueue(null);
    }, autoStopMinutes * 60_000);
  }

  useEffect(() => clearAutoStop, []);

  // Opens a single document outside of any queue — the normal "click a title
  // in the list" path.
  function openSingle(doc: DocumentSummary) {
    setQueue(null);
    scheduleAutoStop();
    openDoc(doc);
  }

  function playAll(documents: DocumentSummary[]) {
    if (documents.length === 0) return;
    setQueue(documents);
    setQueueIndex(0);
    scheduleAutoStop();
  }

  // Returns whether playback actually started, so the caller can decide
  // whether to clear its selection.
  function playSelected(documents: DocumentSummary[]): boolean {
    if (documents.length === 0) return false;
    setQueue(documents);
    setQueueIndex(0);
    scheduleAutoStop();
    return true;
  }

  // Advances to the next document in the active queue when one finishes
  // playing naturally; loops back to the start if looping is on. The index
  // change alone drives MiniPlayerBar to load and play the next document.
  function handleEnded() {
    if (!queue) return;
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex);
    } else if (loopQueue && queue.length > 0) {
      setQueueIndex(0);
    } else {
      setQueue(null);
    }
  }

  // Manual "next track" — jumps to the next document in the queue
  // regardless of where playback is within the current one. Distinct from
  // handleEnded, which only fires once a document finishes naturally.
  function skipNext() {
    if (!queue) return;
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) setQueueIndex(nextIndex);
    else if (loopQueue && queue.length > 0) setQueueIndex(0);
  }

  // Manual "previous track".
  function skipPrev() {
    if (!queue) return;
    const prevIndex = queueIndex - 1;
    if (prevIndex >= 0) setQueueIndex(prevIndex);
    else if (loopQueue && queue.length > 0) setQueueIndex(queue.length - 1);
  }

  function close() {
    clearAutoStop();
    setQueue(null);
  }

  return {
    queue,
    queueIndex,
    loopQueue,
    setLoopQueue,
    autoStopMinutes,
    setAutoStopMinutes,
    stopSignal,
    openSingle,
    playAll,
    playSelected,
    handleEnded,
    skipNext,
    skipPrev,
    stopQueue: () => setQueue(null),
    close,
  };
}
