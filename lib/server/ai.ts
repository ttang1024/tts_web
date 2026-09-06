import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "./http-errors";

// ---------------------------------------------------------------------------
// Claude-backed document intelligence: summaries (with map-reduce for long
// documents), Q&A, outlines, and auto-tagging. All features share one client
// and degrade gracefully when ANTHROPIC_API_KEY isn't set.
// ---------------------------------------------------------------------------

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Rough chars-per-token for budgeting. ~4 chars/token is a safe overestimate of
// input size for English; other scripts use fewer chars per token, so this is
// conservative. We keep a single map-reduce chunk well under the model's window.
const CHARS_PER_CHUNK = 80_000; // ~20k tokens of input per chunk

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function client(): Anthropic {
  if (!aiEnabled()) {
    throw new AppError("AI summaries aren't configured. Set ANTHROPIC_API_KEY on the deployment to enable them.", 501);
  }
  return new Anthropic();
}

async function complete(
  anthropic: Anthropic,
  opts: { system: string; user: string; maxTokens?: number }
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (response.stop_reason === "refusal") {
    throw new AppError("The model declined this request.", 502);
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new AppError("The model returned an empty response.", 502);
  return text;
}

// Splits text into windows that fit a single request without exceeding the
// model's context, preferring paragraph boundaries.
function windows(text: string, size = CHARS_PER_CHUNK): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length > size && current) {
      parts.push(current);
      current = "";
    }
    if (p.length > size) {
      // A single huge paragraph: hard-split it.
      for (let i = 0; i < p.length; i += size) parts.push(p.slice(i, i + size));
    } else {
      current += (current ? "\n\n" : "") + p;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const SUMMARY_SYSTEM =
  "You summarize documents for a text-to-speech reading app. Write a single concise paragraph (3-5 sentences) capturing what the document is about and its key points, in the document's own language. Respond with the summary only — no preamble.";

// Summarizes a document. Long documents are summarized in a map-reduce pass:
// each window is summarized, then the partial summaries are condensed into one.
export async function summarize(text: string): Promise<string> {
  const anthropic = client();
  const chunks = windows(text);
  if (chunks.length === 1) {
    return complete(anthropic, { system: SUMMARY_SYSTEM, user: chunks[0] });
  }
  const partials = await Promise.all(
    chunks.map((chunk, i) =>
      complete(anthropic, {
        system:
          "Summarize this section of a longer document in 2-4 sentences, capturing its key points. Respond with the summary only.",
        user: `Section ${i + 1} of ${chunks.length}:\n\n${chunk}`,
      })
    )
  );
  return complete(anthropic, {
    system: SUMMARY_SYSTEM,
    user: `Combine these section summaries into one overall summary of the document:\n\n${partials.join(
      "\n\n"
    )}`,
  });
}

// Answers a question grounded in the document. Uses the first window for very
// long documents (a full RAG index is out of scope here).
export async function answerQuestion(text: string, question: string): Promise<string> {
  const anthropic = client();
  const context = windows(text)[0];
  return complete(anthropic, {
    system:
      "You answer questions about the provided document. Use only the document's content; if the answer isn't in it, say so. Be concise.",
    user: `Document:\n${context}\n\nQuestion: ${question}`,
    maxTokens: 1024,
  });
}

// Produces a short bulleted outline of the document's sections.
export async function outline(text: string): Promise<string> {
  const anthropic = client();
  const context = windows(text)[0];
  return complete(anthropic, {
    system:
      "Produce a concise outline of the document as a markdown bulleted list of its main sections or topics (no more than 10 items). Respond with the list only.",
    user: context,
    maxTokens: 1024,
  });
}

// Suggests 3-6 lowercase topic tags. Returns a normalized, deduped array.
export async function suggestTags(text: string): Promise<string[]> {
  const anthropic = client();
  const context = windows(text)[0];
  const raw = await complete(anthropic, {
    system:
      "Suggest 3 to 6 short topic tags for this document. Respond with a single line of comma-separated lowercase tags, no other text.",
    user: context,
    maxTokens: 100,
  });
  return [
    ...new Set(
      raw
        .split(/[,\n]/)
        .map((t) => t.trim().replace(/^[#-]\s*/, "").replace(/,/g, " ").toLowerCase())
        .filter((t) => t && t.length <= 30)
    ),
  ].slice(0, 6);
}

// Maps SDK/AI errors to an HTTP status + message for routes.
export function aiErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof AppError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 502, message: "The server's Anthropic API key is invalid." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: `AI request failed: ${err.message}` };
  }
  return { status: 500, message: err instanceof Error ? err.message : "AI request failed." };
}
