// Client-side pre-validation of pasted links; /api/extract re-validates.
// Adds https:// when the scheme is missing so "example.com/article" works.
export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!/^https?:\/\/[^/\s.]+(\.[^/\s.]+)+(:\d+)?(\/|$)/i.test(withScheme)) return null;
  return withScheme;
}
