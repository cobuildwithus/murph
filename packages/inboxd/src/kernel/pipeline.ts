import path from "node:path";

import type { InboundCapture, PersistedCapture, StoredAttachment, StoredCapture } from "../contracts/capture.ts";
import type { InboxCaptureRecord } from "../contracts/search.ts";
import type { InboxRuntimeStore } from "./sqlite.ts";
import {
  ensureInboxVault,
  ensureStoredCaptureCanonicalEvidence,
  findStoredCaptureEnvelope,
  persistCanonicalInboxCapture,
} from "../indexing/persist.ts";
import { createDeterministicInboxCaptureId, generatePrefixedId } from "../shared.ts";

export interface PipelineContext {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
  ids: {
    event(): string;
  };
}

export interface InboxPipeline {
  readonly runtime: InboxRuntimeStore;
  processCapture(input: InboundCapture): Promise<PersistedCapture>;
  close(): void;
}

export interface CreateInboxPipelineInput {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
  ids?: PipelineContext["ids"];
}

export async function createInboxPipeline({
  vaultRoot,
  runtime,
  ids = defaultIds(),
}: CreateInboxPipelineInput): Promise<InboxPipeline> {
  await ensureInboxVault(vaultRoot);
  const context: PipelineContext = { vaultRoot, runtime, ids };

  return {
    runtime,
    processCapture: (input) => processCapture(input, context),
    close: () => runtime.close(),
  };
}

export async function processCapture(
  input: InboundCapture,
  context: PipelineContext,
): Promise<PersistedCapture> {
  const { ids, runtime, vaultRoot } = context;
  const dedupe = runtime.findByExternalId(input.source, input.accountId, input.externalId);

  if (dedupe) {
    enqueueDerivedJobsForRecoveredCapture(runtime, dedupe);
    return dedupe;
  }

  const captureId = createDeterministicInboxCaptureId(input);
  const storedEnvelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: input,
    captureId,
  });

  if (storedEnvelope) {
    await ensureStoredCaptureCanonicalEvidence({
      vaultRoot,
      envelope: storedEnvelope,
    });
    const runtimeCaptureId = runtime.upsertCaptureIndex({
      captureId: storedEnvelope.captureId,
      eventId: storedEnvelope.eventId,
      input: storedEnvelope.input,
      stored: storedEnvelope.stored,
    });
    runtime.enqueueDerivedJobs({
      captureId: runtimeCaptureId,
      stored: storedEnvelope.stored,
    });

    return {
      captureId: runtimeCaptureId,
      eventId: storedEnvelope.eventId,
      envelopePath: storedEnvelope.stored.envelopePath,
      createdAt: storedEnvelope.stored.storedAt,
      deduped: true,
    };
  }

  const eventId = ids.event();

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input,
  });
  const runtimeCaptureId = runtime.upsertCaptureIndex({
    captureId,
    eventId,
    input,
    stored: persisted.stored,
  });
  runtime.enqueueDerivedJobs({
    captureId: runtimeCaptureId,
    stored: persisted.stored,
  });

  return {
    captureId: runtimeCaptureId,
    eventId,
    envelopePath: persisted.stored.envelopePath,
    createdAt: persisted.stored.storedAt,
    deduped: false,
  };
}

function enqueueDerivedJobsForRecoveredCapture(
  runtime: InboxRuntimeStore,
  dedupe: PersistedCapture,
): void {
  const capture = runtime.getCapture(dedupe.captureId);
  if (!capture) {
    return;
  }

  runtime.enqueueDerivedJobs({
    captureId: dedupe.captureId,
    stored: captureRecordToStoredCapture(capture, dedupe.createdAt),
  });
}

function captureRecordToStoredCapture(
  capture: InboxCaptureRecord,
  storedAt: string,
): StoredCapture {
  return {
    captureId: capture.captureId,
    eventId: capture.eventId,
    storedAt,
    sourceDirectory: path.posix.dirname(capture.envelopePath),
    envelopePath: capture.envelopePath,
    attachments: capture.attachments.map(captureAttachmentToStoredAttachment),
  };
}

function captureAttachmentToStoredAttachment(attachment: InboxCaptureRecord["attachments"][number]): StoredAttachment {
  return {
    attachmentId: attachment.attachmentId,
    ordinal: attachment.ordinal,
    externalId: attachment.externalId,
    kind: attachment.kind,
    mime: attachment.mime,
    originalPath: attachment.originalPath,
    storedPath: attachment.storedPath,
    fileName: attachment.fileName,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
  };
}

function defaultIds(): PipelineContext["ids"] {
  return {
    event: () => generatePrefixedId("evt"),
  };
}
