import { randomUUID } from "node:crypto";

import type { ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import { executeClinicalDocumentExtraction } from "@murphai/assistant-engine/clinical-document-extraction";
import { CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
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
/**
 * Consecutive PDF pages that share one call. Live GPT-6.1 Terra runs extracted
 * every fact from four dense pages and stopped early from six on, reporting
 * them blocked; the fixed instructions are most of a single page's input.
 */
export const HOSTED_CLINICAL_PAGES_PER_CALL = 4;
type ExtractionUnit = clinicalEnrichmentState.ClinicalExtractionUnit;
type PreparedDocument = Awaited<ReturnType<typeof prepareClinicalEnrichmentDocument>>;
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

/** One call's result. `outputs` follows `units`; a group has several consecutive pages. */
export interface HostedClinicalExtractionOutcome {
  units: readonly ExtractionUnit[];
  attemptId: string;
  usages: ReadOnlyAssistantAskProviderUsageEvent[];
  result:
    | { kind: "extracted"; totalPages: number; outputs: ExtractionOutputs[] }
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
  // Pages of a group that did not finish every page run alone on the
  // single-page rules for the rest of this invocation.
  const solo = new Set<string>();
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
  const controller = createHostedClinicalEnrichmentController<readonly ExtractionUnit[], HostedClinicalExtractionOutcome>({
    ...(input.slots ? { slots: input.slots } : {}),
    keyOf: (units) => units.map((unit) => unit.key).join("\n"),
    plan: async (inFlight, limit) => {
      const busy = new Set([...inFlight].flatMap((key) => key.split("\n")));
      const units = await state.planClinicalExtractionUnits({
        vaultRoot: input.vaultRoot, limit: limit * HOSTED_CLINICAL_PAGES_PER_CALL, now: new Date(now()), countPages,
        exclude: (unit) => busy.has(unit.key) || (!unit.cursor && failedLookahead.has(unit.key)),
      });
      // Cache keys omit job and attachment, so one plan can repeat a page; its first occurrence owns it.
      const owned: ExtractionUnit[] = [];
      for (const unit of units) {
        if (busy.has(unit.key)) continue;
        busy.add(unit.key);
        owned.push(unit);
      }
      return groupClinicalExtractionUnits(owned, solo).slice(0, limit);
    },
    run: (units, signal) => extractHostedClinicalUnits(input, units, signal),
    publish: (outcome) => publishHostedClinicalOutcome({ input, state, outcome, failedLookahead, solo, undelivered, now }),
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

/**
 * Joins runs of consecutive first-attempt pages of one PDF into calls of up to
 * `HOSTED_CLINICAL_PAGES_PER_CALL`. Resources, other media, retries and solo
 * pages each get their own call.
 */
export function groupClinicalExtractionUnits(units: readonly ExtractionUnit[], solo: ReadonlySet<string>): ExtractionUnit[][] {
  const attachmentOf = (unit: ExtractionUnit) => "attachmentIndex" in unit.locator ? unit.locator.attachmentIndex : null;
  const groupable = (unit: ExtractionUnit) => attachmentOf(unit) !== null && unit.failures === 0 && !solo.has(unit.key)
    && unit.source.mediaType.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
  const groups: ExtractionUnit[][] = [];
  for (const unit of units) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const joins = group !== undefined && previous !== undefined && group.length < HOSTED_CLINICAL_PAGES_PER_CALL
      && groupable(previous) && groupable(unit) && unit.jobId === previous.jobId
      && attachmentOf(unit) === attachmentOf(previous) && unit.page === previous.page + 1;
    if (joins) group.push(unit);
    else groups.push([unit]);
  }
  return groups;
}

/** Provider work for one call. It writes nothing; the outcome publishes later. */
export async function extractHostedClinicalUnits(
  input: HostedClinicalEnrichmentInput,
  units: readonly ExtractionUnit[],
  abortSignal: AbortSignal,
): Promise<HostedClinicalExtractionOutcome> {
  const attemptId = randomUUID();
  const usages: ReadOnlyAssistantAskProviderUsageEvent[] = [];
  const outcome = (result: HostedClinicalExtractionOutcome["result"]) => ({ units, attemptId, usages, result });
  const handoff = new AbortController();
  const timeoutMs = PAGE_TIMEOUT_MS * units.length;
  const deadlineAt = performance.now() + timeoutMs;
  const signal = AbortSignal.any([abortSignal, handoff.signal, AbortSignal.timeout(timeoutMs)]);
  const prepared: PreparedDocument[] = [];
  let stage: "render" | "extract" = "render";
  try {
    for (const unit of units) prepared.push(await prepareClinicalUnit(input, unit, signal));
    signal.throwIfAborted();
    const totalPages = prepared[0]!.totalPages;
    if (prepared.some((page) => page.totalPages !== totalPages)) return outcome({ kind: "failed", stage });
    stage = "extract";
    const outputs = await extractClinicalEnrichmentOutputs({
      input, work: units[0]!, prepared: combinePreparedPages(units, prepared), signal, usages, deadlineAt,
      onHandoff() { handoff.abort(); },
    });
    if (units.length === 1) return outcome({ kind: "extracted", totalPages, outputs: [outputs] });
    // A group counts only when it finished every page below the record limit; otherwise its pages run alone.
    const records = outputs.labs.records.length + outputs.measurements.records.length + outputs.history.records.length;
    if (outputs.history.status !== "complete" || records >= CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS) return outcome({ kind: "failed", stage });
    return outcome({ kind: "extracted", totalPages, outputs: units.map((unit) => pageOutputs(outputs, unit.page)) });
  } catch (error) {
    if (abortSignal.aborted || handoff.signal.aborted) return outcome({ kind: "abandoned" });
    return outcome(stage === "render" && error instanceof ClinicalEnrichmentDocumentError
      && error.code !== "CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED" ? { kind: "unsupported" } : { kind: "failed", stage });
  } finally {
    for (const page of prepared) await page.cleanup();
    // Provider cost is recorded as soon as the call ends, so no kill or rollout
    // can drop it; deterministic usage ids keep a replayed record idempotent.
    await recordClinicalEnrichmentUsage({ input, attemptId, usages });
  }
}

function prepareClinicalUnit(input: HostedClinicalEnrichmentInput, unit: ExtractionUnit, signal: AbortSignal): Promise<PreparedDocument> {
  if (unit.source.resource) {
    return Promise.resolve({ totalPages: 1, extractedText: unit.extractedText, renderedPages: [], scratchRoots: [], async cleanup() {} });
  }
  return (input.prepareDocument ?? prepareClinicalEnrichmentDocument)({
    vaultRoot: input.vaultRoot,
    documentPath: unit.documentPath,
    mediaType: unit.source.mediaType,
    page: unit.page,
    signal,
  });
}

/** One page passes through; a group's pages and text join, each text under its page marker. */
function combinePreparedPages(units: readonly ExtractionUnit[], prepared: readonly PreparedDocument[]): PreparedDocument {
  if (prepared.length === 1) return prepared[0]!;
  const texts = prepared.flatMap((page, index) => page.extractedText ? [`--- page ${units[index]!.page} ---\n${page.extractedText}`] : []);
  return {
    totalPages: prepared[0]!.totalPages,
    renderedPages: prepared.flatMap((page) => page.renderedPages),
    scratchRoots: prepared.flatMap((page) => page.scratchRoots),
    ...(texts.length > 0 ? { extractedText: texts.join("\n\n") } : {}),
    async cleanup() {},
  };
}

/** A finished group's records for one page; every record names its supplied page. */
function pageOutputs(outputs: ExtractionOutputs, page: number): ExtractionOutputs {
  const onPage = (output: ClinicalDocumentExtractionOutput): ClinicalDocumentExtractionOutput =>
    ({ status: "complete", records: output.records.filter((record) => record.page === page) });
  return { labs: onPage(outputs.labs), measurements: onPage(outputs.measurements), history: onPage(outputs.history) };
}

/**
 * The publication critical section for one outcome: cache save or cursor
 * failure settlement, usage registration, dirty notice and the job's wake.
 */
async function publishHostedClinicalOutcome({ input, state, outcome, failedLookahead, solo, undelivered, now }: {
  input: HostedClinicalEnrichmentInput;
  state: NonNullable<HostedClinicalEnrichmentInput["state"]>;
  outcome: HostedClinicalExtractionOutcome;
  failedLookahead: Set<string>;
  solo: Set<string>;
  undelivered: Set<string>;
  now: () => string;
}): Promise<void> {
  const { units, result } = outcome;
  const unit = units[0]!;
  if (result.kind === "abandoned") return;
  if (result.kind !== "extracted" && units.length > 1) {
    // No job state changes: each page runs again alone, under its own retry budget.
    for (const member of units) solo.add(member.key);
    return;
  }
  if (result.kind !== "extracted" && !unit.cursor) {
    failedLookahead.add(unit.key);
    return;
  }
  let nextAttemptAt: string | null = null;
  if (result.kind === "extracted") {
    for (const [index, member] of units.entries()) {
      await state.saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: member, totalPages: result.totalPages, outputs: result.outputs[index]! });
    }
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
 * One pass per page group or resource covers labs, measurements and history together.
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
  prepared: PreparedDocument;
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
