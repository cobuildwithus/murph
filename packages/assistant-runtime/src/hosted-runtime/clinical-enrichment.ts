import { randomUUID } from "node:crypto";

import type { ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import { executeClinicalDocumentExtraction } from "@murphai/assistant-engine/clinical-document-extraction";
import type { ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";
import { HOSTED_ASSISTANT_GPT_6_LUNA_MODEL, HOSTED_ASSISTANT_TERRA_MODEL } from "@murphai/hosted-execution/assistant-model";
import * as clinicalEnrichmentState from "@murphai/vault-usecases/clinical-enrichment";

import {
  ClinicalEnrichmentDocumentError,
  countClinicalEnrichmentDocumentPages,
  prepareClinicalEnrichmentDocument,
} from "./clinical-enrichment-document.ts";
import {
  createHostedClinicalEnrichmentController,
  type HostedClinicalEnrichmentController,
} from "./clinical-enrichment-controller.ts";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";

const PAGE_TIMEOUT_MS = 120_000;
const PROVIDER_RETRY_DELAY_MS = 60_000;
type ExtractionUnit = clinicalEnrichmentState.ClinicalExtractionUnit;
type ExtractionOutputs = Parameters<typeof clinicalEnrichmentState.saveClinicalExtraction>[0]["outputs"];

export interface HostedClinicalEnrichmentInput {
  codexHome: string | null;
  env: Readonly<Record<string, string>>;
  memberId: string;
  modelProvider?: string | null;
  vaultRoot: string;
  userEnvKeys?: readonly string[];
  now?: () => string;
  resolveRuntimeAuthority?(): Promise<"current" | "handoff">;
  onStateMutation(): void;
  /** False when a mailbox claim held the job's wake; the runner delivers again on its next kick. */
  onWorkUpdated?(jobId: string, nextAttemptAt: string | null): Promise<boolean | void>;
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  executeExtraction?: typeof executeClinicalDocumentExtraction;
  prepareDocument?: typeof prepareClinicalEnrichmentDocument;
  countPages?: typeof countClinicalEnrichmentDocumentPages;
  state?: Pick<typeof clinicalEnrichmentState,
    | "planClinicalExtractionUnits"
    | "saveClinicalExtraction"
    | "blockClinicalEnrichment"
    | "deferClinicalEnrichment"
  >;
}

export interface HostedClinicalExtractionOutcome {
  unit: ExtractionUnit;
  attemptId: string;
  usages: ReadOnlyAssistantAskProviderUsageEvent[];
  result:
    | { kind: "extracted"; totalPages: number; outputs: ExtractionOutputs }
    | { kind: "unsupported" }
    | { kind: "failed"; stage: "render" | "extract" }
    | { kind: "abandoned" };
}

/**
 * Runs the durable enrichment queue with parallel extraction. Slots fill the
 * extraction cache ahead of each job's cursor; the job's apply wake promotes
 * and applies cached units in order.
 */
export function createHostedClinicalEnrichmentRunner(
  input: HostedClinicalEnrichmentInput & { onError(error: unknown): void; slots?: number },
): HostedClinicalEnrichmentController {
  const state = input.state ?? clinicalEnrichmentState;
  const now = input.now ?? (() => new Date().toISOString());
  // A failed lookahead attempt stays outside the cursor's three-attempt budget;
  // this invocation leaves it for the cursor instead of retrying it ahead.
  const failedLookahead = new Set<string>();
  const pageCounts = new Map<string, Promise<number>>();
  // A result can land while the job's apply wake holds its claim; that wake
  // would otherwise sleep its retry delay. Deliver again once claims settle.
  const undelivered = new Set<string>();
  const countPages = (document: { documentPath: string; mediaType: string }) => {
    const key = `${document.mediaType}\n${document.documentPath}`;
    const count = pageCounts.get(key) ?? (input.countPages ?? countClinicalEnrichmentDocumentPages)({ vaultRoot: input.vaultRoot, ...document });
    pageCounts.set(key, count);
    return count;
  };
  const controller = createHostedClinicalEnrichmentController<ExtractionUnit, HostedClinicalExtractionOutcome>({
    ...(input.slots ? { slots: input.slots } : {}),
    keyOf: (unit) => unit.key,
    plan: (inFlight, limit) => state.planClinicalExtractionUnits({
      vaultRoot: input.vaultRoot, limit, now: new Date(now()), countPages,
      exclude: (unit) => inFlight.has(unit.key) || (!unit.cursor && failedLookahead.has(unit.key)),
    }),
    run: (unit, signal) => extractHostedClinicalUnit(input, unit, signal),
    publish: (outcome) => publishHostedClinicalOutcome({ input, state, outcome, failedLookahead, undelivered, now }),
    onActivity: input.onStateMutation,
    onError: input.onError,
  });
  const redeliver = async () => {
    for (const jobId of [...undelivered]) {
      if (await input.onWorkUpdated?.(jobId, null) !== false) undelivered.delete(jobId);
    }
  };
  return {
    ...controller,
    kick(progressed) {
      if (undelivered.size) void redeliver().catch(input.onError);
      controller.kick(progressed);
    },
  };
}

/** Provider work for one unit. It writes nothing; the outcome publishes later. */
export async function extractHostedClinicalUnit(
  input: HostedClinicalEnrichmentInput,
  unit: ExtractionUnit,
  abortSignal: AbortSignal,
): Promise<HostedClinicalExtractionOutcome> {
  const attemptId = randomUUID();
  const usages: ReadOnlyAssistantAskProviderUsageEvent[] = [];
  const outcome = (result: HostedClinicalExtractionOutcome["result"]) => ({ unit, attemptId, usages, result });
  const handoff = new AbortController();
  const deadlineAt = performance.now() + PAGE_TIMEOUT_MS;
  const signal = AbortSignal.any([abortSignal, handoff.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]);
  let prepared: Awaited<ReturnType<typeof prepareClinicalEnrichmentDocument>> | undefined;
  let stage: "render" | "extract" = "render";
  try {
    prepared = unit.source.resource ? { totalPages: 1, extractedText: unit.extractedText, renderedPages: [], scratchRoots: [], async cleanup() {} } : await (input.prepareDocument ?? prepareClinicalEnrichmentDocument)({
      vaultRoot: input.vaultRoot,
      documentPath: unit.documentPath,
      mediaType: unit.source.mediaType,
      page: unit.page,
      signal,
    });
    signal.throwIfAborted();
    stage = "extract";
    const outputs = await extractClinicalEnrichmentOutputs({
      input, work: unit, prepared, signal, usages, deadlineAt,
      onHandoff() { handoff.abort(); },
    });
    return outcome({ kind: "extracted", totalPages: prepared.totalPages, outputs });
  } catch (error) {
    if (abortSignal.aborted || handoff.signal.aborted) return outcome({ kind: "abandoned" });
    return outcome(stage === "render" && error instanceof ClinicalEnrichmentDocumentError
      && error.code !== "CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED" ? { kind: "unsupported" } : { kind: "failed", stage });
  } finally {
    await prepared?.cleanup();
    // Provider cost is recorded as soon as the call ends, so no kill or rollout
    // can drop it; deterministic usage ids keep a replayed record idempotent.
    await recordClinicalEnrichmentUsage({ input, attemptId, usages });
  }
}

/**
 * The publication critical section for one outcome: cache save or cursor
 * failure settlement, usage registration, dirty notice and the job's wake.
 */
async function publishHostedClinicalOutcome({ input, state, outcome, failedLookahead, undelivered, now }: {
  input: HostedClinicalEnrichmentInput;
  state: NonNullable<HostedClinicalEnrichmentInput["state"]>;
  outcome: HostedClinicalExtractionOutcome;
  failedLookahead: Set<string>;
  undelivered: Set<string>;
  now: () => string;
}): Promise<void> {
  const { unit, result } = outcome;
  if (result.kind === "abandoned") return;
  if (result.kind !== "extracted" && !unit.cursor) {
    failedLookahead.add(unit.key);
    return;
  }
  let nextAttemptAt: string | null = null;
  if (result.kind === "extracted") {
    await state.saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit, totalPages: result.totalPages, outputs: result.outputs });
  } else if (result.kind === "unsupported") {
    await state.blockClinicalEnrichment({
      vaultRoot: input.vaultRoot, jobId: unit.jobId, cursorRef: unit.cursorRef,
      reason: "Clinical document rendering is unsupported or exceeds supported bounds.",
    });
  } else {
    const deferred = await state.deferClinicalEnrichment({
      vaultRoot: input.vaultRoot, jobId: unit.jobId, cursorRef: unit.cursorRef,
      reason: result.stage === "render" ? "Clinical document preparation failed; retry pending." : "Clinical document extraction failed; retry pending.",
      nextAttemptAt: new Date(Date.parse(now()) + PROVIDER_RETRY_DELAY_MS).toISOString(),
    });
    nextAttemptAt = deferred.nextAttemptAt ?? null;
  }
  input.onStateMutation();
  if (await input.onWorkUpdated?.(unit.jobId, nextAttemptAt) === false) undelivered.add(unit.jobId);
}

/**
 * One pass per page or resource covers labs, measurements and history together.
 * Structured resources are short, so GPT-6 Luna reads them. Document history
 * needs a stronger reader than Luna, which dropped and inverted history facts in
 * live evaluation, so pages run GPT-6.1 Terra on the half-price Flex tier for
 * their first attempt and on the standard tier for a retry.
 */
function resolveClinicalExtractionTarget(work: ExtractionUnit) {
  if (work.source.resource) return { model: HOSTED_ASSISTANT_GPT_6_LUNA_MODEL, reasoningEffort: "medium" as const };
  return { model: HOSTED_ASSISTANT_TERRA_MODEL, reasoningEffort: "low" as const, serviceTier: work.failures === 0 ? "flex" as const : null };
}

async function extractClinicalEnrichmentOutputs({ input, work, prepared, signal, usages, deadlineAt, onHandoff }: {
  input: HostedClinicalEnrichmentInput;
  work: ExtractionUnit;
  prepared: Awaited<ReturnType<typeof prepareClinicalEnrichmentDocument>>;
  signal: AbortSignal;
  usages: ReadOnlyAssistantAskProviderUsageEvent[];
  deadlineAt: number;
  onHandoff(): void;
}) {
  const output = await (input.executeExtraction ?? executeClinicalDocumentExtraction)({
    abortSignal: signal,
    async beforeProviderEntry() {
      signal.throwIfAborted();
      if (await input.resolveRuntimeAuthority?.() === "handoff") onHandoff();
      signal.throwIfAborted();
    },
    codexHome: input.codexHome, env: { ...input.env },
    ...resolveClinicalExtractionTarget(work), modelProvider: input.modelProvider,
    workspaceRoot: input.vaultRoot, source: work.source, documentPath: work.documentPath,
    timeZone: work.timeZone,
    deadlineAt,
    family: "all", extractedText: prepared.extractedText, renderedPages: prepared.renderedPages,
    textWindow: prepared.textWindow,
    scratchRoots: prepared.scratchRoots,
    onProviderUsage(event) { usages.push(event); },
  });
  signal.throwIfAborted();
  const { labs, measurements, history } = splitClinicalExtractionOutput(output);
  return {
    labs, measurements,
    history: prepared.coverageWarning
      ? { ...history, status: "blocked" as const, reason: [history.reason, prepared.coverageWarning].filter(Boolean).join(" ").slice(0, 500) }
      : history,
  };
}

async function recordClinicalEnrichmentUsage({ input, attemptId, usages }: {
  input: HostedClinicalEnrichmentInput;
  attemptId: string;
  usages: ReadOnlyAssistantAskProviderUsageEvent[];
}): Promise<void> {
  const usageRecordPort = input.usageRecordPort;
  if (!usageRecordPort) return;
  for (const event of usages) {
    try {
      const usage = event.usage.usage;
      const turnId = `turn_clinical_enrichment_${attemptId}.all.${event.stage}`;
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

function splitClinicalExtractionOutput(output: ClinicalDocumentExtractionOutput) {
  const byKind = (kinds: readonly string[]): ClinicalDocumentExtractionOutput => ({ status: "complete", records: output.records.filter((record) => kinds.includes(record.payload.kind)) });
  return { labs: byKind(["test"]), measurements: byKind(["measurement"]),
    history: { ...output, records: output.records.filter((record) => record.payload.kind === "note" || record.payload.kind === "clinical_assertion") } };
}
