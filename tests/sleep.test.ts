import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLEEP_FADE_MS,
  deadlineAfterMinutes,
  deadlineAtClock,
  fadeVolume,
  formatCountdown,
  nextChapterStart,
} from "@/lib/shared";

test("a duration becomes a deadline that many minutes out", () => {
  assert.equal(deadlineAfterMinutes(15, 1_000), 1_000 + 15 * 60_000);
});

test("nonsense durations are refused rather than firing at once", () => {
  for (const minutes of [0, -5, NaN, Infinity, 13 * 60]) {
    assert.equal(deadlineAfterMinutes(minutes, 0), null, `accepted ${minutes}`);
  }
});

test("a clock time later today stops today", () => {
  const now = new Date(2026, 9, 1, 22, 15);
  assert.equal(deadlineAtClock("23:30", now), new Date(2026, 9, 1, 23, 30).getTime());
});

test("a clock time already past stops tomorrow", () => {
  const now = new Date(2026, 9, 1, 23, 45);
  assert.equal(deadlineAtClock("00:30", now), new Date(2026, 9, 2, 0, 30).getTime());
  // The current minute itself counts as past: it would fire immediately.
  assert.equal(deadlineAtClock("23:45", now), new Date(2026, 9, 2, 23, 45).getTime());
});

test("malformed clock times are refused", () => {
  for (const time of ["", "7pm", "24:00", "12:60", "12"]) {
    assert.equal(deadlineAtClock(time), null, `accepted ${time}`);
  }
});

test("volume is full until the fade window, then ramps to silence", () => {
  assert.equal(fadeVolume(SLEEP_FADE_MS * 2), 1);
  assert.equal(fadeVolume(SLEEP_FADE_MS), 1);
  assert.equal(fadeVolume(SLEEP_FADE_MS / 2), 0.5);
  assert.equal(fadeVolume(0), 0);
  assert.equal(fadeVolume(-10), 0);
});

test("the countdown rounds up and grows an hours field", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(1), "0:01");
  assert.equal(formatCountdown(245_000), "4:05");
  assert.equal(formatCountdown(3_729_000), "1:02:09");
});

test("end of chapter is the next chapter's first sentence", () => {
  const starts = [0, 10, 25];
  assert.equal(nextChapterStart(starts, 0, 40), 10);
  assert.equal(nextChapterStart(starts, 9, 40), 10);
  assert.equal(nextChapterStart(starts, 10, 40), 25);
  // In the last chapter (or with none detected) it is the end of the document.
  assert.equal(nextChapterStart(starts, 30, 40), 40);
  assert.equal(nextChapterStart([], 5, 40), 40);
});
