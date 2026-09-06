import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callerKey,
  enforceLimit,
  limitFromEnv,
  rateLimitHeaders,
  RateLimitError,
} from "@/lib/server/rate-limit";

const LIMIT = { burst: 3, perMinute: 60 };

function requestFrom(ip: string): Request {
  return new Request("https://example.com/api/tts", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });
}

// How many of `attempts` requests from `ip` are let through.
function allowed(ip: string, bucket: string, attempts: number): number {
  let count = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      enforceLimit(requestFrom(ip), bucket, LIMIT);
      count++;
    } catch {
      // Refused.
    }
  }
  return count;
}

test("the caller is the first address in x-forwarded-for", () => {
  assert.equal(callerKey(requestFrom("203.0.113.7")), "203.0.113.7");
});

test("a request with no forwarding header still has a key", () => {
  assert.equal(callerKey(new Request("https://example.com/api/tts")), "unknown");
});

test("the burst is spent, then requests are refused", () => {
  assert.equal(allowed("198.51.100.1", "burst", 5), 3);
});

test("a refusal is a 429 that says when to come back", () => {
  allowed("198.51.100.9", "retry", 3);
  assert.throws(
    () => enforceLimit(requestFrom("198.51.100.9"), "retry", LIMIT),
    (err: unknown) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.status, 429);
      assert.ok(err.retryAfter >= 1);
      assert.match(err.message, /second/);
      assert.deepEqual(rateLimitHeaders(err), { "Retry-After": String(err.retryAfter) });
      return true;
    }
  );
});

test("an error that isn't a rate limit carries no Retry-After", () => {
  assert.equal(rateLimitHeaders(new Error("something else")), undefined);
});

test("one caller running out doesn't affect another", () => {
  allowed("198.51.100.2", "shared", 5);
  assert.equal(allowed("198.51.100.3", "shared", 3), 3);
});

test("sentence and document budgets are counted separately", () => {
  // The reason a reader who has been skipping around can still export.
  allowed("198.51.100.4", "tts:sentence", 5);
  assert.equal(allowed("198.51.100.4", "tts:document", 3), 3);
});

test("the bucket refills over time", () => {
  allowed("198.51.100.5", "refill", 5);
  const realNow = Date.now;
  try {
    // 60 a minute is one token a second; two seconds buys two.
    Date.now = () => realNow() + 2_000;
    assert.equal(allowed("198.51.100.5", "refill", 3), 2);
  } finally {
    Date.now = realNow;
  }
});

test("an unset variable keeps the default", () => {
  assert.deepEqual(limitFromEnv("TTS_NOT_SET_ANYWHERE", LIMIT), LIMIT);
});

test("a variable overrides the default", () => {
  process.env.TTS_TEST_LIMIT = "12/34";
  assert.deepEqual(limitFromEnv("TTS_TEST_LIMIT", LIMIT), { burst: 12, perMinute: 34 });
});

test("'off' removes the limit", () => {
  process.env.TTS_TEST_LIMIT = "off";
  assert.equal(limitFromEnv("TTS_TEST_LIMIT", LIMIT), null);
});

test("a malformed value falls back to the default rather than removing the limit", () => {
  for (const value of ["nonsense", "10", "0/10", "-1/5", "a/b"]) {
    process.env.TTS_TEST_LIMIT = value;
    assert.deepEqual(limitFromEnv("TTS_TEST_LIMIT", LIMIT), LIMIT, value);
  }
});

test("a removed limit lets everything through", () => {
  for (let i = 0; i < 50; i++) enforceLimit(requestFrom("198.51.100.6"), "disabled", null);
});
