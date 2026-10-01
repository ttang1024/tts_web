"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Timer, X } from "lucide-react";
import { SLEEP_FADE_MS, SLEEP_MAX_MINUTES, SLEEP_PRESETS, formatCountdown } from "@/lib/shared";
import type { SleepBoundary, SleepTimer } from "./useSleepTimer";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";
const CHIP =
  "rounded-md border border-zinc-300 px-2 py-1 transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
const INPUT =
  "min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900";

const BOUNDARY_SHORT: Record<SleepBoundary, string> = {
  chapter: "Ch. end",
  document: "Doc end",
};

export type SleepBoundaryOption = { boundary: SleepBoundary; label: string };

type Props = {
  sleep: SleepTimer;
  // Which "stop at the end of…" options this player can honour, with their
  // labels — the Reader knows about chapters, the mini player only documents.
  boundaries: SleepBoundaryOption[];
  // Which way the popover opens: down from the Reader's top toolbar, up from
  // the library's bottom bar.
  placement: "below" | "above";
};

// One input plus a Set button; `onSet` returns whether the value was accepted,
// so a rejected one leaves the panel open to correct it.
function SetForm({
  label,
  onSet,
  ...input
}: { label?: string; onSet: (value: string) => boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSet(value);
      }}
    >
      {label && <span className="shrink-0 text-zinc-500">{label}</span>}
      <input
        {...input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${INPUT} ${FOCUS_RING}`}
      />
      <button type="submit" disabled={!value} className={`${CHIP} ${FOCUS_RING} disabled:opacity-40`}>
        Set
      </button>
    </form>
  );
}

// Toolbar button for the sleep timer: shows the countdown (or which boundary
// it will stop at) while one is set, and opens a small panel to set it.
export default function SleepTimerButton({ sleep, boundaries, placement }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { mode } = sleep;
  const active = mode.kind !== "off";
  let badge: string | null = null;
  let status = "Off";
  if (mode.kind === "deadline") {
    badge = formatCountdown(sleep.remainingSeconds * 1000);
    const at = new Date(mode.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    status = `Stops in ${badge} at ${at}`;
  } else if (mode.kind === "boundary") {
    badge = BOUNDARY_SHORT[mode.boundary];
    const label = boundaries.find((b) => b.boundary === mode.boundary)?.label ?? "End";
    status = `Stops at the ${label.toLowerCase()}`;
  }

  // Closes the panel when `ok` — a setter that rejected its input leaves it open.
  function close(ok = true): boolean {
    if (ok) setOpen(false);
    return ok;
  }

  return (
    // Only positioned from sm up: on phones the panel anchors to the
    // enclosing toolbar/bar instead (both are positioned), spanning its width,
    // since the button's spot in a wrapping row can be anywhere.
    <div ref={rootRef} className="sm:relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={active ? `Sleep timer: ${status}` : "Sleep timer"}
        aria-expanded={open}
        title="Sleep timer"
        className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${active ? "text-blue-600 dark:text-blue-400" : ""
          } ${open ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
      >
        <Timer className="h-4 w-4" />
        {badge && <span className="text-xs tabular-nums">{badge}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sleep timer"
          className={`absolute inset-x-4 z-50 space-y-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-0 sm:w-72 ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"
            }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Sleep timer</span>
            <span className="truncate text-zinc-500" aria-live="polite">
              {status}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SLEEP_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => close(sleep.setMinutes(m))}
                className={`${CHIP} ${FOCUS_RING}`}
              >
                {m} min
              </button>
            ))}
          </div>

          <SetForm
            type="number"
            inputMode="numeric"
            min={1}
            max={SLEEP_MAX_MINUTES}
            placeholder="Minutes"
            aria-label="Custom minutes"
            onSet={(v) => close(sleep.setMinutes(Number(v)))}
          />
          <SetForm
            label="Stop at"
            type="time"
            aria-label="Stop at time"
            onSet={(v) => close(sleep.setClock(v))}
          />

          {boundaries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {boundaries.map(({ boundary, label }) => (
                <button
                  key={boundary}
                  onClick={() => {
                    sleep.setBoundary(boundary);
                    close();
                  }}
                  aria-pressed={mode.kind === "boundary" && mode.boundary === boundary}
                  className={`${CHIP} ${FOCUS_RING} aria-pressed:bg-zinc-900 aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-zinc-900`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <span className="text-zinc-400">
              Timed stops fade out over the last {SLEEP_FADE_MS / 1000} s.
            </span>
            {active && (
              <button
                onClick={() => {
                  sleep.cancel();
                  close();
                }}
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <X className="h-3.5 w-3.5" />
                Turn off
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
