// Pure helpers behind the sleep timer (app/reader/useSleepTimer.ts): when it
// should fire, how loud the last stretch before it should be, and how the
// countdown reads. No React or DOM here, so the arithmetic can be tested.

export const SLEEP_PRESETS = [5, 15, 30, 45, 60, 90];
// Longest custom duration accepted — anything past this is a typo, not a nap.
export const SLEEP_MAX_MINUTES = 12 * 60;
// How long before the deadline the volume starts ramping down, so the voice
// trails off instead of cutting out mid-word.
export const SLEEP_FADE_MS = 30_000;

export function deadlineAfterMinutes(minutes: number, now: number = Date.now()): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > SLEEP_MAX_MINUTES) return null;
  return now + Math.round(minutes * 60_000);
}

// The next time the wall clock reads `time` ("HH:MM", as an <input
// type="time"> gives it): later today, or tomorrow if that has already passed.
export function deadlineAtClock(time: string, now: Date = new Date()): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

// Volume factor for the time left before the deadline: full until the fade
// window, then a straight ramp to silence.
export function fadeVolume(remainingMs: number): number {
  if (remainingMs >= SLEEP_FADE_MS) return 1;
  if (remainingMs <= 0) return 0;
  return remainingMs / SLEEP_FADE_MS;
}

// "4:05" or "1:02:09". Rounds up, so the display never shows 0:00 while
// there is still time left.
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// The first sentence of the chapter after the one `current` is in, given each
// chapter's starting sentence index — i.e. where "stop at the end of this
// chapter" should stop. The document's length when `current` is in the last
// chapter (or there are none).
export function nextChapterStart(starts: number[], current: number, flatLength: number): number {
  let next = flatLength;
  for (const start of starts) {
    if (start > current && start < next) next = start;
  }
  return next;
}
