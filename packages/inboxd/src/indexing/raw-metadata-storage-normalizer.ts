import { redactSensitivePaths } from "../shared.ts";

export function normalizeRawMetadataForStorage(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = removeRawSizeMetadata(redactSensitivePaths(raw));

  return isRecord(normalized) ? normalized : {};
}

function removeRawSizeMetadata(value: unknown): unknown {
  if (typeof value === "string" && /^<\d+ bytes>$/u.test(value)) {
    return "<REDACTED_BYTES>";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => removeRawSizeMetadata(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const entries: Array<[string, unknown]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (isRawSizeMetadataKey(key)) {
      continue;
    }

    entries.push([key, removeRawSizeMetadata(entry)]);
  }

  return Object.fromEntries(entries);
}

function isRawSizeMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (/(?:^|[-_])(?:byte|bytes|filesize|size)(?:[-_]|$)/u.test(normalized)) {
    return true;
  }

  const compact = normalized.replace(/[-_]/g, "");
  return (
    compact === "contentlength" ||
    compact.endsWith("byte") ||
    compact.endsWith("bytes") ||
    compact.endsWith("bytelength") ||
    compact.endsWith("bytesize") ||
    compact.endsWith("filesize") ||
    compact.endsWith("rawsize") ||
    compact.endsWith("contentlength")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
