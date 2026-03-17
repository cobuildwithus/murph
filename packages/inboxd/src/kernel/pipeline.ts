import type { InboundCapture, PersistedCapture } from "../contracts/capture.js";
import type { InboxRuntimeStore } from "./sqlite.js";
import {
  appendImportAudit,
  appendInboxCaptureEvent,
  ensureStoredCaptureCanonicalEvidence,
  ensureInboxVault,
  findStoredCaptureEnvelope,
  persistRawCapture,
} from "../indexing/persist.js";
import { createDeterministicInboxCaptureId, generatePrefixedId } from "../shared.js";

export interface PipelineContext {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
  ids: {
    capture(): string;
    event(): string;
    audit(): string;
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
    const evidence = await ensureStoredCaptureCanonicalEvidence({
      vaultRoot,
      envelope: storedEnvelope,
      createAuditId: ids.audit,
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
      auditId: evidence.auditId,
      envelopePath: storedEnvelope.stored.envelopePath,
      createdAt: storedEnvelope.stored.storedAt,
      deduped: true,
    };
  }

  const eventId = ids.event();
  const auditId = ids.audit();

  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input,
  });
  const event = await appendInboxCaptureEvent({
    vaultRoot,
    eventId,
    occurredAt: input.occurredAt,
    inbound: input,
    stored,
  });
  await appendImportAudit({
    vaultRoot,
    auditId,
    eventId,
    inbound: input,
    stored,
    eventPath: event.relativePath,
  });
  const runtimeCaptureId = runtime.upsertCaptureIndex({
    captureId,
    eventId,
    input,
    stored,
  });
  runtime.enqueueDerivedJobs({
    captureId: runtimeCaptureId,
    stored,
  });

  return {
    captureId: runtimeCaptureId,
    eventId,
    auditId,
    envelopePath: stored.envelopePath,
    createdAt: stored.storedAt,
    deduped: false,
  };
}

function defaultIds(): PipelineContext["ids"] {
  return {
    capture: () => generatePrefixedId("cap"),
    event: () => generatePrefixedId("evt"),
    audit: () => generatePrefixedId("aud"),
  };
}
