import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function toIsoTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.toISOString();

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid ISO timestamp: ${String(value)}`);
  }

  return timestamp;
}

function encodeCrockford(value: number, length: number): string {
  let remainder = value;
  let encoded = "";

  do {
    encoded = CROCKFORD[remainder % 32] + encoded;
    remainder = Math.floor(remainder / 32);
  } while (remainder > 0);

  return encoded.padStart(length, "0").slice(-length);
}

function encodeRandomPart(length: number): string {
  const bytes = randomBytes(length);
  let encoded = "";

  for (const byte of bytes) {
    encoded += CROCKFORD[byte % 32];
    if (encoded.length === length) {
      break;
    }
  }

  return encoded.slice(0, length);
}

function generateUlid(now = Date.now()): string {
  return `${encodeCrockford(now, 10)}${encodeRandomPart(16)}`;
}

export function generatePrefixedId(prefix: string, now = Date.now()): string {
  return `${sanitizeObjectKey(prefix, "rec")}_${generateUlid(now)}`;
}

export function sanitizeObjectKey(value: unknown, fallback = "field"): string {
  return sanitizeSegment(value, fallback).replace(/-/g, "_");
}

export function sanitizeSegment(value: unknown, fallback = "item"): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || fallback;
}

export function sanitizeFileName(fileName: unknown, fallback = "artifact"): string {
  const parsed = path.posix.parse(path.posix.basename(String(fileName ?? "")));
  const stem = sanitizeSegment(parsed.name, fallback);
  const ext = parsed.ext.toLowerCase().replace(/[^.a-z0-9]+/g, "");
  return `${stem}${ext}`;
}

const USER_PATH_PATTERNS = [
  /^\/Users\/[^/]+/u,
  /^\/home\/[^/]+/u,
  /^[A-Za-z]:\\Users\\[^\\]+/u,
];

export function normalizeRelativePath(relativePath: string): string {
  const candidate = relativePath.trim().replace(/\\/g, "/");

  if (!candidate) {
    throw new TypeError("Vault-relative path is required.");
  }

  if (candidate.includes("\u0000")) {
    throw new TypeError("Vault-relative path may not contain NUL bytes.");
  }

  if (/^[A-Za-z]:\//u.test(candidate) || path.posix.isAbsolute(candidate)) {
    throw new TypeError("Vault-relative path must not be absolute.");
  }

  const normalized = path.posix.normalize(candidate);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new TypeError("Vault-relative path may not escape the vault root.");
  }

  return normalized;
}

export function resolveVaultPath(vaultRoot: string, relativePath: string): string {
  const absoluteRoot = path.resolve(vaultRoot);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(absoluteRoot, normalizedRelativePath);
  const relative = path.relative(absoluteRoot, absolutePath);

  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new TypeError("Resolved path escaped the vault root.");
  }

  return absolutePath;
}

export function createCaptureCheckpoint(capture: {
  occurredAt: string;
  externalId: string;
  receivedAt?: string | null;
}): Record<string, unknown> {
  return {
    occurredAt: capture.occurredAt,
    externalId: capture.externalId,
    receivedAt: capture.receivedAt ?? null,
  };
}

export function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function buildFtsQuery(text: string): string {
  const tokens = tokenizeSearchText(text);

  if (tokens.length === 0) {
    return "";
  }

  return tokens.map((token) => `"${token.replace(/"/g, "\"\"")}"*`).join(" AND ");
}

export function normalizeTextValue(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

export function buildSnippet(...sources: Array<string | null | undefined>): string {
  for (const source of sources) {
    const value = normalizeTextValue(source);
    if (value) {
      return value.length > 180 ? `${value.slice(0, 177)}...` : value;
    }
  }

  return "";
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeAccountKey(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

export function redactSensitivePaths(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitivePaths(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactSensitivePaths(entry)]),
    );
  }

  if (typeof value === "string") {
    return USER_PATH_PATTERNS.some((pattern) => pattern.test(value))
      ? "<REDACTED_PATH>"
      : value;
  }

  return value;
}

export async function walkFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}
