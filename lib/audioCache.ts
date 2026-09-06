// ---------------------------------------------------------------------------
// Persistent cache for synthesized sentence audio.
//
// Every sentence the reader plays costs a round trip to /api/tts, which opens a
// websocket to Edge's voice service and waits for the whole snippet. The
// PlaybackController caches what it fetched, but only for the life of one open
// document: re-opening a book, resuming it tomorrow, or hearing the same
// sentence again from the library's mini player all paid for it a second time.
//
// This keeps the MP3 bytes and their word timings in IndexedDB, keyed by a hash
// of voice + text, so a sentence is synthesized once per voice and then replays
// instantly — offline included. It is a cache, never a source of truth: every
// operation fails soft (private browsing, a full quota, storage disabled) and
// the caller just goes to the network as it did before.
// ---------------------------------------------------------------------------

import { AUDIO, clear, count, del, eachKey, get, hashText, put, tx } from "@/lib/idb";
import type { WordTiming } from "@/lib/tts";

// Roughly 60 MB at the 24 kHz / 96 kbps mono MP3s the route returns (~50 KB for
// an average sentence) — enough for several books, small enough to sit politely
// inside a browser's default origin quota.
const MAX_ENTRIES = 1200;
// Multi-chunk "sentences" (a whole unpunctuated page, say) are rare and large,
// and they come back without usable word timings anyway. Don't spend the quota.
const MAX_ENTRY_BYTES = 2_000_000;
// Rewriting `used_at` on every hit would turn every replay into a write; a
// coarse timestamp is enough to order eviction.
const TOUCH_AFTER_MS = 6 * 60 * 60 * 1000;

type AudioRecord = {
  key: string;
  mp3: ArrayBuffer;
  words: WordTiming[];
  used_at: number;
};

export type CachedAudio = { mp3: Uint8Array<ArrayBuffer>; words: WordTiming[] };

function cacheKey(voice: string, text: string): Promise<string> {
  return hashText(`${voice} ${text}`);
}

export async function readCachedAudio(
  voice: string,
  text: string
): Promise<CachedAudio | null> {
  try {
    const key = await cacheKey(voice, text);
    const record = await tx(AUDIO, "readonly", (t) =>
      get<AudioRecord>(t.objectStore(AUDIO), key)
    );
    if (!record) return null;
    const now = Date.now();
    if (now - record.used_at > TOUCH_AFTER_MS) {
      void tx(AUDIO, "readwrite", (t) =>
        put(t.objectStore(AUDIO), { ...record, used_at: now })
      ).catch(() => {});
    }
    return { mp3: new Uint8Array(record.mp3), words: record.words ?? [] };
  } catch {
    return null;
  }
}

export async function writeCachedAudio(
  voice: string,
  text: string,
  mp3: Uint8Array<ArrayBuffer>,
  words: WordTiming[]
): Promise<void> {
  if (mp3.length === 0 || mp3.length > MAX_ENTRY_BYTES) return;
  try {
    const key = await cacheKey(voice, text);
    // slice() both detaches the view from any larger buffer and gives IndexedDB
    // an exact-size ArrayBuffer to clone.
    const record: AudioRecord = {
      key,
      mp3: mp3.slice().buffer,
      words,
      used_at: Date.now(),
    };
    await tx(AUDIO, "readwrite", (t) => put(t.objectStore(AUDIO), record));
    await evict();
  } catch {
    // A failed write just means the next play re-synthesizes.
  }
}

// Drops the least recently used entries once the store outgrows its budget.
// Walks the `used_at` index by key only, so no MP3 payload is deserialized.
async function evict(): Promise<void> {
  await tx(AUDIO, "readwrite", async (t) => {
    const store = t.objectStore(AUDIO);
    let over = (await count(store)) - MAX_ENTRIES;
    if (over <= 0) return;
    // Trim a little past the limit so this doesn't run again on every write.
    over += Math.floor(MAX_ENTRIES * 0.1);
    const doomed: IDBValidKey[] = [];
    await eachKey(store.index("used_at"), (key) => {
      doomed.push(key);
      return doomed.length < over;
    });
    for (const key of doomed) await del(store, key);
  });
}

export async function audioCacheCount(): Promise<number> {
  try {
    return await tx(AUDIO, "readonly", (t) => count(t.objectStore(AUDIO)));
  } catch {
    return 0;
  }
}

export async function clearAudioCache(): Promise<void> {
  await tx(AUDIO, "readwrite", (t) => clear(t.objectStore(AUDIO)));
}

// How much disk the whole origin (library + cached audio) is using, when the
// browser is willing to say. Both numbers are approximate by design.
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number") return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
