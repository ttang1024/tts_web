// Client-side helpers for the app's two synthesis endpoints, /api/tts and
// /api/extract. These are the only network calls the app makes: everything
// else (the library, progress, bookmarks, chapters) is local.

import { estimateMp3Bytes } from "@/lib/shared";
import { readCachedAudio, writeCachedAudio } from "@/lib/audioCache";

export type WordTiming = { text: string; start: number; end: number };
export type SentenceAudio = { url: string; words: WordTiming[] };

async function errorFromResponse(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Request failed (${res.status}).`);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function bytesToBlobUrl(bytes: Uint8Array<ArrayBuffer>): string {
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

export function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Synthesizes one sentence and returns a playable blob URL + word timings for
// highlighting — used by the online reader's per-sentence playback, the
// library's mini player, and the home page's voice preview.
//
// Sentences already synthesized in this voice come back from the browser's own
// audio cache (lib/audioCache) without touching the network, so re-reading or
// resuming a document is instant and works offline. A cache miss, or no usable
// storage at all, behaves exactly as it always did.
export async function synthesizeSentence(text: string, voice: string): Promise<SentenceAudio> {
  const cached = await readCachedAudio(voice, text);
  if (cached) return { url: bytesToBlobUrl(cached.mp3), words: cached.words };

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const body = (await res.json()) as { audio: string; words?: WordTiming[] };
  const bytes = base64ToBytes(body.audio);
  const words = Array.isArray(body.words) ? body.words : [];
  // Writing is fire-and-forget: playback shouldn't wait on the cache, and a
  // rejected write (quota, private mode) is not an error worth surfacing.
  void writeCachedAudio(voice, text, bytes, words);
  return { url: bytesToBlobUrl(bytes), words };
}

// Extracts text from an uploaded file or pasted link (multipart). Unlike the
// monorepo server this stores nothing — the caller saves the result to the
// local library itself.
export async function extractSource(
  form: FormData
): Promise<{ name: string; sourceType: "file" | "text" | "url"; source: string | null; text: string }> {
  const res = await fetch("/api/extract", { method: "POST", body: form });
  if (!res.ok) throw await errorFromResponse(res);
  return res.json();
}

export type ExportOptions = {
  // Aborts the render. The stream stops arriving; the server gives up when the
  // response is cancelled.
  signal?: AbortSignal;
  // Progress as a 0-1 fraction, called as bytes arrive. The total is estimated
  // from the text (a streamed response has no Content-Length), so it is held
  // just short of 1 until the stream actually ends.
  onProgress?: (fraction: number) => void;
  // Expected size in bytes; estimateMp3Bytes(text) supplies it.
  expectedBytes?: number;
};

// Whether a caught error is this export being cancelled rather than failing —
// a cancel is a thing the person did, not something to show them as an error.
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Synthesizes a whole document/pasted text/link (multipart) as a downloadable
// MP3 blob. Rendering a book takes minutes, so the response — which the route
// streams chunk by chunk as each one is synthesized — is read incrementally to
// report progress, instead of waiting on one opaque res.blob().
export async function generateMp3(
  form: FormData,
  options: ExportOptions = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch("/api/tts", {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!res.ok) throw await errorFromResponse(res);
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));

  if (!options.onProgress || !res.body) return { blob: await res.blob(), filename };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (options.expectedBytes) {
      options.onProgress(Math.min(0.99, received / options.expectedBytes));
    }
  }
  options.onProgress(1);
  return { blob: new Blob(chunks as BlobPart[], { type: "audio/mpeg" }), filename };
}

// Renders a library document to MP3. The server has no copy of it, so the text
// goes up with the request.
export async function synthesizeTextToMp3(
  text: string,
  voice: string,
  name: string,
  options: ExportOptions = {}
): Promise<Blob> {
  const form = new FormData();
  form.append("text", text);
  form.append("voice", voice);
  form.append("name", name);
  const { blob } = await generateMp3(form, {
    expectedBytes: estimateMp3Bytes(text),
    ...options,
  });
  return blob;
}

// Triggers a browser download for an already-fetched blob.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A filename safe on every platform, derived from a document title.
export function safeFilename(title: string): string {
  return (title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "speech").slice(0, 120);
}
