"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Volume2, LoaderCircle } from "lucide-react";
import Reader from "./Reader";
import ErrorBanner from "./ErrorBanner";
import {
  createDocument,
  fetchDocument,
  fetchDocuments,
  patchDocument,
  type DocumentSummary,
} from "@/lib/documents";
import {
  extractSource,
  generateMp3,
  isAbortError,
  safeFilename,
  synthesizeSentence,
} from "@/lib/tts";
import { loadVoicePref, saveVoicePref } from "@/lib/voicePref";
import {
  estimateListeningSeconds,
  estimateMp3Bytes,
  formatDuration,
  normalizeText,
  normalizeUrl,
  segmentText,
  segmentMarkdown,
  VOICES,
} from "@/lib/shared";

const ACCEPT = ".txt,.md,.markdown,.csv,.pdf,.docx,.epub,image/*";
const REPO_URL = "https://github.com/ttang1024/tts_web";
const PREVIEW_TEXT = "Hello! This is how I sound when I read to you.";
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

// Markdown files are rendered with formatting and read without their symbols.
const isMarkdownName = (name: string | null | undefined) =>
  !!name && /\.(md|markdown)$/i.test(name);
const segment = (text: string, markdown: boolean) =>
  markdown ? segmentMarkdown(text) : segmentText(text);

type Mode = "file" | "text" | "url";

// An input turned into text and recorded in the library, ready to read or
// export. `id` is null when the library couldn't be written to.
type Resolved = { id: number | null; title: string; text: string; source: string | null };

const MODES: { id: Mode; label: string }[] = [
  { id: "file", label: "Upload document" },
  { id: "text", label: "Paste text" },
  { id: "url", label: "Web link" },
];

// lucide-react no longer ships brand marks, so the octocat glyph is inlined.
function GithubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [busy, setBusy] = useState(false);
  // Null unless an MP3 is being rendered, in which case it is the percentage
  // done — a book takes minutes, so "Generate MP3" becomes a progress readout
  // that also cancels.
  const [exportPercent, setExportPercent] = useState<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [reading, setReading] = useState<{
    id: number | null;
    title: string;
    paragraphs: string[][];
    voice: string;
    initialIndex: number;
    isMarkdown: boolean;
    text: string;
  } | null>(null);
  const [latest, setLatest] = useState<DocumentSummary | null>(null);
  const [podcast, setPodcast] = useState(false);
  const [voice2, setVoice2] = useState(VOICES[1].id);
  const [previewing, setPreviewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Restore the last voice after mount rather than in the useState
  // initializer: this page is server-rendered, and localStorage can't be read
  // until the client is up.
  useEffect(() => {
    setVoice(loadVoicePref());
  }, []);

  // The podcast pair has to stay distinct — the second picker hides whatever
  // the first one is set to, restored voice included.
  useEffect(() => {
    if (voice2 === voice) setVoice2(VOICES.find((v) => v.id !== voice)!.id);
  }, [voice, voice2]);

  // "Continue listening" card: most recently touched library entry.
  useEffect(() => {
    fetchDocuments()
      .then((docs) => setLatest(docs[0] ?? null))
      .catch(() => { });
  }, [reading]);

  // The browser extension opens the app with ?url=…; auto-start reading it.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("url");
    if (!fromQuery) return;
    window.history.replaceState(null, "", "/");
    setMode("url");
    setUrl(fromQuery);
    readOnline(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickVoice(id: string) {
    setVoice(id);
    saveVoicePref(id);
  }

  function pickFile(f: File | null) {
    setFile(f);
    setError(null);
  }

  async function previewVoice() {
    setPreviewing(true);
    setError(null);
    try {
      const { url } = await synthesizeSentence(PREVIEW_TEXT, voice);
      previewRef.current?.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      previewRef.current = audio;
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice preview failed.");
    } finally {
      setPreviewing(false);
    }
  }

  async function continueReading(doc: DocumentSummary) {
    setError(null);
    setBusy(true);
    try {
      const full = await fetchDocument(doc.id);
      const markdown = full.source_type === "file" && isMarkdownName(full.source);
      const paragraphs = segment(full.text, markdown);
      if (paragraphs.length === 0) throw new Error("No readable text found.");
      setReading({
        id: full.id,
        title: full.title,
        paragraphs,
        voice: full.voice ?? voice,
        initialIndex: full.progress_index,
        isMarkdown: markdown,
        text: full.text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the document.");
    } finally {
      setBusy(false);
    }
  }

  // Extracts (for a file or link), records the document in the local library,
  // and returns the plain text to synthesize. Reading and exporting share this
  // so a document lands in the library either way, whether it is read online
  // or exported as an MP3.
  async function resolveInput(urlOverride?: string): Promise<Resolved> {
    if (urlOverride || mode === "file" || mode === "url") {
      const form = new FormData();
      if (!urlOverride && mode === "file") {
        if (!file) throw new Error("Choose a document first.");
        form.append("file", file);
      } else {
        const link = normalizeUrl(urlOverride ?? url);
        if (!link) throw new Error("Paste a valid web link first.");
        form.append("url", link);
      }
      form.append("ocr", voice.split("-")[0]);
      const extracted = await extractSource(form);
      const saved = await createDocument({
        title: extracted.name,
        text: extracted.text,
        sourceType: extracted.sourceType,
        source: extracted.source,
        voice,
      });
      return {
        id: saved?.id ?? null,
        title: extracted.name,
        text: extracted.text,
        source: extracted.source,
      };
    }

    if (!text.trim()) throw new Error("Paste some text first.");
    const plain = normalizeText(text);
    const saved = await createDocument({ title: "Pasted text", text: plain, voice });
    return { id: saved?.id ?? null, title: "Pasted text", text: plain, source: null };
  }

  async function generate() {
    // A second click while it renders abandons the render rather than queueing
    // another one behind it.
    if (exportPercent !== null) {
      exportAbortRef.current?.abort();
      return;
    }
    setError(null);
    setBusy(true);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);

    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const resolved = await resolveInput();
      const form = new FormData();
      form.append("voice", voice);
      form.append("text", resolved.text);
      form.append("name", resolved.title);
      // The route strips Markdown symbols out of the speech when the source
      // says it's Markdown; pass the original filename along so it still can.
      if (resolved.source) form.append("source", resolved.source);
      if (podcast && voice2 !== voice) {
        form.append("mode", "podcast");
        form.append("voice2", voice2);
      }

      setExportPercent(0);
      const { blob, filename } = await generateMp3(form, {
        signal: controller.signal,
        expectedBytes: estimateMp3Bytes(resolved.text),
        onProgress: (fraction) => setExportPercent(Math.round(fraction * 100)),
      });
      setResult({
        url: URL.createObjectURL(blob),
        name: filename ?? `${safeFilename(resolved.title)}.mp3`,
      });
    } catch (err) {
      // Cancelling is deliberate, so it leaves no error behind.
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      exportAbortRef.current = null;
      setExportPercent(null);
      setBusy(false);
    }
  }

  async function readOnline(urlOverride?: string) {
    setError(null);
    setBusy(true);
    try {
      const resolved = await resolveInput(urlOverride);
      const markdown = isMarkdownName(resolved.source);
      const paragraphs = segment(resolved.text, markdown);
      if (paragraphs.length === 0) throw new Error("No readable text found.");
      setReading({
        id: resolved.id,
        title: resolved.title,
        paragraphs,
        voice,
        initialIndex: 0,
        isMarkdown: markdown,
        text: resolved.text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (reading) {
    const docId = reading.id;
    return (
      <Reader
        title={reading.title}
        paragraphs={reading.paragraphs}
        voice={reading.voice}
        voices={VOICES}
        documentId={docId}
        isMarkdown={reading.isMarkdown}
        initialIndex={reading.initialIndex}
        text={reading.text}
        onClose={() => setReading(null)}
        onProgress={docId ? (i) => patchDocument(docId, { progressIndex: i }) : undefined}
        onVoiceChange={docId ? (v) => patchDocument(docId, { voice: v }) : undefined}
        onTextSave={(t) => setReading((r) => (r ? { ...r, text: t } : r))}
        onTitleSave={(t) => setReading((r) => (r ? { ...r, title: t } : r))}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* The heading beside it already names the app, so the mark is
                decorative and stays out of the accessibility tree. */}
            <Image src="/icon.png" alt="" width={36} height={36} priority className="h-9 w-9 shrink-0" />
            <h1 className="truncate text-3xl font-bold tracking-tight">Document to Speech</h1>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source on GitHub"
            aria-label="Source on GitHub"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
          >
            <GithubMark />
          </a>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload a document (.txt, .md, .pdf, .docx, .epub) or an image, paste
          text, or paste a web link, pick a voice, then read along online with
          word highlighting — or download the result as an MP3.
        </p>
      </header>

      {latest && (
        <button
          onClick={() => continueReading(latest)}
          disabled={busy}
          className={`flex items-center gap-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-left transition hover:border-blue-400 disabled:opacity-60 dark:border-blue-900 dark:bg-blue-950/30 dark:hover:border-blue-600 ${FOCUS_RING}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            ▶
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
              Continue listening
            </span>
            <span className="block truncate font-medium">{latest.title}</span>
            <span className="block text-xs text-zinc-500">
              Sentence {latest.progress_index + 1} of {latest.sentence_count} · ~
              {formatDuration(
                estimateListeningSeconds(
                  latest.char_count *
                  (1 - latest.progress_index / Math.max(latest.sentence_count, 1)),
                  1,
                  latest.speech_rate
                )
              )}{" "}
              left
            </span>
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${FOCUS_RING} ${mode === m.id
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
          >
            {m.label}
          </button>
        ))}
        {/* Not a way of adding a document, so it sits apart from the modes. */}
        <Link
          href="/library"
          className={`ml-auto rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
        >
          Library
        </Link>
      </div>

      {mode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
            }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-zinc-500">
                {(file.size / 1024).toFixed(1)} KB — click to change
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Drop a document here, or click to browse</p>
              <p className="text-sm text-zinc-500">.txt, .md, .csv, .pdf, .docx, or an image</p>
            </>
          )}
        </div>
      ) : mode === "url" ? (
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full rounded-2xl border border-zinc-300 bg-transparent px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type the text you want spoken…"
          rows={8}
          className="w-full resize-y rounded-2xl border border-zinc-300 bg-transparent px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
        />
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Voice
          <div className="flex items-center gap-2">
            <select
              value={voice}
              onChange={(e) => pickVoice(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <button
              onClick={previewVoice}
              disabled={previewing}
              aria-label="Preview voice"
              title="Preview voice"
              className={`shrink-0 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              {previewing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <div className="flex gap-2">
          <button
            onClick={() => readOnline()}
            disabled={busy}
            className={`rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {busy ? "Working…" : "Read online"}
          </button>
          <button
            onClick={generate}
            disabled={busy && exportPercent === null}
            title={exportPercent !== null ? "Cancel this render" : undefined}
            className={`rounded-xl border border-zinc-300 px-6 py-2.5 text-sm font-semibold transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            {exportPercent !== null ? `Rendering ${exportPercent}% · cancel` : "Generate MP3"}
          </button>
        </div>
      </div>

      <div className="-mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={podcast}
            onChange={(e) => setPodcast(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          Podcast mode for MP3 — two voices alternate by paragraph
        </label>
        {podcast && (
          <select
            value={voice2}
            onChange={(e) => setVoice2(e.target.value)}
            aria-label="Second voice"
            className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {VOICES.filter((v) => v.id !== voice).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <ErrorBanner message={error} />

      {result && (
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <audio controls src={result.url} className="w-full" />
          <a
            href={result.url}
            download={result.name}
            className={`self-start rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 ${FOCUS_RING}`}
          >
            Download {result.name}
          </a>
        </div>
      )}
    </main>
  );
}
