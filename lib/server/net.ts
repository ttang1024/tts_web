import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// ---------------------------------------------------------------------------
// SSRF protection for user-supplied URLs (link extraction).
//
// extractFromUrl fetches arbitrary http(s) URLs on behalf of the client. Left
// unguarded, a client could point us at cloud metadata (169.254.169.254),
// loopback, or other internal services. We resolve the host up front, reject
// any address that isn't a normal public unicast address, and — because DNS
// can rebind and redirects can hop to a new host — re-check on every redirect
// rather than trusting fetch's automatic redirect following.
//
// Validating the hostname isn't enough on its own: a plain `fetch(url)` after
// the check re-resolves DNS itself, and an attacker controlling the DNS
// record can answer the validation lookup with a public IP and the real
// connection's lookup with a private one (DNS rebinding), walking straight
// through the check. So the addresses returned by the validation lookup are
// pinned as the *only* ones the actual request's connection is allowed to
// resolve to, via a per-request Agent with a fixed `connect.lookup`.
// ---------------------------------------------------------------------------

function ipToBytes(ip: string): number[] | null {
  if (net.isIPv4(ip)) return ip.split(".").map(Number);
  return null;
}

// IPv4 ranges that must never be fetched.
function isBlockedIPv4(ip: string): boolean {
  const b = ipToBytes(ip);
  if (!b) return false;
  const [a, c, d, e] = b;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && c === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && c >= 16 && c <= 31) return true; // private
  if (a === 192 && c === 168) return true; // private
  if (a === 192 && c === 0 && d === 0) return true; // IETF protocol assignments
  if (a === 100 && c >= 64 && c <= 127) return true; // CGN 100.64/10
  if (a >= 224) return true; // multicast + reserved + broadcast
  void e;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0];
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // not a recognizable IP literal — refuse
}

// Resolves a hostname and throws if any resolved address is non-public.
// Returns the validated addresses so the caller can pin the actual connection
// to them. A host can resolve to several addresses; every one must be safe.
export async function assertPublicHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error("That link points to a non-public address.");
    }
    return [host];
  }
  // "localhost" and similar never resolve to anything we want to reach.
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    throw new Error("That link points to a non-public address.");
  }
  let results: { address: string; family: number }[];
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new Error("Couldn't resolve that link's host.");
  }
  if (results.length === 0 || results.some((r) => isBlockedAddress(r.address))) {
    throw new Error("That link points to a non-public address.");
  }
  return results.map((r) => r.address);
}

// Builds a dispatcher whose connections are pinned to exactly the given
// (pre-validated) addresses, regardless of what a fresh DNS lookup at connect
// time would return. This is what closes the DNS-rebinding window between
// assertPublicHost's check and the request it guards.
function pinnedDispatcher(addresses: string[]): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })));
      },
    },
  });
}

// Fetches a URL with SSRF-safe manual redirect handling: each hop's host is
// re-resolved and re-validated, and the request is pinned to exactly those
// validated addresses. Returns the final Response.
//
// Each hop gets its own single-use Agent rather than a shared one, so its
// dedicated connection is never reused for another host — it closes itself
// via undici's idle-connection timeout once the response (redirect or final)
// has been read, which we don't force here since the final response's body
// is still streaming back to the caller when this function returns.
export async function safeFetch(
  startUrl: URL,
  init: RequestInit & { timeoutMs?: number },
  maxRedirects = 5
): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  let url = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const addresses = await assertPublicHost(url.hostname);
    // undici ships its own RequestInit/Response types (structurally the same
    // as the global fetch types, but nominally distinct), so the interop
    // here goes through `unknown` rather than lining up every field.
    const res = (await undiciFetch(url as unknown as string, {
      ...(rest as Record<string, unknown>),
      dispatcher: pinnedDispatcher(addresses),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    } as never)) as unknown as Response;
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      const next = new URL(res.headers.get("location")!, url);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new Error("That link redirects to an unsupported scheme.");
      }
      url = next;
      continue;
    }
    return res;
  }
  throw new Error("That link redirects too many times.");
}
