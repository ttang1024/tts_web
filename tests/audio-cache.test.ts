import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  audioCacheCount,
  clearAudioCache,
  formatBytes,
  readCachedAudio,
  storageEstimate,
  writeCachedAudio,
} from "@/lib/audioCache";

const VOICE = "en-US-AriaNeural";
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x05]);
const WORDS = [{ text: "Hello", start: 0, end: 0.4 }];

test("audio written to the cache reads back byte for byte", async () => {
  await writeCachedAudio(VOICE, "Hello there.", MP3, WORDS);
  const hit = await readCachedAudio(VOICE, "Hello there.");
  assert.ok(hit);
  assert.deepEqual([...hit.mp3], [...MP3]);
  assert.deepEqual(hit.words, WORDS);
});

test("the key covers both the voice and the text", async () => {
  assert.equal(await readCachedAudio("en-GB-RyanNeural", "Hello there."), null);
  assert.equal(await readCachedAudio(VOICE, "Hello there!"), null);
});

test("a miss is null rather than an error", async () => {
  assert.equal(await readCachedAudio(VOICE, "Never synthesized."), null);
});

test("empty audio is not cached", async () => {
  // Caching a failed synthesis would serve a permanent silent gap.
  await writeCachedAudio(VOICE, "Silent.", new Uint8Array(), []);
  assert.equal(await readCachedAudio(VOICE, "Silent."), null);
});

test("an entry too large for the budget is skipped", async () => {
  const huge = new Uint8Array(2_000_001);
  await writeCachedAudio(VOICE, "A very long sentence.", huge, []);
  assert.equal(await readCachedAudio(VOICE, "A very long sentence."), null);
});

test("the cache evicts the least recently used entries at its cap", async () => {
  for (let i = 0; i < 1400; i++) {
    await writeCachedAudio(VOICE, `sentence number ${i}.`, MP3, []);
  }
  const size = await audioCacheCount();
  assert.ok(size <= 1200, `expected the cap to hold, got ${size}`);
  assert.ok(size > 900, `expected it not to over-trim, got ${size}`);

  assert.equal(await readCachedAudio(VOICE, "Hello there."), null, "the oldest entry went");
  assert.ok(await readCachedAudio(VOICE, "sentence number 1399."), "the newest stayed");
});

test("clearing empties the cache", async () => {
  await clearAudioCache();
  assert.equal(await audioCacheCount(), 0);
});

test("a browser that won't report storage use isn't an error", async () => {
  // Node has no navigator.storage, which is the same shape as a browser that
  // withholds the estimate.
  assert.equal(await storageEstimate(), null);
});

test("byte sizes are formatted the way a person reads them", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(15 * 1024 * 1024), "15 MB");
  assert.equal(formatBytes(3.5 * 1024 * 1024 * 1024), "3.5 GB");
});
