// A thrown AppError carries its own HTTP status; server/index.ts's
// app.onError formats it (and any other thrown Error) into {error} JSON once,
// instead of every route hand-rolling the same catch/format boilerplate.

export class AppError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function appErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof AppError) return { status: err.status, message: err.message };
  return { status: 500, message: err instanceof Error ? err.message : "Request failed." };
}
