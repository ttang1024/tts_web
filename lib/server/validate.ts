import { AppError } from "./http-errors";

// The character ceiling shared by every route that accepts document text
// (paste, upload, extraction, merge) — extracted so the limit and its error
// message can't drift between call sites.
export const MAX_CHARS = 100_000;

export function assertWithinLimit(text: string, max = MAX_CHARS): string {
  if (text.length > max) {
    throw new AppError(
      `Document has ${text.length.toLocaleString()} characters; the limit is ${max.toLocaleString()}.`,
      413
    );
  }
  return text;
}
