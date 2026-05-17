export function normalizeHostedFutureWakeAt(
  value: string | null,
  nowMs: number,
): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs) || parsedMs <= nowMs) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}
