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
import {
  createCaptureCheckpoint,
  normalizeTextValue,
  redactSensitivePaths,
  relayAbort,
  sanitizeRawMetadata,
  toIsoTimestamp,
  waitForAbortOrTimeout,
} from "./shared-runtime.ts";

export {
  createCaptureCheckpoint,
  normalizeTextValue,
  redactSensitivePaths,
  relayAbort,
  sanitizeRawMetadata,
  toIsoTimestamp,
  waitForAbortOrTimeout,
} from "./shared-runtime.ts";

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
