import { requireObject, requireString } from "./parsers/assertions.ts";
import { parseHostedRuntimeOwnerIdentity, type HostedRuntimeOwnerIdentity } from "./runtime-owner.ts";

export const HOSTED_RUNTIME_MEDIA_PATH = "/api/internal/hosted-runtime/media";
export interface HostedRuntimeMediaDescriptor {
  mediaId: string;
  mediaKind: "image" | "video";
  byteSize: number;
  sha256: string;
  expiresAt: string | null;
}
export interface HostedRuntimeMediaPurge {
  mediaId: string;
  objectKey: string;
  revision: string;
}
export type HostedRuntimeMediaCommand =
  | { operation: "read"; descriptor: HostedRuntimeMediaDescriptor }
  | ({ operation: "admit_put"; writeId: string; descriptor: HostedRuntimeMediaDescriptor } & HostedRuntimeOwnerIdentity)
  | { operation: "release_put"; writeId: string; mediaId: string }
  | ({ operation: "register"; descriptor: HostedRuntimeMediaDescriptor } & HostedRuntimeOwnerIdentity)
  | ({ operation: "retire"; mediaId: string } & HostedRuntimeOwnerIdentity)
  | { operation: "acknowledge_purge"; purge: HostedRuntimeMediaPurge };
export interface HostedRuntimeMediaResponse {
  cutover: "legacy" | "draining" | "postgres";
  applied: boolean;
  reason: "active" | "descriptor_mismatch" | "expired" | "unregistered" | null;
  purge: HostedRuntimeMediaPurge | null;
}

export function parseHostedRuntimeMediaDescriptor(value: unknown): HostedRuntimeMediaDescriptor {
  const record = requireObject(value, "Runtime media descriptor");
  const mediaId = mediaDigest(record.mediaId);
  const sha256 = mediaDigest(record.sha256);
  if (record.mediaKind !== "image" && record.mediaKind !== "video") throw new TypeError("Runtime media kind is invalid.");
  if (typeof record.byteSize !== "number" || !Number.isSafeInteger(record.byteSize) || record.byteSize < 0) throw new TypeError("Runtime media size is invalid.");
  const expiresAt = record.expiresAt === null || record.expiresAt === undefined ? null : requireString(record.expiresAt, "Runtime media expiry");
  if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) throw new TypeError("Runtime media expiry is invalid.");
  return { mediaId, mediaKind: record.mediaKind, byteSize: record.byteSize, sha256, expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString() };
}

export function parseHostedRuntimeMediaCommand(value: unknown): HostedRuntimeMediaCommand {
  const record = requireObject(value, "Runtime media command");
  const operation = record.operation;
  if (operation === "admit_put" || operation === "release_put") {
    const writeId = requireString(record.writeId, "Media PUT identity");
    if (!/^[A-Za-z0-9-]{1,100}$/u.test(writeId)) throw new TypeError("Media PUT identity is invalid.");
    return operation === "admit_put"
      ? { operation, writeId, ...parseHostedRuntimeOwnerIdentity(record), descriptor: parseHostedRuntimeMediaDescriptor(record.descriptor) }
      : { operation, writeId, mediaId: mediaDigest(record.mediaId) };
  }
  if (operation === "read") return { operation, descriptor: parseHostedRuntimeMediaDescriptor(record.descriptor) };
  if (operation === "register") return { operation, ...parseHostedRuntimeOwnerIdentity(record), descriptor: parseHostedRuntimeMediaDescriptor(record.descriptor) };
  if (operation === "retire") return { operation, ...parseHostedRuntimeOwnerIdentity(record), mediaId: mediaDigest(record.mediaId) };
  if (operation === "acknowledge_purge") return { operation, purge: parsePurge(record.purge) };
  throw new TypeError("Runtime media operation is invalid.");
}

export function parseHostedRuntimeMediaResponse(value: unknown): HostedRuntimeMediaResponse {
  const record = requireObject(value, "Runtime media response");
  if (record.cutover !== "legacy" && record.cutover !== "draining" && record.cutover !== "postgres") throw new TypeError("Runtime media cutover is invalid.");
  if (typeof record.applied !== "boolean") throw new TypeError("Runtime media outcome is invalid.");
  if (record.reason !== null && record.reason !== "active" && record.reason !== "descriptor_mismatch" && record.reason !== "expired" && record.reason !== "unregistered") throw new TypeError("Runtime media reason is invalid.");
  return { cutover: record.cutover, applied: record.applied, reason: record.reason, purge: record.purge === null ? null : parsePurge(record.purge) };
}

function mediaDigest(value: unknown): string {
  const text = requireString(value, "Runtime media digest");
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError("Runtime media digest is invalid.");
  return text;
}
function parsePurge(value: unknown): HostedRuntimeMediaPurge {
  const record = requireObject(value, "Runtime media purge");
  const revision = requireString(record.revision, "Runtime media revision");
  if (!/^[1-9][0-9]{0,18}$/u.test(revision) || BigInt(revision) > 9_223_372_036_854_775_807n) throw new TypeError("Runtime media revision is invalid.");
  return { mediaId: mediaDigest(record.mediaId), objectKey: requireString(record.objectKey, "Runtime media object key"), revision };
}
