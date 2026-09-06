import { normalizeText } from "@/lib/shared";
import { resolveSource, resolveOcrLangs } from "@/lib/server/extract";
import { assertWithinLimit } from "@/lib/server/validate";
import { appErrorResponse } from "@/lib/server/http-errors";
import { EXTRACT_LIMIT, enforceLimit, rateLimitHeaders } from "@/lib/server/rate-limit";

// PDF/DOCX/EPUB parsing and OCR are Node-only, and OCR in particular can take
// a while on a first request (it downloads its language data).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Turns an uploaded file or a pasted web link into plain text. The library
// lives in the browser (IndexedDB), so unlike the monorepo's server this
// endpoint stores nothing — it just returns what it extracted.
export async function POST(request: Request): Promise<Response> {
  try {
    enforceLimit(request, "extract", EXTRACT_LIMIT);
    const formData = await request.formData();
    const ocrLangs = resolveOcrLangs((formData.get("ocr") as string) || null);
    const { name, sourceType, source, text: raw } = await resolveSource(formData, ocrLangs);

    const text = assertWithinLimit(normalizeText(raw));
    if (!text) {
      return Response.json(
        { error: "No readable text found in the document." },
        { status: 422 }
      );
    }
    return Response.json({ name, sourceType, source, text });
  } catch (err) {
    const { status, message } = appErrorResponse(err);
    return Response.json({ error: message }, { status, headers: rateLimitHeaders(err) });
  }
}
