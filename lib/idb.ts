// ---------------------------------------------------------------------------
// A minimal promise wrapper around IndexedDB.
//
// The monorepo version of this app kept its library in a server-side SQLite
// file. This deployment has no server of its own to keep state in — Vercel
// functions are stateless — so the library lives in the reader's own browser
// instead. IndexedDB rather than localStorage because documents are whole
// books: localStorage's ~5 MB quota and synchronous string-only API don't
// survive a single EPUB.
// ---------------------------------------------------------------------------

const DB_NAME = "tts-library";
// v2 added the AUDIO store (see lib/audioCache.ts).
const DB_VERSION = 2;
export const DOCUMENTS = "documents";
export const BOOKMARKS = "bookmarks";
export const AUDIO = "audio";

let connection: Promise<IDBDatabase> | null = null;

function connect(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser has no local storage available."));
  }
  if (connection) return connection;

  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const documents = db.createObjectStore(DOCUMENTS, {
          keyPath: "id",
          autoIncrement: true,
        });
        // Dedup on re-reading the same source (see saveDocument).
        documents.createIndex("text_hash", "text_hash", { unique: false });
      }
      if (!db.objectStoreNames.contains(BOOKMARKS)) {
        const bookmarks = db.createObjectStore(BOOKMARKS, {
          keyPath: "id",
          autoIncrement: true,
        });
        bookmarks.createIndex("document_id", "document_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(AUDIO)) {
        // Synthesized sentence audio, keyed by a hash of voice + text. The
        // `used_at` index orders the store by recency so eviction can walk the
        // oldest entries without deserializing their MP3 payloads.
        const audio = db.createObjectStore(AUDIO, { keyPath: "key" });
        audio.createIndex("used_at", "used_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Couldn't open the local library."));
    // A second tab holding an old version open blocks the upgrade; surface it
    // rather than hanging forever on a promise that never settles.
    request.onblocked = () =>
      reject(new Error("Close this app's other tabs and reload to finish upgrading the library."));
  });
  // A failed open shouldn't be cached — the next call should get to retry.
  connection.catch(() => {
    connection = null;
  });
  return connection;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local library request failed."));
  });
}

// Runs `body` inside one transaction and resolves with its value once the
// transaction has actually committed, so a caller that immediately re-reads
// sees its own write.
export async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await connect();
  const transaction = db.transaction(stores, mode);
  const result = await body(transaction);
  return new Promise<T>((resolve, reject) => {
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local library write was aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local library write failed."));
  });
}

export const get = <T>(store: IDBObjectStore, key: IDBValidKey) =>
  promisify<T | undefined>(store.get(key) as IDBRequest<T | undefined>);

export const getAll = <T>(source: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange) =>
  promisify<T[]>(source.getAll(query) as IDBRequest<T[]>);

export const put = (store: IDBObjectStore, value: unknown) =>
  promisify<IDBValidKey>(store.put(value) as IDBRequest<IDBValidKey>);

export const add = (store: IDBObjectStore, value: unknown) =>
  promisify<IDBValidKey>(store.add(value) as IDBRequest<IDBValidKey>);

export const del = (store: IDBObjectStore, key: IDBValidKey) =>
  promisify<undefined>(store.delete(key) as IDBRequest<undefined>);

export const count = (source: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange) =>
  promisify<number>(source.count(query));

export const clear = (store: IDBObjectStore) =>
  promisify<undefined>(store.clear() as IDBRequest<undefined>);

// Walks an index in key order and yields primary keys only — the payloads stay
// on disk, which is what makes LRU eviction of large audio blobs cheap.
export function eachKey(
  index: IDBIndex,
  visit: (primaryKey: IDBValidKey) => boolean | void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = index.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      if (visit(cursor.primaryKey) === false) return resolve();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Local library scan failed."));
  });
}

// Content hash used to recognise a document that's already in the library.
// SubtleCrypto needs a secure context; over plain http on a LAN address it's
// missing, so fall back to a cheap non-cryptographic digest — dedup is a
// convenience, not a correctness requirement.
export async function hashText(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fall through to the non-crypto digest below.
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ text.charCodeAt(text.length - 1 - i), 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${text.length}`;
}
