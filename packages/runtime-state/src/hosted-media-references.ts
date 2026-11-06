import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAssistantStatePaths } from "./assistant-state.ts";

export const HOSTED_MEDIA_REFS_SCHEMA = "murph.hosted-media-refs.v1";
export const HOSTED_MEDIA_REFS_RELATIVE_PATH = ".runtime/operations/assistant/hosted-media-refs.json";

export interface HostedMediaReference {
  byteSize: number;
  expiresAt: string | null;
  mediaId: string;
  mediaKind: "image" | "video" | "integration-ingest";
  mimeType: string | null;
  pendingUpload?: boolean;
  retirementPending?: boolean;
  uploadAttempts?: number;
  recordedAt: string;
  relativePath: string;
  sha256: string;
}

export interface HostedMediaReferenceCatalogue {
  schema: typeof HOSTED_MEDIA_REFS_SCHEMA;
  entries: HostedMediaReference[];
  mealUploadCursor?: string;
}

export class HostedMediaReferenceUnavailableError extends Error {
  readonly code = "HOSTED_MEDIA_REFERENCE_UNAVAILABLE";
  readonly retryable = true;
  constructor() {
    super("Hosted media catalogue is unavailable or contains an invalid descriptor.");
    this.name = "HostedMediaReferenceUnavailableError";
  }
}

export function isHostedMealMediaV2Path(relativePath: string): boolean {
  return /^raw\/meals\/.+\/thumbnail-v2-[a-zA-Z0-9_-]+\.jpg$/u.test(relativePath);
}

// Legacy absence means settled, except for the deployed thumbnail-v2 retry seam.
export function hostedMediaPendingUpload(relativePath: string, pendingUpload?: boolean): boolean | undefined {
  return pendingUpload ?? (isHostedMealMediaV2Path(relativePath) ? true : undefined);
}

export function parseHostedMediaReference(value: unknown): HostedMediaReference {
  if (!isRecord(value)) throw new HostedMediaReferenceUnavailableError();
  const identity = parseHostedMediaIdentity(value);
  if (value.pendingUpload !== undefined && typeof value.pendingUpload !== "boolean") {
    throw new HostedMediaReferenceUnavailableError();
  }
  if (value.retirementPending !== undefined && typeof value.retirementPending !== "boolean") {
    throw new HostedMediaReferenceUnavailableError();
  }
  if (value.uploadAttempts !== undefined && (typeof value.uploadAttempts !== "number"
    || !Number.isSafeInteger(value.uploadAttempts) || value.uploadAttempts < 0)) {
    throw new HostedMediaReferenceUnavailableError();
  }
  const pendingUpload = hostedMediaPendingUpload(identity.relativePath, value.pendingUpload as boolean | undefined);
  return {
    ...identity,
    expiresAt: parseMediaExpiry(value.expiresAt),
    mimeType: normalizeMediaMimeType(value.mimeType),
    ...(pendingUpload === undefined ? {} : { pendingUpload }),
    ...(value.retirementPending === undefined ? {} : { retirementPending: value.retirementPending as boolean }),
    ...(value.uploadAttempts === undefined ? {} : { uploadAttempts: value.uploadAttempts as number }),
    recordedAt: normalizeMediaRecordedAt(value.recordedAt),
  };
}

function isRetainedPhotoPath(relativePath: string): boolean {
  return relativePath.startsWith("raw/meals/") || relativePath.startsWith("raw/measurements/");
}

// This reader sits on the checkpoint path, so a stray deployed entry must not
// stop a member's data being saved. Inbox and capture entries have always been
// filtered here. Photo and cold references can be a sole copy and fail closed.
function parseCatalogueEntry(value: unknown): HostedMediaReference | null {
  try {
    return parseHostedMediaReference(value);
  } catch (error) {
    if (isRecord(value) && (value.mediaKind === "image" || value.mediaKind === "video")
      && typeof value.relativePath === "string" && /^raw\/(?:inbox|captures)\//u.test(value.relativePath)) return null;
    throw error;
  }
}

function parseHostedMediaIdentity(value: Record<string, unknown>): Pick<HostedMediaReference,
  "relativePath" | "mediaId" | "sha256" | "byteSize" | "mediaKind"> {
  const cold = parseHostedColdIngestReference(value);
  if (cold) return cold;
  if (!isCanonicalMediaPath(value.relativePath)
    || (value.mediaKind !== "image" && value.mediaKind !== "video")
    || !isDigest(value.mediaId) || !isDigest(value.sha256)
    || typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0) {
    throw new HostedMediaReferenceUnavailableError();
  }
  return { relativePath: value.relativePath, mediaId: value.mediaId, sha256: value.sha256,
    byteSize: value.byteSize, mediaKind: value.mediaKind };
}

function normalizeMediaMimeType(value: unknown): string | null {
  return typeof value === "string" && value.trim().length <= 128
    ? value.trim().toLowerCase() || null : null;
}

function normalizeMediaRecordedAt(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : new Date(0).toISOString();
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalMediaPath(value: unknown): value is string {
  return typeof value === "string" && /^raw\/(inbox|captures|meals|measurements)\/.+/u.test(value)
    && !value.includes("\\") && !/[\x00-\x1f\x7f]/u.test(value)
    && value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}

function parseMediaExpiry(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new HostedMediaReferenceUnavailableError();
  return new Date(value).toISOString();
}

export interface HostedColdIngestReference {
  byteSize: number;
  expiresAt: null;
  mediaId: string;
  mediaKind: "integration-ingest";
  relativePath: string;
  sha256: string;
}

export class HostedColdHistoryUnavailableError extends Error {
  readonly code = "HOSTED_COLD_HISTORY_UNAVAILABLE";
  readonly retryable = true;
  constructor(options?: ErrorOptions) {
    super("Cold integration-ingest history is unavailable or failed integrity verification. Retry with the hosted workspace materializer before reading or exporting history.", options);
    this.name = "HostedColdHistoryUnavailableError";
  }
}

export function hostedColdIngestMonth(relativePath: string): string | null {
  const match = /^ledger\/integration-ingests\/(\d{4})\/(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl\.br$/u.exec(relativePath);
  return match && match[1] === match[2]?.slice(0, 4) ? match[2] : null;
}

export function resolveHostedMediaReferenceCataloguePath(vaultRoot: string): string {
  return path.join(resolveAssistantStatePaths(path.resolve(vaultRoot)).assistantStateRoot, "hosted-media-refs.json");
}

// Missing catalogues are old, inline snapshots. Unreadable catalogues are never
// equivalent to an empty history inventory.
export async function readHostedMediaReferenceCatalogueValue(vaultRoot: string): Promise<HostedMediaReferenceCatalogue> {
  let raw: string;
  try {
    raw = await readFile(resolveHostedMediaReferenceCataloguePath(vaultRoot), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [] };
    }
    throw new HostedColdHistoryUnavailableError();
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schema !== HOSTED_MEDIA_REFS_SCHEMA || !Array.isArray(value.entries)) {
      throw new HostedColdHistoryUnavailableError();
    }
    const byPath = new Map<string, HostedMediaReference>();
    for (const value_ of value.entries) {
      const entry = parseCatalogueEntry(value_);
      if (!entry) continue;
      if (byPath.has(entry.relativePath)) {
        if (entry.mediaKind === "integration-ingest") throw new HostedColdHistoryUnavailableError();
        if (isRetainedPhotoPath(entry.relativePath)) throw new HostedMediaReferenceUnavailableError();
        continue;
      }
      byPath.set(entry.relativePath, entry);
    }
    const entries = [...byPath.values()];
    return { schema: HOSTED_MEDIA_REFS_SCHEMA, entries,
      ...(typeof value.mealUploadCursor === "string" ? { mealUploadCursor: value.mealUploadCursor } : {}) };
  } catch (error) {
    if (error instanceof HostedMediaReferenceUnavailableError) throw error;
    throw new HostedColdHistoryUnavailableError();
  }
}

export function parseHostedColdIngestReference(value: unknown): HostedColdIngestReference | null {
  if (!isRecord(value)) return null;
  const isIngest = value.mediaKind === "integration-ingest"
    || (typeof value.relativePath === "string" && value.relativePath.startsWith("ledger/integration-ingests/"));
  if (!isIngest) return null;
  if (value.mediaKind !== "integration-ingest" || value.expiresAt !== null
    || typeof value.relativePath !== "string" || !hostedColdIngestMonth(value.relativePath)
    || typeof value.mediaId !== "string" || !/^[a-f0-9]{64}$/u.test(value.mediaId)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0) {
    throw new HostedColdHistoryUnavailableError();
  }
  return { byteSize: value.byteSize, expiresAt: null, mediaId: value.mediaId,
    mediaKind: "integration-ingest", relativePath: value.relativePath, sha256: value.sha256 };
}

export async function readHostedColdIngestReferences(vaultRoot: string): Promise<HostedColdIngestReference[]> {
  return (await readHostedMediaReferenceCatalogueValue(vaultRoot)).entries
    .map(parseHostedColdIngestReference).filter((entry): entry is HostedColdIngestReference => entry !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
