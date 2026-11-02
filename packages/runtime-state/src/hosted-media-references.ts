import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAssistantStatePaths } from "./assistant-state.ts";

export const HOSTED_MEDIA_REFS_SCHEMA = "murph.hosted-media-refs.v1";
export const HOSTED_MEDIA_REFS_RELATIVE_PATH = ".runtime/operations/assistant/hosted-media-refs.json";

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
export async function readHostedMediaReferenceCatalogueValue(vaultRoot: string): Promise<{
  schema: typeof HOSTED_MEDIA_REFS_SCHEMA;
  entries: unknown[];
}> {
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
    const seen = new Set<string>();
    for (const entry of value.entries) {
      if (!isRecord(entry) || !["image", "video", "integration-ingest"].includes(String(entry.mediaKind))
        || typeof entry.relativePath !== "string") throw new HostedColdHistoryUnavailableError();
      const cold = parseHostedColdIngestReference(entry);
      if (!cold) continue;
      if (seen.has(cold.relativePath)) throw new HostedColdHistoryUnavailableError();
      seen.add(cold.relativePath);
    }
    return { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: value.entries };
  } catch {
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
