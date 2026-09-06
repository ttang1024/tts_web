import { aiEnabled, aiErrorResponse, summarize } from "@/lib/server/ai";
import { assertWithinLimit } from "@/lib/server/validate";
import { SUMMARY_LIMIT, enforceLimit, rateLimitHeaders } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Optional: summarizes a document's text with Claude. The library lives in the
// browser, so the client posts the text it already has and stores the summary
// it gets back. Without ANTHROPIC_API_KEY the app works exactly as before —
// GET reports that so the UI can hide the button instead of offering a feature
// that will fail.
export async function GET(): Promise<Response> {
  return Response.json({ enabled: aiEnabled() });
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Summaries spend the deployment's own Anthropic credits, so this is the
    // route that most needs a ceiling.
    enforceLimit(request, "summary", SUMMARY_LIMIT);
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return Response.json({ error: "No text to summarize." }, { status: 400 });
    return Response.json({ summary: await summarize(assertWithinLimit(text)) });
  } catch (err) {
    const { status, message } = aiErrorResponse(err);
    return Response.json({ error: message }, { status, headers: rateLimitHeaders(err) });
  }
}
