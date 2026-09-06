import mammoth from "mammoth";
import { safeFetch } from "./net";
import { AppError } from "./http-errors";

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv"]);

// Whether a filename/source is Markdown, so its synthesized speech can be
// stripped of Markdown symbols.
export function isMarkdownSource(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown)$/i.test(name);
}
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]);

// Tesseract language codes we allow clients to request for OCR. Language data
// is downloaded once per code and cached on disk. Defaults to English.
const SUPPORTED_OCR_LANGS = new Set([
  "eng", "chi_sim", "chi_tra", "spa", "fra", "deu", "ita",
  "por", "rus", "jpn", "kor", "hin", "ara",
]);
const DEFAULT_OCR_LANGS = ["eng"];

// Maps a BCP-47 voice language prefix (see shared/voices) to a Tesseract code,
// so the client can pass the reading voice and get matching OCR.
const OCR_LANG_BY_VOICE_LANG: Record<string, string> = {
  en: "eng", zh: "chi_sim", es: "spa", fr: "fra", de: "deu", it: "ita",
  pt: "por", ru: "rus", ja: "jpn", ko: "kor", hi: "hin", ar: "ara",
};

// Resolves a requested OCR language list (Tesseract codes or voice-language
// prefixes), always including English as a fallback for mixed-script docs.
export function resolveOcrLangs(requested?: string | string[] | null): string[] {
  const raw = Array.isArray(requested)
    ? requested
    : (requested ?? "").split(/[,\s]+/);
  const langs = new Set<string>();
  for (const item of raw) {
    const code = item.trim().toLowerCase();
    if (!code) continue;
    if (SUPPORTED_OCR_LANGS.has(code)) langs.add(code);
    else if (OCR_LANG_BY_VOICE_LANG[code]) langs.add(OCR_LANG_BY_VOICE_LANG[code]);
  }
  if (langs.size === 0) return DEFAULT_OCR_LANGS;
  langs.add("eng");
  return [...langs];
}

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/gi, "&");
}

// Heuristic HTML-to-text: prefer the marked-up article content, drop page
// chrome, and keep paragraph boundaries so the reader can segment properly.
function htmlToText(html: string): { title: string | null; text: string } {
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null;

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ");

  const main = body.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0];
  if (main) body = main;
  body = body.replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ");

  const text = decodeEntities(
    body
      .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );

  return { title: title ? decodeEntities(title) : null, text };
}

// PDF extractions are full of page chrome that's painful to listen to:
// standalone page numbers, "Page 3 of 12", and headers/footers repeated on
// every page. Drop the obvious noise, keep everything else.
function stripPdfNoise(text: string): string {
  const lines = text.split("\n");
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    if (key && key.length <= 80) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\d{1,4}$/.test(trimmed)) return false;
      if (/^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(trimmed)) return false;
      // A short line repeated on 3+ pages is a running header/footer.
      if (trimmed.length <= 80 && (counts.get(trimmed) ?? 0) >= 3 && !/[.!?。！？]$/.test(trimmed))
        return false;
      return true;
    })
    .join("\n");
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return stripPdfNoise(text);
}

// EPUBs are zip archives of XHTML chapters; read them in spine order and
// reuse the HTML-to-text pipeline.
async function extractEpub(buffer: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);

  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async("string") : null;

  let chapterPaths: string[];
  if (opf && opfPath) {
    const baseDir = opfPath.includes("/") ? opfPath.replace(/[^/]+$/, "") : "";
    const hrefById = new Map<string, string>();
    for (const item of opf.matchAll(/<item\s[^>]*>/gi)) {
      const id = item[0].match(/\bid="([^"]+)"/)?.[1];
      const href = item[0].match(/\bhref="([^"]+)"/)?.[1];
      if (id && href) hrefById.set(id, href);
    }
    chapterPaths = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/gi)]
      .map((m) => hrefById.get(m[1]))
      .filter((href): href is string => !!href)
      .map((href) => baseDir + decodeURIComponent(href.split("#")[0]));
  } else {
    // No usable manifest; fall back to every HTML file in archive order.
    chapterPaths = Object.keys(zip.files).filter((name) => /\.x?html?$/i.test(name));
  }

  const chapters: string[] = [];
  for (const chapterPath of chapterPaths) {
    const html = await zip.file(chapterPath)?.async("string");
    if (!html) continue;
    const { text } = htmlToText(html);
    if (text.trim()) chapters.push(text);
  }
  if (chapters.length === 0) throw new AppError("No readable chapters found in the EPUB.", 422);
  return chapters.join("\n\n");
}

// OCR spawns heavyweight worker threads; serialize requests so concurrent
// image uploads don't pile up workers.
let ocrQueue: Promise<unknown> = Promise.resolve();
function enqueueOcr<T>(job: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => {});
  return run;
}

async function extractImage(buffer: Buffer, langs = DEFAULT_OCR_LANGS): Promise<string> {
  return enqueueOcr(async () => {
    const { createWorker } = await import("tesseract.js");
    // Language data is cached in /tmp after the first request.
    const worker = await createWorker(langs, undefined, { cachePath: "/tmp" });
    try {
      const { data } = await worker.recognize(buffer);
      return data.text;
    } finally {
      await worker.terminate();
    }
  });
}

// Fetches a pasted web link and extracts readable text (HTML article, PDF,
// or plain text).
export async function extractFromUrl(
  rawUrl: string
): Promise<{ name: string; text: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError("That doesn't look like a valid link.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("Only http(s) links are supported.", 400);
  }

  let res: Response;
  try {
    // safeFetch validates the host (and every redirect hop) against private,
    // loopback, and link-local ranges before each request — see lib/net.
    res = await safeFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DocumentToSpeech/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/pdf,text/*;q=0.9,*/*;q=0.8",
      },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    // Surface the SSRF guard's specific message; hide generic network errors.
    if (err instanceof Error && /non-public|resolve|unsupported scheme|redirects/i.test(err.message)) {
      throw new AppError(err.message, 400);
    }
    throw new AppError("Couldn't reach that link.", 502);
  }
  if (!res.ok) throw new AppError(`Couldn't fetch the link (${res.status}).`, 502);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new AppError("The page is too large (over 10 MB).", 413);
  }

  const type = res.headers.get("content-type") ?? "";
  const fallbackName = url.hostname.replace(/^www\./, "");

  if (type.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf")) {
    const base = url.pathname.split("/").pop()?.replace(/\.pdf$/i, "");
    return { name: base || fallbackName, text: await extractPdf(buffer) };
  }

  const raw = buffer.toString("utf-8");
  if (type.includes("html") || /^\s*(<!doctype html|<html)/i.test(raw)) {
    const { title, text } = htmlToText(raw);
    return { name: (title || fallbackName).slice(0, 80), text };
  }
  if (type.startsWith("text/") || !type) {
    return { name: fallbackName, text: raw };
  }
  throw new AppError(`Unsupported content type "${type.split(";")[0]}".`, 415);
}

export type ResolvedSource = {
  text: string;
  name: string;
  sourceType: "url" | "file" | "text";
  source: string | null;
};

// Resolves the "url, file, or pasted text" input shared by /api/extract and
// /api/tts: whichever field is present wins, in that order. `pastedText` is
// optional since /api/extract never accepts plain text.
export async function resolveSource(
  formData: FormData,
  ocrLangs: string[],
  pastedText?: string | File | null
): Promise<ResolvedSource> {
  const url = formData.get("url");
  const file = formData.get("file");

  if (typeof url === "string" && url.trim()) {
    const { name, text } = await extractFromUrl(url);
    return { text, name, sourceType: "url", source: url };
  }
  if (file instanceof File && file.size > 0) {
    const text = await extractText(file, ocrLangs);
    const name = file.name.replace(/\.[^.]+$/, "") || "document";
    return { text, name, sourceType: "file", source: file.name };
  }
  if (typeof pastedText === "string" && pastedText.trim()) {
    return { text: pastedText, name: "speech", sourceType: "text", source: null };
  }
  throw new AppError(
    pastedText === undefined
      ? "Upload a document or provide a link."
      : "Upload a document, paste some text, or provide a link.",
    400
  );
}

export async function extractText(file: File, ocrLangs?: string[]): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());

  if (ext === "pdf") {
    return extractPdf(buffer);
  }

  if (ext === "epub") {
    return extractEpub(buffer);
  }

  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith("image/")) {
    return extractImage(buffer, ocrLangs ?? DEFAULT_OCR_LANGS);
  }

  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  throw new AppError(
    `Unsupported file type ".${ext}". Use .txt, .md, .csv, .pdf, .docx, .epub, or an image — for web pages, paste the link instead.`,
    415
  );
}
