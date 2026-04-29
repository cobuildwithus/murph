import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";

import type { InboundCapture, StoredAttachment } from "../contracts/capture.ts";
import {
  normalizeAccountKey,
  normalizeRelativePath,
  sanitizeSegment,
} from "../shared.ts";

export type PersistableInboundAttachment = Omit<InboundCapture["attachments"][number], "data">;

export function buildInboxAccountDirectory(input: InboundCapture): string {
  const accountSegment = sanitizeSegment(normalizeAccountKey(input.accountId) || "default", "default");
  const sourceSegment = sanitizeSegment(input.source, "source");
  return normalizeRelativePath(
    path.posix.join(VAULT_LAYOUT.rawInboxDirectory, sourceSegment, accountSegment),
  );
}

export function buildInboxCaptureDirectory(input: InboundCapture, captureId: string): string {
  return normalizeRelativePath(
    path.posix.join(
      buildInboxAccountDirectory(input),
      input.occurredAt.slice(0, 4),
      input.occurredAt.slice(5, 7),
      captureId,
    ),
  );
}

export function buildInboxEnvelopePath(input: InboundCapture, captureId: string): string {
  return normalizeRelativePath(path.posix.join(buildInboxCaptureDirectory(input, captureId), "envelope.json"));
}

export function stripEphemeralAttachmentFields(
  attachment: InboundCapture["attachments"][number],
): PersistableInboundAttachment {
  const { data, ...sanitized } = attachment;
  return sanitized;
}

export function buildUnstoredAttachment(input: {
  attachment: PersistableInboundAttachment;
  attachmentId: string;
  ordinal: number;
}): StoredAttachment {
  return {
    ...input.attachment,
    attachmentId: input.attachmentId,
    ordinal: input.ordinal,
    originalPath: null,
    storedPath: null,
    sha256: null,
  };
}
