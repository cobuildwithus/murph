import type { InboundCapture, PersistedCapture } from "../contracts/capture.ts";
import type { InboxRuntimeStore } from "./sqlite.ts";
import {
  ensureStoredCaptureCanonicalEvidence,
  ensureInboxVault,
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

function defaultIds(): PipelineContext["ids"] {
  return {
    event: () => generatePrefixedId("evt"),
  };
}
