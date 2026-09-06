// ---------------------------------------------------------------------------
// Per-caller rate limiting.
//
// The three routes are unauthenticated by design — the app needs no signup —
// which also means a public deployment's synthesis, OCR, and (where a key is
// configured) Claude summaries are open to anyone who finds the URL. Summaries
// spend the deployment owner's API credits; synthesis and OCR hold a 300-second
// function open. A token bucket per caller keeps a scraper from turning the
// deployment into a free API without getting in a reader's way.
//
// State is per warm function instance, which Fluid Compute reuses across
// requests. That makes this a deterrent, not a guarantee: a caller spread
// across several instances gets a proportionally larger budget. Doing better
// needs shared storage, which this app deliberately doesn't have — and the
// deterrent is what stops the realistic abuse.
//
// Every limit can be retuned or switched off with environment variables (see
// `limitFromEnv`), because "generous enough for a reader" depends on whether
// the deployment serves one person or an office behind a single NAT address.
// ---------------------------------------------------------------------------

import { AppError } from "./http-errors";

export type Limit = {
  // Requests a caller may make back-to-back after being idle.
  burst: number;
  // Sustained rate, in requests per minute, that the bucket refills at.
  perMinute: number;
};

type Bucket = { tokens: number; updated: number };

// Bounded so a flood of distinct addresses can't grow this without limit; the
// map doubles as its own LRU (insertion order, re-inserted on use).
const MAX_TRACKED = 10_000;
const buckets = new Map<string, Map<string, Bucket>>();

function bucketsFor(name: string): Map<string, Bucket> {
  let scope = buckets.get(name);
  if (!scope) {
    scope = new Map();
    buckets.set(name, scope);
  }
  return scope;
}

// Vercel puts the client address at the front of x-forwarded-for. Everything
// else is a fallback for local development and self-hosting, where the header
// may be missing entirely — in which case every caller shares one bucket, which
// is the safe direction to be wrong in for a single-user local run.
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Reads a limit from the environment, e.g. TTS_SENTENCE_LIMIT="40/120" for a
// burst of 40 and 120 requests a minute. "off" disables the limit entirely.
export function limitFromEnv(variable: string, fallback: Limit): Limit | null {
  const raw = process.env[variable]?.trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "off") return null;
  const [burst, perMinute] = raw.split("/").map((part) => Number(part.trim()));
  if (!Number.isFinite(burst) || !Number.isFinite(perMinute) || burst <= 0 || perMinute <= 0) {
    return fallback;
  }
  return { burst, perMinute };
}

// Spends one token from `key`'s bucket. Returns how many seconds to wait when
// the bucket is empty, or null when the request may proceed.
function spend(name: string, key: string, limit: Limit): number | null {
  const scope = bucketsFor(name);
  const now = Date.now();
  const bucket = scope.get(key) ?? { tokens: limit.burst, updated: now };

  // Refill for the time since the last request, up to the burst ceiling.
  const refill = ((now - bucket.updated) / 60_000) * limit.perMinute;
  bucket.tokens = Math.min(limit.burst, bucket.tokens + refill);
  bucket.updated = now;

  let retryAfter: number | null = null;
  if (bucket.tokens < 1) {
    retryAfter = Math.max(1, Math.ceil(((1 - bucket.tokens) / limit.perMinute) * 60));
  } else {
    bucket.tokens -= 1;
  }

  // Re-insert so map order stays least-recently-used first.
  scope.delete(key);
  scope.set(key, bucket);
  while (scope.size > MAX_TRACKED) {
    scope.delete(scope.keys().next().value!);
  }
  return retryAfter;
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfter: number) {
    super(
      `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
      429
    );
  }
}

// Throws RateLimitError when `request`'s caller has spent its budget for the
// named bucket. A null limit (switched off in the environment) always passes.
export function enforceLimit(request: Request, name: string, limit: Limit | null): void {
  if (!limit) return;
  const retryAfter = spend(name, callerKey(request), limit);
  if (retryAfter !== null) throw new RateLimitError(retryAfter);
}

// A 429 is only useful with the header that says when to come back.
export function rateLimitHeaders(err: unknown): Record<string, string> | undefined {
  return err instanceof RateLimitError ? { "Retry-After": String(err.retryAfter) } : undefined;
}

// ---------------------------------------------------------------------------
// The limits themselves. Generous for reading: the reader prefetches two
// sentences ahead of the one playing, so a fast reader skipping around can
// legitimately fire off a handful of sentence requests a second.
// ---------------------------------------------------------------------------

export const SENTENCE_LIMIT = limitFromEnv("TTS_SENTENCE_LIMIT", { burst: 60, perMinute: 180 });
// A whole-document render holds a function open for as long as the document
// takes to synthesize, so these are counted separately and much more tightly.
export const DOCUMENT_LIMIT = limitFromEnv("TTS_DOCUMENT_LIMIT", { burst: 5, perMinute: 5 });
// Extraction parses PDFs and runs OCR, which is expensive but happens once per
// document a person actually adds.
export const EXTRACT_LIMIT = limitFromEnv("TTS_EXTRACT_LIMIT", { burst: 10, perMinute: 20 });
// Summaries spend real money on someone's Anthropic key.
export const SUMMARY_LIMIT = limitFromEnv("TTS_SUMMARY_LIMIT", { burst: 5, perMinute: 10 });
