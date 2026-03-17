import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  assertPathWithinVaultOnDisk,
  isVaultError,
  normalizeRelativeVaultPath,
  resolveVaultPathOnDisk,
} from "@healthybob/core";

import type { StoredAttachment } from "./contracts/capture.js";

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

export function buildLegacyAttachmentId(captureId: string, ordinal: number): string {
  return `att_${captureId}_${String(ordinal).padStart(2, "0")}`;
}

export function normalizeStoredAttachments(
  captureId: string,
  attachments: ReadonlyArray<StoredAttachment>,
): StoredAttachment[] {
  return attachments.map((attachment, index) => ({
    ...attachment,
    attachmentId:
      typeof attachment.attachmentId === "string" && attachment.attachmentId.length > 0
        ? attachment.attachmentId
        : buildLegacyAttachmentId(captureId, attachment.ordinal ?? index + 1),
    ordinal: attachment.ordinal ?? index + 1,
  }));
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
const REDACTED_PATH = "<REDACTED_PATH>";
const REDACTED_SECRET = "<REDACTED_SECRET>";
const SENSITIVE_RAW_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "apitoken",
  "auth",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "csrftoken",
  "idtoken",
  "oauthtoken",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "session",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "token",
]);
const SENSITIVE_STRING_PATTERNS = [
  /^\s*(bearer|basic|digest)\s+\S+/iu,
  /\b(authorization|cookie|set-cookie|access_token|refresh_token|api[_-]?key|session(?:[_-]?(?:id|token))?|secret)\b\s*[:=]\s*\S+/iu,
];

export function normalizeRelativePath(relativePath: string): string {
  try {
    return normalizeRelativeVaultPath(relativePath);
  } catch (error) {
    throw toTypeError(error);
  }
}

export async function resolveVaultPath(vaultRoot: string, relativePath: string): Promise<string> {
  try {
    const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath);
    return resolved.absolutePath;
  } catch (error) {
    throw toTypeError(error);
  }
}

export async function assertVaultPathOnDisk(vaultRoot: string, absolutePath: string): Promise<void> {
  try {
    await assertPathWithinVaultOnDisk(vaultRoot, absolutePath);
  } catch (error) {
    throw toTypeError(error);
  }
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

export function mapObjectEntries(
  value: object,
  mapEntry: (key: string, entry: unknown) => [string, unknown],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => mapEntry(key, entry)));
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

export function createInboxCaptureIdentityKey(input: {
  source: string;
  accountId?: string | null;
  externalId: string;
}): string {
  return [
    input.source,
    normalizeAccountKey(input.accountId),
    input.externalId,
  ].join("\u0000");
}

export function createDeterministicInboxCaptureId(input: {
  source: string;
  accountId?: string | null;
  externalId: string;
}): string {
  return `cap_${createHash("sha256").update(createInboxCaptureIdentityKey(input)).digest("hex").slice(0, 26)}`;
}

export function sanitizeRawMetadata(value: unknown): unknown {
  return sanitizeRawMetadataValue(value);
}

export function redactSensitivePaths(value: unknown): unknown {
  return sanitizeRawMetadataValue(value);
}

function sanitizeRawMetadataValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeRawMetadataValue(entry);
      return sanitizedEntry === undefined ? null : sanitizedEntry;
    });
  }

  if (value && typeof value === "object") {
    const sanitizedEntries: Array<[string, unknown]> = [];

    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveRawKey(key)) {
        sanitizedEntries.push([key, REDACTED_SECRET]);
        continue;
      }

      const sanitizedEntry = sanitizeRawMetadataValue(entry);
      if (sanitizedEntry !== undefined) {
        sanitizedEntries.push([key, sanitizedEntry]);
      }
    }

    return Object.fromEntries(sanitizedEntries);
  }

  if (typeof value === "string") {
    if (looksSensitiveStringValue(value)) {
      return REDACTED_SECRET;
    }

    return USER_PATH_PATTERNS.some((pattern) => pattern.test(value))
      ? REDACTED_PATH
      : value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }

  return value;
}

function isSensitiveRawKey(key: string): boolean {
  const collapsed = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  if (!collapsed) {
    return false;
  }

  if (SENSITIVE_RAW_KEYS.has(collapsed)) {
    return true;
  }

  if (collapsed.includes("authorization") || collapsed.includes("setcookie")) {
    return true;
  }

  if (
    collapsed.includes("accesstoken") ||
    collapsed.includes("refreshtoken") ||
    collapsed.includes("sessiontoken") ||
    collapsed.includes("sessionid") ||
    collapsed.includes("apikey") ||
    collapsed.includes("privatekey") ||
    collapsed.includes("clientsecret") ||
    collapsed.includes("oauthtoken") ||
    collapsed.includes("idtoken")
  ) {
    return true;
  }

  const parts = key
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((part) => part.length > 0);
  const partSet = new Set(parts);

  if (
    partSet.has("authorization") ||
    partSet.has("cookie") ||
    partSet.has("secret") ||
    partSet.has("session") ||
    partSet.has("credential") ||
    partSet.has("credentials") ||
    partSet.has("password") ||
    partSet.has("passwd")
  ) {
    return true;
  }

  if (
    partSet.has("token") &&
    (
      parts.length === 1 ||
      partSet.has("access") ||
      partSet.has("refresh") ||
      partSet.has("api") ||
      partSet.has("auth") ||
      partSet.has("oauth") ||
      partSet.has("session") ||
      partSet.has("id") ||
      partSet.has("bearer") ||
      partSet.has("csrf")
    )
  ) {
    return true;
  }

  return partSet.has("key") && (partSet.has("api") || partSet.has("private") || partSet.has("client"));
}

function looksSensitiveStringValue(value: string): boolean {
  return SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export async function walkNamedFiles(
  directory: string,
  fileName: string,
  options?: {
    skipDirectories?: ReadonlyArray<string>;
  },
): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  const skipDirectories = new Set(options?.skipDirectories ?? []);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name)) {
        continue;
      }

      files.push(...(await walkNamedFiles(absolutePath, fileName, options)));
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      files.push(absolutePath);
    }
  }

  return files;
}

function toTypeError(error: unknown): Error {
  if (isVaultError(error)) {
    return new TypeError(error.message);
  }

  return error instanceof Error ? error : new TypeError(String(error));
}
