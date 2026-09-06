import { normalizeText, stripMarkdown, chunkText } from "@/lib/shared";
import { resolveSource, isMarkdownSource, resolveOcrLangs } from "@/lib/server/extract";
import { assertWithinLimit } from "@/lib/server/validate";
import { appErrorResponse } from "@/lib/server/http-errors";
import {
  DOCUMENT_LIMIT,
  SENTENCE_LIMIT,
  enforceLimit,
  rateLimitHeaders,
} from "@/lib/server/rate-limit";
import {
  planJobs,
  planPodcastJobs,
  streamSynthesis,
  synthesizeAll,
  synthesizeSentence,
} from "@/lib/server/synth";

// Synthesis opens outbound websockets and uses Node streams, so this route
// runs on the Node.js runtime (the default). Long documents are streamed as
// they render, but the ceiling still has to cover a slow first chunk.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_VOICE = "en-US-AriaNeural";

export async function POST(request: Request): Promise<Response> {
  try {
    // JSON body: synthesize a short snippet (one sentence of the online
    // reader) and return it inline with word timings for highlighting.
    if (request.headers.get("content-type")?.includes("application/json")) {
      enforceLimit(request, "tts:sentence", SENTENCE_LIMIT);
      const { text, voice: rawVoice } = await request.json();
      if (typeof text !== "string" || !text.trim()) {
        return Response.json({ error: "No text to speak." }, { status: 400 });
      }
      const voice = typeof rawVoice === "string" && rawVoice ? rawVoice : DEFAULT_VOICE;
      const normalized = normalizeText(text);

      // Word timings only line up within a single synthesis request; the rare
      // sentence too long for one chunk falls back to plain audio.
      if (chunkText(normalized).length > 1) {
        const mp3 = await synthesizeAll(planJobs(normalized, voice));
        return Response.json({ audio: mp3.toString("base64"), words: [] });
      }
      const { mp3, words } = await synthesizeSentence(normalized, voice);
      return Response.json({ audio: mp3.toString("base64"), words });
    }

    // A whole-document render is a far heavier request than a sentence, and
    // gets its own much smaller budget.
    enforceLimit(request, "tts:document", DOCUMENT_LIMIT);

    const formData = await request.formData();
    const voice = (formData.get("voice") as string) || DEFAULT_VOICE;
    const mode = formData.get("mode");
    const voice2 = (formData.get("voice2") as string) || null;
    // OCR language(s) for image uploads: explicit codes, or inferred from the
    // chosen voice's language. Always falls back to English.
    const ocrLangs = resolveOcrLangs(
      (formData.get("ocr") as string) || voice.split("-")[0]
    );

    const resolved = await resolveSource(formData, ocrLangs, formData.get("text"));
    // The client extracts first (so it can file the document in its own local
    // library) and then posts the plain text here, which loses the original
    // filename. `name` and `source` carry it back, so the download is still
    // named after the document and Markdown is still recognised as Markdown.
    const nameOverride = formData.get("name");
    const sourceOverride = formData.get("source");
    const baseName =
      typeof nameOverride === "string" && nameOverride.trim()
        ? nameOverride.trim()
        : resolved.name;
    const source =
      typeof sourceOverride === "string" && sourceOverride ? sourceOverride : resolved.source;

    const text = assertWithinLimit(normalizeText(resolved.text));
    if (!text) {
      return Response.json(
        { error: "No readable text found in the document." },
        { status: 422 }
      );
    }

    // Markdown documents are synthesized without their symbols, so the
    // synthesizer never reads "#" or "*" aloud.
    const speech = isMarkdownSource(source) ? normalizeText(stripMarkdown(text)) : text;
    const podcast = mode === "podcast" && voice2 && voice2 !== voice;
    const jobs = podcast
      ? planPodcastJobs(speech, voice, voice2)
      : planJobs(speech, voice);

    // Stream chunks as they're synthesized so the download starts immediately
    // rather than buffering the whole file in the function first.
    return new Response(streamSynthesis(jobs), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(baseName)}.mp3"`,
      },
    });
  } catch (err) {
    const { status, message } = appErrorResponse(err);
    return Response.json({ error: message }, { status, headers: rateLimitHeaders(err) });
  }
}
