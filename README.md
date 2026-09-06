# Document to Speech

Turn documents (`.txt`, `.md`, `.csv`, `.pdf`, `.docx`, `.epub`), images (OCR),
pasted text, or web links into speech — read along with word-level highlighting,
or export an MP3 (optionally a two-voice podcast). Powered by Microsoft Edge's
neural voices via [`msedge-tts`](https://www.npmjs.com/package/msedge-tts), so
**no API key and no signup are required**.

Live at **<https://ttsweb-one.vercel.app>**.

## Features

- Sentence playback with word-level highlighting, 0.5×–2× speed, and mid-document
  voice switching.
- A local library with search, tags, categories, progress, resume, and bulk actions.
- Bookmarks (`b`), highlights (`h`), chapters, and find (`/`) that jumps playback
  to the match. `?` lists every shortcut.
- Streaming MP3 export, cancellable mid-render; text download, queue playback,
  sleep timer, and media keys.
- Heard sentences are cached, so re-reading is instant and works offline.
- Export the library to JSON and merge it back on another browser.
- 26 voices across English, Chinese, Spanish, French, German, Italian, Portuguese,
  Russian, Japanese, Korean, Hindi, and Arabic.

## Storage and offline

The library lives in the browser's IndexedDB (`lib/idb.ts`) — nothing runs behind
the app but the synthesis routes. Three stores: `documents`, `bookmarks`, and
`audio`, an LRU cache keyed by a hash of voice + text, capped at 1,200 entries
(~60 MB). Since that is the only copy, `lib/backup.ts` exports and imports JSON;
import merges by content hash, keeping the furthest reading position, so
re-importing is a no-op.

`public/sw.js` makes the app installable and offline-capable: navigations are
network-first, `/_next/static` is cache-first, `/api/*` is never cached. It
registers in production only.

## Development

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # or: npm test search, for one file
vercel --prod      # deploy
```

`tests/run.mjs` bundles each `tests/*.test.ts` with esbuild and hands it to Node's
test runner — no framework, one process per file (the storage tests need it, since
`lib/idb` caches its connection). It covers the backup format, the v1→v2 database
upgrade, cache eviction, the service worker, rate limiting, and find.

No environment variables are needed. `/api/tts` and `/api/extract` set
`maxDuration = 300` and run on the Node.js runtime. Optional: `ANTHROPIC_API_KEY`
enables the library's AI summaries (the button is hidden without it), and
`ANTHROPIC_MODEL` overrides the model.

To use another TTS provider, replace `synthesizeChunk` / `synthesizeSentence` in
`lib/server/synth.ts`. Everything else stays the same.
