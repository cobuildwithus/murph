import type { InboundCapture, PersistedCapture } from "../contracts/capture.ts";
import type { StoredAttachment, StoredCapture } from "../contracts/capture.ts";
import type { InboxRuntimeStore } from "./sqlite.ts";
import {
  ensureInboxVault,
  ensureStoredCaptureCanonicalEvidence,
  findStoredCaptureEnvelope,
  persistCanonicalInboxCapture,
} from "../indexing/persist.ts";
import {
  buildAttachmentId,
  createDeterministicInboxCaptureId,
  generatePrefixedId,
} from "../shared.ts";
import {
  buildInboxCaptureDirectory,
  buildInboxEnvelopePath,
  buildUnstoredAttachment,
  stripEphemeralAttachmentFields,
} from "../indexing/capture-shape.ts";

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

export function stageRuntimeOnlyCapture(input: {
  capture: InboundCapture;
  eventId?: string;
  runtime: InboxRuntimeStore;
  storedAt?: string;
}): PersistedCapture {
  const eventId = input.eventId ?? generatePrefixedId("evt");
  const captureId = createDeterministicInboxCaptureId(input.capture);
  const existing = input.runtime.findByExternalId(
    input.capture.source,
    input.capture.accountId,
    input.capture.externalId,
  );

  if (existing) {
    return existing;
  }

  const storedAt = input.storedAt ?? new Date().toISOString();
  const stored = buildRuntimeOnlyStoredCapture({
    capture: input.capture,
    captureId,
    eventId,
    storedAt,
  });
  const runtimeCaptureId = input.runtime.upsertCaptureIndex({
    captureId,
    eventId,
    input: input.capture,
    persistence: "runtime_only",
    stored,
  });

  return {
    captureId: runtimeCaptureId,
    createdAt: stored.storedAt,
    deduped: false,
    envelopePath: stored.envelopePath,
    eventId,
  };
}

function defaultIds(): PipelineContext["ids"] {
  return {
    event: () => generatePrefixedId("evt"),
  };
}

function buildRuntimeOnlyStoredCapture(input: {
  capture: InboundCapture;
  captureId: string;
  eventId: string;
  storedAt: string;
}): StoredCapture {
  const sourceDirectory = buildInboxCaptureDirectory(
    input.capture,
    input.captureId,
  );

  return {
    attachments: input.capture.attachments.map((attachment, index): StoredAttachment => {
      const ordinal = index + 1;

      return buildUnstoredAttachment({
        attachment: {
          ...stripEphemeralAttachmentFields(attachment),
          originalPath: null,
        },
        attachmentId: buildAttachmentId(input.captureId, ordinal),
        ordinal,
      });
    }),
    captureId: input.captureId,
    envelopePath: buildInboxEnvelopePath(input.capture, input.captureId),
    eventId: input.eventId,
    sourceDirectory,
    storedAt: input.storedAt,
  };
}
