# Document to Speech

Turn documents (`.txt`, `.md`, `.csv`, `.pdf`, `.docx`, `.epub`), images (OCR),
pasted text, or web links into speech — read along with word-level
highlighting, or export an MP3 (optionally a two-voice podcast). Powered by
Microsoft Edge's neural voices via [`msedge-tts`](https://www.npmjs.com/package/msedge-tts),
so **no API key and no signup are required**.

## Features

- Drop a file, paste text, or paste a link; images are read with OCR.
- Sentence playback with word-level highlighting, 0.5×–2× speed, and mid-document
  voice switching.
- A local library with search, tags, categories, progress, resume, merge, and
  bulk actions.
- Bookmarks (`b`) and highlights (`h`) with notes; chapters from Markdown
  headings or plain-text markers.
- Find in the open document (`/`) — unlike the browser's own find, it jumps
  playback to the matching sentence, ignoring case and accents. `?` lists every
  shortcut.
- Download the extracted text (`.txt`, or `.md` for Markdown) as well as the
  audio — an OCR'd image or a parsed PDF is often worth keeping as text.
- Streaming MP3 export with live progress that can be cancelled mid-render,
  queue playback with looping, sleep timer, media keys, and reader typography
  and speed, remembered between sessions.
- Sentences you have already heard are cached in the browser, so re-reading or
  resuming a document is instant, costs no synthesis, and works offline.
- Export the whole library (documents, bookmarks, reading positions) to a JSON
  file and merge it back in — on another browser, or after clearing site data.
- Installable, and works offline once a document and its audio are cached.

26 neural voices across English, Chinese, Spanish, French, German, Italian,
Portuguese, Russian, Japanese, Korean, Hindi, and Arabic.

## Local storage

The library lives in the browser's IndexedDB (`lib/idb.ts`), so there is nothing
to run behind the app but the synthesis routes. Three stores: `documents`,
`bookmarks`, and `audio` — an LRU cache of synthesized sentences, keyed by a
hash of voice + text and capped at 1,200 entries (roughly 60 MB), which the
library's storage row reports and can clear.

Because that is the only copy, the library page can export everything to a JSON
backup and import one back (`lib/backup.ts`). Import merges rather than
replaces: a document whose text is already present is recognised by its content
hash and keeps its place, taking whichever reading position is further along, so
re-importing the same backup is a no-op.

## Offline and installing

`app/manifest.ts` makes the app installable; `public/sw.js` caches it so it
opens without a network. Navigations are network-first (an online reader always
gets the current deployment, an offline one gets the last page they saw), and
everything under `/_next/static` is cached first because it is content-hashed.
`/api/*` is never cached. The worker registers in production only —
`app/ServiceWorker.tsx` unregisters it in development, where a stale chunk cache
would fight the dev server.

Together with the audio cache above, a document you have already listened to
needs nothing from the network to be read again.

## Tests

```sh
npm test           # everything
npm test search    # one file, by name
```

`tests/run.mjs` bundles each `tests/*.test.ts` with esbuild (which resolves the
`@/` alias) and hands them to Node's own test runner — no test framework, and
nothing to configure. Node runs each file in its own process, which the storage
tests rely on: `lib/idb` caches its database connection, so "an empty library"
means a fresh process.

The suite covers the parts that are expensive to get wrong: the backup format
and its merge rules, the v1 to v2 database upgrade, audio cache eviction, the
service worker's caching strategies (run against a fake `ServiceWorkerGlobalScope`),
rate limiting, find, and the listening estimates. It never touches the network.

## Running and deploying

```sh
npm install
npm run dev     # http://localhost:3000

vercel          # preview
vercel --prod   # production
```

No environment variables are needed. `/api/tts` and `/api/extract` set
`maxDuration = 300` and run on the Node.js runtime — synthesis opens an
outbound websocket to Edge's voice service, and extraction uses Node-only
parsers.

Optional: `ANTHROPIC_API_KEY` enables the library's AI summaries (the button is
hidden without it), and `ANTHROPIC_MODEL` overrides the model used.

## Swapping the TTS engine

Replace `synthesizeChunk` / `synthesizeSentence` in `lib/server/synth.ts` with a
call to another provider. Everything else stays the same.
