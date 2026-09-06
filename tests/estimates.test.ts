import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateListeningSeconds,
  estimateMp3Bytes,
  estimateSpeechSeconds,
  formatDuration,
  speechRate,
} from "@/lib/shared";

const ENGLISH = "The quick brown fox jumps over the lazy dog, and keeps on running.";
const CHINESE = "这是一段中文文本，用来测试朗读速度的估算是否准确。";

test("alphabetic text is estimated at the alphabetic rate", () => {
  assert.equal(Math.round(speechRate(ENGLISH)), 15);
});

test("CJK text is estimated far slower per character", () => {
  assert.ok(speechRate(CHINESE) < 6, `got ${speechRate(CHINESE)}`);
});

test("mixed text lands between the two", () => {
  const mixed = speechRate(`${CHINESE} ${ENGLISH}`);
  assert.ok(mixed > speechRate(CHINESE) && mixed < speechRate(ENGLISH), `got ${mixed}`);
});

test("text with nothing to measure falls back instead of dividing by zero", () => {
  assert.equal(speechRate(""), 15);
  assert.equal(speechRate("   \n\n  "), 15);
});

test("the same character count is a much longer listen in Chinese", () => {
  // The bug this rate exists to fix: a Chinese book was being announced as a
  // 20-minute listen when it was closer to an hour.
  const latin = estimateListeningSeconds(3000, 1, speechRate(ENGLISH));
  const cjk = estimateListeningSeconds(3000, 1, speechRate(CHINESE));
  assert.ok(cjk > latin * 2, `${formatDuration(latin)} vs ${formatDuration(cjk)}`);
});

test("a caller that passes no rate gets the old behaviour", () => {
  assert.equal(estimateListeningSeconds(1500), 100);
});

test("speed divides the estimate", () => {
  assert.equal(estimateListeningSeconds(1500, 2), 50);
});

test("estimateSpeechSeconds uses the text's own rate", () => {
  assert.equal(estimateSpeechSeconds(CHINESE), CHINESE.length / speechRate(CHINESE));
});

test("an hour of speech is about 43 MB at 96 kbps", () => {
  // What turns "bytes received" into a progress bar for an export.
  const hour = estimateMp3Bytes("a".repeat(15 * 3600));
  assert.ok(Math.abs(hour - 43_200_000) < 1000, `got ${hour}`);
});

test("durations read the way a person would say them", () => {
  assert.equal(formatDuration(20), "<1 min");
  assert.equal(formatDuration(90), "2 min");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(3600 + 15 * 60), "1 h 15 min");
});
