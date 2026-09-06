import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs public/sw.js against a minimal ServiceWorkerGlobalScope: a fake Cache
// Storage, a network that can be switched off, and event dispatch. The worker
// sits in front of every request the app makes, so "it looked right" is not a
// good enough standard for it.
//
// The file is evaluated with its globals passed in as arguments rather than
// installed on globalThis, so nothing here leaks into the rest of the process.

const ORIGIN = "https://speech.example.com";
const absolute = (url: string) => new URL(url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  async match(request: Request | string) {
    return this.entries.get(absolute(typeof request === "string" ? request : request.url));
  }
  async put(request: Request | string, response: Response) {
    this.entries.set(absolute(typeof request === "string" ? request : request.url), response);
  }
  async add(request: Request | string) {
    const url = absolute(typeof request === "string" ? request : request.url);
    const response = await network(url);
    if (!response.ok) throw new Error(`add failed: ${url}`);
    await this.put(url, response);
  }
  async keys() {
    return [...this.entries.keys()];
  }
  async delete(request: Request | string) {
    return this.entries.delete(absolute(typeof request === "string" ? request : request.url));
  }
}

const storage = new Map<string, FakeCache>();
const caches = {
  async open(name: string) {
    if (!storage.has(name)) storage.set(name, new FakeCache());
    return storage.get(name)!;
  },
  async keys() {
    return [...storage.keys()];
  },
  async delete(name: string) {
    return storage.delete(name);
  },
};

let online = true;
let fetched: string[] = [];
async function network(input: Request | string): Promise<Response> {
  const url = typeof input === "string" ? input : input.url;
  fetched.push(url);
  if (!online) throw new TypeError("Failed to fetch");
  const response = new Response(`body of ${url}`, { status: 200 });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

const listeners: Record<string, (event: unknown) => void> = {};
let skipWaitingCalled = false;
let claimCalled = false;

const self = {
  location: new URL(`${ORIGIN}/sw.js`),
  addEventListener: (type: string, handler: (event: unknown) => void) => {
    listeners[type] = handler;
  },
  skipWaiting: async () => {
    skipWaitingCalled = true;
  },
  clients: {
    claim: async () => {
      claimCalled = true;
    },
  },
};

// Dispatches an event and waits for whatever the worker passed to
// waitUntil/respondWith.
async function dispatch(type: string, event: object): Promise<Response | null> {
  let pending: Promise<Response> | null = null;
  listeners[type]({
    ...event,
    waitUntil: (promise: Promise<Response>) => {
      pending = promise;
    },
    respondWith: (promise: Promise<Response>) => {
      pending = promise;
    },
  });
  return pending ? await pending : null;
}

function fetchEvent(url: string, init: { method?: string; mode?: string } = {}) {
  const request = new Request(absolute(url), { method: init.method ?? "GET" });
  Object.defineProperty(request, "mode", { value: init.mode ?? "no-cors" });
  return { request };
}

before(() => {
  const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", source)(self, caches, network);
});

test("installing precaches the pages and takes over immediately", async () => {
  await dispatch("install", {});
  const shell = await caches.open("tts-shell-v1");
  assert.deepEqual(await shell.keys(), [absolute("/"), absolute("/library")]);
  assert.ok(skipWaitingCalled);
});

test("activating drops previous versions and claims open pages", async () => {
  storage.set("tts-shell-v0", new FakeCache());
  storage.set("some-other-app", new FakeCache());

  await dispatch("activate", {});

  assert.ok(!storage.has("tts-shell-v0"), "an older version's cache is dropped");
  assert.ok(storage.has("tts-shell-v1"), "the current one is kept");
  assert.ok(storage.has("some-other-app"), "caches that aren't ours are left alone");
  assert.ok(claimCalled);
});

test("requests the worker must not touch are left to the network", async () => {
  assert.equal(await dispatch("fetch", fetchEvent("/api/tts", { method: "POST" })), null);
  assert.equal(await dispatch("fetch", fetchEvent("/api/summary")), null, "no API response is cached");
  assert.equal(
    await dispatch("fetch", fetchEvent("https://fonts.googleapis.com/css")),
    null,
    "cross-origin requests are none of its business"
  );
});

test("a hashed build asset is fetched once and then served from cache", async () => {
  fetched = [];
  const asset = "/_next/static/chunks/abc123.js";
  await dispatch("fetch", fetchEvent(asset));
  await dispatch("fetch", fetchEvent(asset));
  assert.deepEqual(fetched, [absolute(asset)]);
});

test("a navigation prefers the network, so online readers get the live page", async () => {
  fetched = [];
  const response = await dispatch("fetch", fetchEvent("/library", { mode: "navigate" }));
  assert.deepEqual(fetched, [absolute("/library")]);
  assert.equal(await response!.text(), `body of ${absolute("/library")}`);
});

test("offline, the app still opens", async () => {
  online = false;
  try {
    const page = await dispatch("fetch", fetchEvent("/library", { mode: "navigate" }));
    assert.match(await page!.text(), /\/library$/, "the cached page is served");

    const unknown = await dispatch("fetch", fetchEvent("/library?tag=essays", { mode: "navigate" }));
    assert.equal(
      await unknown!.text(),
      `body of ${absolute("/")}`,
      "a URL never visited falls back to the home page"
    );

    const asset = await dispatch("fetch", fetchEvent("/_next/static/chunks/abc123.js"));
    assert.match(await asset!.text(), /abc123/, "its chunks are there too");
  } finally {
    online = true;
  }
});

test("the asset cache stays bounded across deployments", async () => {
  for (let i = 0; i < 320; i++) {
    await dispatch("fetch", fetchEvent(`/_next/static/chunks/fill-${i}.js`));
  }
  const assets = await caches.open("tts-assets-v1");
  assert.ok((await assets.keys()).length <= 300, "trimmed to the cap");
  assert.ok(await assets.match("/_next/static/chunks/fill-319.js"), "the newest entries are kept");
});
