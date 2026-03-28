import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { generateUlid } from "@murph/runtime-state";

import {
  assertPathWithinVaultOnDisk,
  normalizeRelativeVaultPath,
  resolveVaultPathOnDisk,
} from "@murph/core";

import type { StoredAttachment } from "./contracts/capture.ts";

export function toIsoTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid ISO timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

export function generatePrefixedId(prefix: string, now = Date.now()): string {
  return `${sanitizeObjectKey(prefix, "rec")}_${generateUlid(now)}`;
}

export function buildAttachmentId(captureId: string, ordinal: number): string {
  return `att_${captureId}_${String(ordinal).padStart(2, "0")}`;
}

export function normalizeStoredAttachments(
  captureId: string,
  attachments: ReadonlyArray<StoredAttachment>,
  context = `stored attachments for capture "${captureId}"`,
): StoredAttachment[] {
  if (!Array.isArray(attachments)) {
    throw new TypeError(`Expected canonical attachment array in ${context}.`);
  }

  const normalized: StoredAttachment[] = [];
  const seenAttachmentIds = new Set<string>();
  const seenOrdinals = new Set<number>();

  for (const [index, attachment] of attachments.entries()) {
    const attachmentContext = `${context} at index ${index}`;
    const attachmentId =
      typeof attachment?.attachmentId === "string" && attachment.attachmentId.length > 0
        ? attachment.attachmentId
        : null;
    const ordinal =
      typeof attachment?.ordinal === "number" &&
      Number.isSafeInteger(attachment.ordinal) &&
      attachment.ordinal > 0
        ? attachment.ordinal
        : null;

    if (!attachmentId) {
      throw new TypeError(`Missing canonical "attachmentId" in ${attachmentContext}.`);
    }

    if (!ordinal) {
      throw new TypeError(`Missing canonical "ordinal" in ${attachmentContext}.`);
    }

    if (seenAttachmentIds.has(attachmentId)) {
      throw new TypeError(`Duplicate canonical "attachmentId" "${attachmentId}" in ${context}.`);
    }

    if (seenOrdinals.has(ordinal)) {
      throw new TypeError(`Duplicate canonical "ordinal" ${ordinal} in ${context}.`);
    }

    seenAttachmentIds.add(attachmentId);
    seenOrdinals.add(ordinal);
    normalized.push({
      ...attachment,
      attachmentId,
      ordinal,
    });
  }

  return normalized;
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
const SENSITIVE_EXACT_RAW_KEYS = new Set([
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
const SENSITIVE_COLLAPSED_SUBSTRINGS = [
  "authorization",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "sessionid",
  "apikey",
  "privatekey",
  "clientsecret",
  "oauthtoken",
  "idtoken",
] as const;
const SENSITIVE_TOKENIZED_PART_KEYS = [
  "authorization",
  "cookie",
  "secret",
  "session",
  "credential",
  "credentials",
  "password",
  "passwd",
] as const;
type SensitivePartCombinationRule = {
  required: readonly string[];
  anyOf: readonly string[];
  allowOnlyRequired?: boolean;
};
const SENSITIVE_PART_COMBINATION_RULES: readonly SensitivePartCombinationRule[] = [
  {
    required: ["token"],
    anyOf: ["access", "refresh", "api", "auth", "oauth", "session", "id", "bearer", "csrf"],
    allowOnlyRequired: true,
  },
  {
    required: ["key"],
    anyOf: ["api", "private", "client"],
  },
] as const;
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

export function relayAbort(signal: AbortSignal, controller: AbortController): () => void {
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function waitForAbortOrTimeout(
  signal: AbortSignal,
  milliseconds: number,
): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  const collapsed = collapseRawKey(key);

  if (!collapsed) {
    return false;
  }

  if (SENSITIVE_EXACT_RAW_KEYS.has(collapsed)) {
    return true;
  }

  if (SENSITIVE_COLLAPSED_SUBSTRINGS.some((pattern) => collapsed.includes(pattern))) {
    return true;
  }

  const parts = tokenizeRawKeyParts(key);
  const partSet = new Set(parts);

  if (SENSITIVE_TOKENIZED_PART_KEYS.some((part) => partSet.has(part))) {
    return true;
  }

  return SENSITIVE_PART_COMBINATION_RULES.some((rule) =>
    matchesSensitivePartCombinationRule(parts, partSet, rule),
  );
}

function looksSensitiveStringValue(value: string): boolean {
  return SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function collapseRawKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function tokenizeRawKeyParts(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((part) => part.length > 0);
}

function matchesSensitivePartCombinationRule(
  parts: ReadonlyArray<string>,
  partSet: ReadonlySet<string>,
  rule: SensitivePartCombinationRule,
): boolean {
  if (!rule.required.every((part) => partSet.has(part))) {
    return false;
  }

  if (rule.allowOnlyRequired && parts.length === rule.required.length) {
    return true;
  }

  return rule.anyOf.some((part) => partSet.has(part));
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
  if (error instanceof Error) {
    return new TypeError(error.message);
  }

  return new TypeError(String(error));
}
