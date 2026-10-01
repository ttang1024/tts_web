import { useEffect, useRef, useState } from "react";
import {
  SLEEP_FADE_MS,
  deadlineAfterMinutes,
  deadlineAtClock,
  fadeVolume,
} from "@/lib/shared";

// Where a boundary-mode timer stops: after the last sentence of the current
// chapter, or of the current document.
export type SleepBoundary = "chapter" | "document";

export type SleepMode =
  | { kind: "off" }
  // A wall-clock deadline — set either as "N minutes from now" or "at HH:MM".
  // It keeps counting while paused, like a phone's sleep timer.
  | { kind: "deadline"; deadline: number }
  | { kind: "boundary"; boundary: SleepBoundary };

// How often the deadline is checked. Fine enough for a smooth fade; the
// countdown state itself only changes once a second (see below), so this
// doesn't re-render the reader four times a second.
const TICK_MS = 250;

// Stops playback at a chosen time, or at the end of the current chapter or
// document. Shared by the Reader (one document) and the library's mini player
// (where it spans the whole queue, since the bar outlives each document).
//
// A deadline fades the volume out over its last SLEEP_FADE_MS through
// `setVolume`; iOS Safari ignores <audio>.volume, so there it just stops.
// Boundary modes stop between sentences, which is already a clean break —
// the caller checks `boundary` before advancing and calls `cancel()` once
// it has stopped there.
export function useSleepTimer(playing: boolean, stop: () => void, setVolume: (v: number) => void) {
  const [mode, setMode] = useState<SleepMode>({ kind: "off" });
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Read through a ref so the tick effect depends only on the deadline, not
  // on the identity of callbacks the caller recreates every render.
  const latest = useRef({ playing, stop, setVolume });
  latest.current = { playing, stop, setVolume };

  const deadline = mode.kind === "deadline" ? mode.deadline : null;

  useEffect(() => {
    if (deadline === null) return;
    let faded = false;
    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // Only stop what is actually playing — a deadline that passes while
        // paused simply expires.
        if (latest.current.playing) latest.current.stop();
        latest.current.setVolume(1);
        setMode({ kind: "off" });
        return;
      }
      setRemainingSeconds(Math.ceil(remaining / 1000));
      if (remaining < SLEEP_FADE_MS) {
        latest.current.setVolume(fadeVolume(remaining));
        faded = true;
      }
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      // Cancelled or replaced mid-fade: don't leave the next listen quiet.
      if (faded) latest.current.setVolume(1);
    };
  }, [deadline]);

  function setMinutes(minutes: number): boolean {
    const next = deadlineAfterMinutes(minutes);
    if (next === null) return false;
    setMode({ kind: "deadline", deadline: next });
    return true;
  }

  function setClock(time: string): boolean {
    const next = deadlineAtClock(time);
    if (next === null) return false;
    setMode({ kind: "deadline", deadline: next });
    return true;
  }

  function setBoundary(boundary: SleepBoundary) {
    setMode({ kind: "boundary", boundary });
  }

  function cancel() {
    setMode({ kind: "off" });
  }

  return {
    mode,
    // Seconds left on a deadline timer; meaningless in other modes.
    remainingSeconds,
    boundary: mode.kind === "boundary" ? mode.boundary : null,
    setMinutes,
    setClock,
    setBoundary,
    cancel,
  };
}

export type SleepTimer = ReturnType<typeof useSleepTimer>;
