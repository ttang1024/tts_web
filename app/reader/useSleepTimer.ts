import { useEffect, useRef, useState } from "react";

// Stops playback when a chosen deadline passes. Distinct from the library's
// queue-wide auto-stop timer (see web/app/library/useQueuePlayback.ts): this
// one is per-document and reschedules with a fresh document.
export function useSleepTimer(playing: boolean, stop: () => void) {
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const sleepDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || sleepDeadlineRef.current === null) return;
    const remaining = sleepDeadlineRef.current - Date.now();
    if (remaining <= 0) {
      stop();
      setSleepMinutes(0);
      sleepDeadlineRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      stop();
      setSleepMinutes(0);
      sleepDeadlineRef.current = null;
    }, remaining);
    return () => clearTimeout(timer);
    // `stop` only proxies to the Reader's stable controllerRef, so omitting
    // it doesn't go stale — matches the pattern used by useMediaSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sleepMinutes]);

  function setSleep(minutes: number) {
    setSleepMinutes(minutes);
    sleepDeadlineRef.current = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  }

  return { sleepMinutes, setSleep };
}
