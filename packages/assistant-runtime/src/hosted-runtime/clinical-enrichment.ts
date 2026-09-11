import { randomUUID } from "node:crypto";

import type { ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import {
  executeClinicalDocumentExtraction,
  type ClinicalDocumentExtractionInput,
} from "@murphai/assistant-engine/clinical-document-extraction";
import type { ClinicalDocumentExtractionFamily } from "@murphai/clinical-records";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";
import * as clinicalEnrichmentState from "@murphai/vault-usecases/clinical-enrichment";

import {
  ClinicalEnrichmentDocumentError,
  prepareClinicalEnrichmentDocument,
} from "./clinical-enrichment-document.ts";
import type { HostedClinicalEnrichmentRunResult } from "./clinical-enrichment-controller.ts";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";
import type { HostedWorkspaceDurableCheckpointEffect } from "./workspace-runner.ts";

const FAMILIES = ["labs", "measurements", "history"] as const;
const PAGE_TIMEOUT_MS = 120_000;
const PROVIDER_RETRY_DELAY_MS = 60_000;
type ExtractionWork = Extract<clinicalEnrichmentState.ClinicalEnrichmentWork, { status: "extract" }>;
type FamilyUsage = { family: ClinicalDocumentExtractionFamily; event: ReadOnlyAssistantAskProviderUsageEvent };
type AttemptStage = "render" | "extract" | "persist";

export interface HostedClinicalEnrichmentInput {
  abortSignal: AbortSignal;
  codexHome: string | null;
  env: Readonly<Record<string, string>>;
  memberId: string;
  model?: string | null;
  modelProvider?: string | null;
  vaultRoot: string;
  userEnvKeys?: readonly string[];
  now?: () => string;
  resolveProviderAuthority?(): Promise<"current" | "handoff">;
  onStateMutation(): void;
  onExtractionStarted?(): void;
  onWorkUpdated?(jobId: string, nextAttemptAt: string | null): Promise<void>;
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  deferUsageUntilAfterDurableCheckpoint?(effect: HostedWorkspaceDurableCheckpointEffect): void;
  executeExtraction?: typeof executeClinicalDocumentExtraction;
  prepareDocument?: typeof prepareClinicalEnrichmentDocument;
  state?: Pick<typeof clinicalEnrichmentState,
    | "readNextClinicalEnrichment"
    | "persistClinicalEnrichmentProposals"
    | "blockClinicalEnrichment"
    | "deferClinicalEnrichment"
  >;
}

/** Read-only provider work must never be included in canonical mutation tracking. */
export async function runOneHostedClinicalEnrichment(
  input: HostedClinicalEnrichmentInput,
): Promise<HostedClinicalEnrichmentRunResult> {
  if (input.abortSignal.aborted) return "idle";
  const state = input.state ?? clinicalEnrichmentState;
  const now = input.now ?? (() => new Date().toISOString());
  const work = await state.readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, now: new Date(now()) });
  // The bounded cursor reader can advance operational state even without a page.
  if (work) input.onStateMutation();
  if (!work || input.abortSignal.aborted) return "idle";
  if (work.status === "deferred") {
    await input.onWorkUpdated?.(work.jobId, work.nextAttemptAt);
    return "idle";
  }
  if (work.status !== "extract") {
    await input.onWorkUpdated?.(work.jobId, null);
    return work.status === "advance" ? "settled" : "idle";
  }
  input.onExtractionStarted?.();
  return extractClinicalEnrichmentPage({ input, work, state, now });
}

async function extractClinicalEnrichmentPage({ input, work, state, now }: {
  input: HostedClinicalEnrichmentInput;
  work: ExtractionWork;
  state: NonNullable<HostedClinicalEnrichmentInput["state"]>;
  now: () => string;
}): Promise<HostedClinicalEnrichmentRunResult> {
  const attemptId = randomUUID();
  const usages: FamilyUsage[] = [];
  const peers = new AbortController();
  const signal = AbortSignal.any([input.abortSignal, peers.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]);
  let prepared: Awaited<ReturnType<typeof prepareClinicalEnrichmentDocument>> | undefined;
  let handedOff = false;
  let stage: AttemptStage = "render";
  try {
    prepared = await (input.prepareDocument ?? prepareClinicalEnrichmentDocument)({
      documentPath: work.documentPath,
      mediaType: work.source.mediaType,
      page: work.page,
      signal,
    });
    signal.throwIfAborted();
    stage = "extract";
    const outputs = await extractClinicalEnrichmentFamilies({
      input, work, prepared, signal, peers, usages,
      onHandoff() { handedOff = true; },
    });
    stage = "persist";
    await state.persistClinicalEnrichmentProposals({
      vaultRoot: input.vaultRoot,
      jobId: work.jobId,
      sourceSha256: work.source.sha256,
      page: work.page,
      totalPages: prepared.totalPages,
      outputs,
    });
    input.onStateMutation();
    await input.onWorkUpdated?.(work.jobId, null);
    return "settled";
  } catch (error) {
    if (input.abortSignal.aborted || handedOff) return "idle";
    // A failed durable write is an ownership barrier, never a provider retry.
    if (stage === "persist") throw error;
    return settleClinicalEnrichmentFailure({ input, work, state, stage, error, now });
  } finally {
    try {
      await prepared?.cleanup();
    } finally {
      if (usages.length && input.usageRecordPort && input.deferUsageUntilAfterDurableCheckpoint) {
        const usageRecordPort = input.usageRecordPort;
        input.deferUsageUntilAfterDurableCheckpoint(async () => {
          await recordClinicalEnrichmentUsage({ input, attemptId, usages, usageRecordPort });
        });
        input.onStateMutation();
      }
    }
  }
}

async function extractClinicalEnrichmentFamilies({ input, work, prepared, signal, peers, usages, onHandoff }: {
  input: HostedClinicalEnrichmentInput;
  work: ExtractionWork;
  prepared: Awaited<ReturnType<typeof prepareClinicalEnrichmentDocument>>;
  signal: AbortSignal;
  peers: AbortController;
  usages: FamilyUsage[];
  onHandoff(): void;
}) {
  const execute = input.executeExtraction ?? executeClinicalDocumentExtraction;
  const results = await Promise.allSettled(FAMILIES.map(async (family) => {
    try {
      const execution: ClinicalDocumentExtractionInput = {
        abortSignal: signal,
        async beforeProviderEntry() {
          signal.throwIfAborted();
          if (await input.resolveProviderAuthority?.() === "handoff") {
            onHandoff();
            peers.abort();
          }
          signal.throwIfAborted();
        },
        codexHome: input.codexHome, env: { ...input.env },
        model: input.model, modelProvider: input.modelProvider,
        workspaceRoot: input.vaultRoot, source: work.source, documentPath: work.documentPath,
        family, extractedText: prepared.extractedText, renderedPages: prepared.renderedPages,
        scratchRoots: prepared.scratchRoots,
        onProviderUsage(event) { usages.push({ family, event }); },
      };
      return await execute(execution);
    } catch (error) {
      // Cancel siblings, then join every admitted leaf before state or scratch changes.
      peers.abort();
      throw error;
    }
  }));
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  signal.throwIfAborted();
  const [labs, measurements, history] = results;
  if (labs?.status !== "fulfilled" || measurements?.status !== "fulfilled" || history?.status !== "fulfilled") {
    throw new Error("Clinical extraction families did not settle.");
  }
  return { labs: labs.value, measurements: measurements.value, history: history.value };
}

async function settleClinicalEnrichmentFailure({ input, work, state, stage, error, now }: {
  input: HostedClinicalEnrichmentInput;
  work: ExtractionWork;
  state: NonNullable<HostedClinicalEnrichmentInput["state"]>;
  stage: Exclude<AttemptStage, "persist">;
  error: unknown;
  now: () => string;
}): Promise<HostedClinicalEnrichmentRunResult> {
  if (stage === "render" && error instanceof ClinicalEnrichmentDocumentError
    && error.code !== "CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED") {
    await state.blockClinicalEnrichment({
      vaultRoot: input.vaultRoot, jobId: work.jobId,
      reason: "Clinical document rendering is unsupported or exceeds supported bounds.",
    });
    input.onStateMutation();
    await input.onWorkUpdated?.(work.jobId, null);
    return "settled";
  }
  const deferred = await state.deferClinicalEnrichment({
    vaultRoot: input.vaultRoot, jobId: work.jobId,
    reason: stage === "render" ? "Clinical document preparation failed; retry pending." : "Clinical document extraction failed; retry pending.",
    nextAttemptAt: new Date(Date.parse(now()) + PROVIDER_RETRY_DELAY_MS).toISOString(),
  });
  input.onStateMutation();
  await input.onWorkUpdated?.(work.jobId, deferred.nextAttemptAt ?? null);
  return deferred.nextAttemptAt ? "idle" : "settled";
}

async function recordClinicalEnrichmentUsage({ input, attemptId, usages, usageRecordPort }: {
  input: HostedClinicalEnrichmentInput;
  attemptId: string;
  usages: FamilyUsage[];
  usageRecordPort: HostedRuntimeUsageRecordPort;
}): Promise<void> {
  for (const { family, event } of usages) {
    try {
      const usage = event.usage.usage;
      const turnId = `turn_clinical_enrichment_${attemptId}.${family}.${event.stage}`;
      const record = parseAssistantUsageRecord({
        ...usage,
        credentialSource: resolveAssistantUsageCredentialSource({
          apiKeyEnv: usage.apiKeyEnv,
          effectiveEnv: input.env,
          provider: event.usage.provider,
          userEnvKeys: input.userEnvKeys ?? [],
        }),
        attemptCount: 1,
        featureKey: "clinical_document_extraction",
        gatewayTags: [],
        memberId: input.memberId,
        occurredAt: event.usage.occurredAt,
        provider: event.usage.provider,
        providerRequestOrdinal: event.usage.providerRequestOrdinal,
        providerRequestOutcome: event.usage.providerRequestOutcome ?? "succeeded",
        reportingUserId: null,
        routeId: null,
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: attemptId,
        stripeMeterSource: "murph",
        surface: "hosted-runtime",
        triggerKind: "clinical-records-enrichment",
        turnId,
        usageId: createAssistantUsageId({ attemptCount: 1, providerRequestOrdinal: event.usage.providerRequestOrdinal, turnId }),
      });
      await usageRecordPort.recordUsage(record);
    } catch (error) {
      console.warn("Clinical extraction usage recording failed; continuing without retry.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}
