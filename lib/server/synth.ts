import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Readable } from "stream";
import { createHash } from "crypto";
import { chunkText, segmentText } from "@/lib/shared";

const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;

// Long documents are split into chunks; synthesizing them over a single
// websocket is serial, so a few workers each open their own connection and
// pull chunks from a shared queue. Order is preserved by index.
const CHUNK_CONCURRENCY = 4;

export type WordTiming = { text: string; start: number; end: number };
export type AudioJob = { text: string; voice: string };

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on("data", (chunk) => parts.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", reject);
  });
}

// Edge word-boundary offsets are in 100-nanosecond ticks.
const TICKS_PER_SECOND = 10_000_000;

function parseWordTimings(metadataChunks: Buffer[]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const chunk of metadataChunks) {
    try {
      const parsed = JSON.parse(chunk.toString("utf-8"));
      for (const entry of parsed?.Metadata ?? []) {
        if (entry?.Type !== "WordBoundary") continue;
        const { Offset, Duration, text } = entry.Data ?? {};
        if (typeof Offset !== "number" || typeof text?.Text !== "string") continue;
        words.push({
          text: text.Text,
          start: Offset / TICKS_PER_SECOND,
          end: (Offset + (Duration ?? 0)) / TICKS_PER_SECOND,
        });
      }
    } catch {
      // Malformed metadata chunk; timings are best-effort.
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Sentence cache. The monorepo server cached synthesized audio on disk under
// data/; a serverless deployment has no durable writable disk, so this keeps a
// small bounded in-memory cache instead. It survives for the lifetime of a warm
// function instance (Fluid Compute reuses them), which is exactly the window
// that matters: the reader re-requests the sentence it just prefetched when the
// listener steps back, or replays a paragraph. The browser also caches every
// sentence blob it has played for the current document, so a cold instance only
// ever costs one re-synthesis.
// ---------------------------------------------------------------------------

const SENTENCE_CACHE_LIMIT = 200;
const sentenceCache = new Map<string, { mp3: Buffer; words: WordTiming[] }>();

function cacheGet(key: string) {
  const hit = sentenceCache.get(key);
  if (!hit) return null;
  // Re-insert so the map's insertion order doubles as LRU recency.
  sentenceCache.delete(key);
  sentenceCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: { mp3: Buffer; words: WordTiming[] }) {
  sentenceCache.set(key, value);
  while (sentenceCache.size > SENTENCE_CACHE_LIMIT) {
    sentenceCache.delete(sentenceCache.keys().next().value!);
  }
}

export function audioKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ---------------------------------------------------------------------------
// Sentence synthesis (online reader): one short snippet, with word timings.
// ---------------------------------------------------------------------------

export async function synthesizeSentence(
  text: string,
  voice: string
): Promise<{ mp3: Buffer; words: WordTiming[] }> {
  const key = audioKey([voice, text]);
  const cached = cacheGet(key);
  if (cached) return cached;

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, FORMAT, { wordBoundaryEnabled: true });
    const { audioStream, metadataStream } = tts.toStream(sanitizeForSsml(text));
    const metadataChunks: Buffer[] = [];
    metadataStream?.on("data", (chunk: Buffer) => metadataChunks.push(chunk));
    const mp3 = await streamToBuffer(audioStream);
    const words = parseWordTimings(metadataChunks);
    // Don't cache empty audio (e.g. a transient failure) — it would otherwise
    // be served as a permanent silent gap.
    if (mp3.length > 0) cacheSet(key, { mp3, words });
    return { mp3, words };
  } finally {
    tts.close();
  }
}

// ---------------------------------------------------------------------------
// Document synthesis (MP3 export): pooled workers, optional two-voice
// podcast mode, streaming output.
// ---------------------------------------------------------------------------

export function planJobs(text: string, voice: string): AudioJob[] {
  return chunkText(text).map((chunk) => ({ text: chunk, voice }));
}

// Podcast mode alternates two voices by paragraph, like a two-host show.
export function planPodcastJobs(text: string, voiceA: string, voiceB: string): AudioJob[] {
  const paragraphs = segmentText(text).map((sentences) => sentences.join(" "));
  return paragraphs.flatMap((paragraph, i) => {
    const voice = i % 2 === 0 ? voiceA : voiceB;
    return chunkText(paragraph).map((chunk) => ({ text: chunk, voice }));
  });
}

const CHUNK_ATTEMPTS = 3;

// msedge-tts interpolates the text straight into its SSML XML without escaping,
// so a stray "&", "<", ">" or a control character (e.g. NUL bytes common in PDF
// extractions) produces invalid SSML and the service returns *no audio at all*
// — which would then be silently concatenated as a gap. Escape XML and drop
// characters that aren't legal in XML before sending.
const XML_INVALID = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");
export function sanitizeForSsml(text: string): string {
  return text
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Synthesizes one chunk on a fresh connection. The msedge-tts websocket ends
// the audio stream cleanly even when a request fails or the connection drops
// (it pushes EOF, not an error), so empty audio is treated as a failure and
// retried rather than silently dropped.
async function synthesizeChunk(text: string, voice: string): Promise<Buffer> {
  const ssmlText = sanitizeForSsml(text);
  if (!ssmlText.trim()) return Buffer.alloc(0);

  let lastError: unknown;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, FORMAT);
      const { audioStream } = tts.toStream(ssmlText);
      const mp3 = await streamToBuffer(audioStream);
      if (mp3.length > 0) return mp3;
      lastError = new Error("Synthesis returned no audio.");
    } catch (err) {
      lastError = err;
    } finally {
      tts.close();
    }
  }
  throw lastError ?? new Error("Synthesis produced no audio.");
}

// Starts the worker pool and returns one promise per job, in order. Each chunk
// uses a fresh connection (see synthesizeChunk) so a dropped websocket can't
// silently truncate the rest of a reused connection's work.
function startPool(jobs: AudioJob[]): Promise<Buffer>[] {
  const deferred = jobs.map(() => {
    let resolve!: (b: Buffer) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<Buffer>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });

  let next = 0;
  for (let w = 0; w < Math.min(CHUNK_CONCURRENCY, jobs.length); w++) {
    (async () => {
      while (next < jobs.length) {
        const index = next++;
        const { text, voice } = jobs[index];
        try {
          deferred[index].resolve(await synthesizeChunk(text, voice));
        } catch (err) {
          deferred[index].reject(err);
        }
      }
    })();
  }

  // Consumers await the promises in order and so attach their handler late; a
  // later chunk failing first would otherwise surface as an unhandled
  // rejection. Mark them handled here — the awaiting consumer still sees the
  // throw.
  const promises = deferred.map((d) => d.promise);
  for (const promise of promises) promise.catch(() => {});
  return promises;
}

// Streams MP3 frames in job order as soon as each chunk is ready, so large
// exports start downloading immediately instead of buffering server-side —
// which also keeps the function well inside its response time budget.
export function streamSynthesis(jobs: AudioJob[]): ReadableStream<Uint8Array> {
  const promises = startPool(jobs);
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= promises.length) {
        controller.close();
        return;
      }
      const buffer = await promises[index++];
      controller.enqueue(new Uint8Array(buffer));
    },
  });
}

export async function synthesizeAll(jobs: AudioJob[]): Promise<Buffer> {
  return Buffer.concat(await Promise.all(startPool(jobs)));
}
