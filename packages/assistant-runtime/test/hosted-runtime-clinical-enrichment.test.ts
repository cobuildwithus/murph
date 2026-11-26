import { describe, expect, it, vi } from "vitest";
import type { ClinicalDocumentExtractionInput } from "@murphai/assistant-engine/clinical-document-extraction";
import { clinicalDocumentExtractionOutputSchema, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import type { ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";

import { ClinicalEnrichmentDocumentError } from "../src/hosted-runtime/clinical-enrichment-document.ts";
import { createHostedClinicalEnrichmentRunner, groupClinicalExtractionUnits, type HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";
import type { ClinicalExtractionUnit } from "@murphai/vault-usecases/clinical-enrichment";

const NOW = "2026-09-11T12:00:00.000Z";
const EMPTY: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const SYNTHETIC_USAGE_EVENT: ReadOnlyAssistantAskProviderUsageEvent = {
  stage: "answer",
  usage: {
    occurredAt: NOW,
    provider: "codex-cli",
    providerRequestOrdinal: 1,
    providerRequestOutcome: "succeeded",
    usage: {
      apiKeyEnv: null, baseUrl: null, cacheWriteTokens: null, cachedInputTokens: null,
      inputTokens: 10, outputTokens: 2, providerMetadataJson: null,
      providerName: "hosted-openai", providerRequestId: null,
      rawUsageJson: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      reasoningTokens: null, requestedModel: "synthetic-model", servedModel: "synthetic-model",
      tokenPricingBasis: "standard", totalTokens: 12, turnProfileJson: null,
      usageExtractionSourcePath: "test.usage", usageExtractionVersion: "test-v1",
    },
  },
};
const unit: ClinicalExtractionUnit = {
  key: "synthetic-key/2.json",
  jobId: "a".repeat(64),
  cursor: true,
  cursorRef: "0:0:2",
  locator: { attachmentIndex: 0 },
  cacheSha256: "c".repeat(64),
  source: { rawRef: "raw/clinical-records/synthetic/source.pdf", sha256: "b".repeat(64), mediaType: "application/pdf" },
  documentPath: "/synthetic-vault/raw/clinical-records/synthetic/source.pdf",
  page: 2,
  timeZone: "America/Los_Angeles",
  failures: 0,
};
const occurredAt = "2026-09-01T12:00:00Z";
const SPLIT_RECORDS = clinicalDocumentExtractionOutputSchema.parse({ status: "complete", records: [
  { payload: { kind: "test", occurredAt, title: "Laboratory report", testName: "Glucose", resultStatus: "normal", results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }] }, dateBasis: "document", dateEvidence: "Sep 1, 2026", page: 2 },
  { payload: { kind: "measurement", occurredAt, title: "Blood pressure", measurements: [{ metric: "systolic-blood-pressure", value: 120, unit: "mmHg" }] }, dateBasis: "document", dateEvidence: "Sep 1, 2026", page: 2 },
  { payload: { kind: "clinical_assertion", occurredAt, title: "Symptom denial", assertion: "denial_asserted", assertedOn: "2026-09-01", domain: "symptom", polarity: "denied", subject: "Nausea", assertionText: "Denies nausea." }, dateBasis: "document", dateEvidence: "Sep 1, 2026", page: 2 },
] }).records;
const [LAB, VITAL, DENIAL] = [SPLIT_RECORDS[0]!, SPLIT_RECORDS[1]!, SPLIT_RECORDS[2]!];
const documentPage = (page: number, cursor = page === 1): ClinicalExtractionUnit =>
  ({ ...unit, key: `synthetic-key/${page}.json`, page, cursor, cursorRef: `document:0:${page}` });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function setup(units: ClinicalExtractionUnit[] = [unit]) {
  const queue = [...units];
  const state = {
    // Each unit is planned once, the way a saved cache entry leaves the plan.
    planClinicalExtractionUnits: vi.fn<NonNullable<HostedClinicalEnrichmentInput["state"]>["planClinicalExtractionUnits"]>(async ({ limit, exclude }) => {
      const planned = queue.filter((candidate) => !exclude?.(candidate)).slice(0, limit);
      for (const candidate of planned) queue.splice(queue.indexOf(candidate), 1);
      return planned;
    }),
    saveClinicalExtraction: vi.fn<NonNullable<HostedClinicalEnrichmentInput["state"]>["saveClinicalExtraction"]>().mockResolvedValue("saved"),
    blockClinicalEnrichment: vi.fn().mockResolvedValue(undefined),
    deferClinicalEnrichment: vi.fn().mockResolvedValue({ status: "pending", nextAttemptAt: "2026-09-11T12:01:00.000Z" }),
  };
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const prepareDocument = vi.fn().mockResolvedValue({
    totalPages: 5,
    extractedText: "Synthetic clinical page.",
    renderedPages: [{ page: 2, path: "/synthetic-scratch/page.png" }],
    scratchRoots: ["/synthetic-scratch"],
    cleanup,
  });
  const executeExtraction = vi.fn(async (input: ClinicalDocumentExtractionInput) => {
    await input.beforeProviderEntry?.();
    return EMPTY;
  });
  const onError = vi.fn();
  const input: HostedClinicalEnrichmentInput = {
    codexHome: null,
    env: {},
    memberId: "synthetic-member",
    vaultRoot: "/synthetic-vault",
    now: () => NOW,
    onStateMutation: vi.fn(),
    onWorkUpdated: vi.fn().mockResolvedValue(undefined),
    resolveRuntimeAuthority: vi.fn().mockResolvedValue("current"),
    state,
    prepareDocument,
    executeExtraction,
  };
  const run = () => {
    const runner = createHostedClinicalEnrichmentRunner({ ...input, onError });
    runner.kick();
    return runner;
  };
  return { input, state, cleanup, prepareDocument, executeExtraction, onError, run, queue };
}

describe("clinical document background runner", () => {
  it("reads one page in a single Terra Flex pass and saves it to the cache before waking the job", async () => {
    const { input, state, executeExtraction, cleanup, run } = setup();
    const leaf = deferred<ClinicalDocumentExtractionOutput>();
    executeExtraction.mockImplementation(async (request) => {
      await request.beforeProviderEntry?.();
      return leaf.promise;
    });
    run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledOnce());
    expect(state.saveClinicalExtraction).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    const [request] = executeExtraction.mock.calls[0]!;
    expect(request).toMatchObject({ family: "all", model: "gpt-6.1-terra", reasoningEffort: "low", serviceTier: "flex",
      source: unit.source, timeZone: unit.timeZone, renderedPages: [{ page: 2, path: "/synthetic-scratch/page.png" }] });
    leaf.resolve({ status: "blocked", records: [LAB, VITAL, DENIAL], reason: "Synthetic ambiguous history." });
    await vi.waitFor(() => expect(input.onWorkUpdated).toHaveBeenCalledWith(unit.jobId, null));
    expect(state.saveClinicalExtraction).toHaveBeenCalledWith(expect.objectContaining({
      unit, totalPages: 5,
      outputs: {
        labs: { status: "complete", records: [LAB] },
        measurements: { status: "complete", records: [VITAL] },
        history: { status: "blocked", records: [DENIAL], reason: "Synthetic ambiguous history." },
      },
    }));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("reads up to four consecutive PDF pages in one pass and saves each page's records", async () => {
    const { input, state, prepareDocument, executeExtraction, cleanup, run } = setup([1, 2, 3, 4, 5].map((page) => documentPage(page)));
    prepareDocument.mockImplementation(async ({ page }) => ({
      totalPages: 5, extractedText: `Synthetic page ${page}.`, renderedPages: [{ page, path: `/synthetic-scratch-${page}/page.png` }],
      scratchRoots: [`/synthetic-scratch-${page}`], cleanup,
    }));
    executeExtraction.mockImplementation(async (request) => {
      await request.beforeProviderEntry?.();
      return request.renderedPages?.length === 4
        ? { status: "complete", records: [{ ...LAB, page: 1 }, { ...VITAL, page: 3 }, { ...DENIAL, page: 3 }] }
        : { status: "complete", records: [{ ...LAB, page: 5 }] };
    });
    run();
    await vi.waitFor(() => expect(state.saveClinicalExtraction).toHaveBeenCalledTimes(5));
    expect(executeExtraction).toHaveBeenCalledTimes(2);
    const [group] = executeExtraction.mock.calls.find(([request]) => request.renderedPages?.length === 4)!;
    expect(group).toMatchObject({ family: "all", model: "gpt-6.1-terra", serviceTier: "flex",
      renderedPages: [1, 2, 3, 4].map((page) => ({ page, path: `/synthetic-scratch-${page}/page.png` })),
      scratchRoots: [1, 2, 3, 4].map((page) => `/synthetic-scratch-${page}`),
      extractedText: [1, 2, 3, 4].map((page) => `--- page ${page} ---\nSynthetic page ${page}.`).join("\n\n") });
    const saved = new Map(state.saveClinicalExtraction.mock.calls.map(([call]) => [call.unit.page, call.outputs]));
    expect(saved.get(1)).toEqual({ labs: { status: "complete", records: [{ ...LAB, page: 1 }] },
      measurements: { status: "complete", records: [] }, history: { status: "complete", records: [] } });
    expect(saved.get(2)).toEqual({ labs: { status: "complete", records: [] },
      measurements: { status: "complete", records: [] }, history: { status: "complete", records: [] } });
    expect(saved.get(3)).toEqual({ labs: { status: "complete", records: [] },
      measurements: { status: "complete", records: [{ ...VITAL, page: 3 }] }, history: { status: "complete", records: [{ ...DENIAL, page: 3 }] } });
    expect(saved.get(5)?.labs.records).toEqual([{ ...LAB, page: 5 }]);
    expect(cleanup).toHaveBeenCalledTimes(5);
    await vi.waitFor(() => expect(input.onWorkUpdated).toHaveBeenCalledTimes(2));
  });

  for (const [name, groupResult] of [
    ["reports blocked", { status: "blocked", reason: "Synthetic facts on pages 2 and 3 remain.", records: [{ ...LAB, page: 1 }] }],
    // At the record limit a complete-looking answer can still have dropped a tail of facts.
    ["reaches the record limit", { status: "complete", records: Array.from({ length: 100 }, (_, index) => ({ ...LAB, page: 1 + (index % 3) })) }],
  ] as const) {
    it(`runs a group's pages alone, under their own retry rules, when the group ${name}`, async () => {
      const pages = [1, 2, 3].map((page) => documentPage(page));
      const { state, prepareDocument, executeExtraction, cleanup, run, queue } = setup(pages);
      prepareDocument.mockImplementation(async ({ page }) => ({
        totalPages: 3, renderedPages: [{ page, path: `/synthetic-scratch-${page}/page.png` }], scratchRoots: [`/synthetic-scratch-${page}`], cleanup,
      }));
      executeExtraction.mockImplementation(async (request) => {
        await request.beforeProviderEntry?.();
        const supplied = request.renderedPages?.map(({ page }) => page) ?? [];
        if (supplied.length > 1) {
          // Nothing was saved, so the next plan offers the same pages again.
          queue.push(...pages);
          return groupResult as ClinicalDocumentExtractionOutput;
        }
        if (supplied[0] === 2) throw new Error("Synthetic provider unavailable.");
        return { status: "complete", records: [{ ...LAB, page: supplied[0]! }] };
      });
      // A group never touches job state itself; each page settles on the single-page rules.
      const runner = run();
      await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(4));
      await vi.waitFor(() => expect(runner.hasOwnedWork()).toBe(false));
      expect(executeExtraction.mock.calls.map(([request]) => request.renderedPages?.map(({ page }) => page)))
        .toEqual(expect.arrayContaining([[1, 2, 3], [1], [2], [3]]));
      expect(state.saveClinicalExtraction.mock.calls.map(([call]) => call.unit.page).sort()).toEqual([1, 3]);
      // Page 2 ran ahead of the cursor, so its failure stays outside the cursor's attempt budget.
      expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(6);
    });
  }

  it("gives a page repeated within one plan a single owner", async () => {
    // Two attachments hold the same PDF and clinical date, so their pages share cache keys.
    const first = [1, 2, 3, 4, 5].map((page) => (page === 1 ? { ...documentPage(page), failures: 1 } : documentPage(page)));
    const second = [1, 2, 3, 4].map((page) => ({ ...documentPage(page, false), locator: { attachmentIndex: 1 }, cursorRef: `document:1:${page}` }));
    const { executeExtraction, run } = setup([...first, ...second]);
    const runner = run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(runner.hasOwnedWork()).toBe(false));
    expect(executeExtraction.mock.calls.map(([request]) => request.renderedPages?.length)).toEqual([1, 4]);
  });

  it("groups only consecutive first-attempt pages of one PDF, four at a time", () => {
    const resource = { ...unit, key: "resource/1.json", page: 1, locator: { resourceIndex: 0 },
      source: { ...unit.source, resource: { rawRef: "raw/clinical-records/synthetic/bundle.json", resourceType: "Observation", resourceId: "synthetic", sha256: "d".repeat(64) } } };
    const image = { ...documentPage(1), key: "image/1.json", locator: { attachmentIndex: 1 }, source: { ...unit.source, mediaType: "image/png" } };
    const pages = [1, 2, 3, 4, 5, 6].map((page) => documentPage(page));
    const retried = { ...documentPage(8), failures: 1 };
    const otherDocument = { ...documentPage(9), key: "other/10.json", locator: { attachmentIndex: 2 } };
    const groups = groupClinicalExtractionUnits(
      [...pages, retried, documentPage(9), otherDocument, { ...documentPage(10), key: "solo/10.json" }, documentPage(11), resource, image],
      new Set(["solo/10.json"]),
    );
    expect(groups.map((group) => group.map((member) => member.key))).toEqual([
      ["synthetic-key/1.json", "synthetic-key/2.json", "synthetic-key/3.json", "synthetic-key/4.json"],
      ["synthetic-key/5.json", "synthetic-key/6.json"],
      ["synthetic-key/8.json"], ["synthetic-key/9.json"], ["other/10.json"], ["solo/10.json"], ["synthetic-key/11.json"],
      ["resource/1.json"], ["image/1.json"],
    ]);
  });

  it("runs several units at once, retries on the standard tier and reads structured resources with Luna", async () => {
    const retry = { ...unit, key: "retry/1.json", page: 1, failures: 1 };
    const resource = { ...unit, key: "resource/1.json", page: 1, extractedText: "{}", locator: { resourceIndex: 0 },
      source: { ...unit.source, resource: { rawRef: "raw/clinical-records/synthetic/bundle.json", resourceType: "Observation", resourceId: "synthetic", sha256: "d".repeat(64) } } };
    const { executeExtraction, run } = setup([retry, resource]);
    const leaves = [deferred<ClinicalDocumentExtractionOutput>(), deferred<ClinicalDocumentExtractionOutput>()];
    executeExtraction.mockImplementation(async (request) => leaves[executeExtraction.mock.calls.length - 1]!.promise.then((output) => {
      void request;
      return output;
    }));
    run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(2));
    expect(executeExtraction.mock.calls.map(([request]) => [request.family, request.model, request.reasoningEffort, request.serviceTier]))
      .toEqual(expect.arrayContaining([["all", "gpt-6.1-terra", "low", null], ["all", "gpt-6-luna", "medium", undefined]]));
    for (const leaf of leaves) leaf.resolve(EMPTY);
  });

  it("does not release scratch or publish after release until the pass exits", async () => {
    const { state, executeExtraction, cleanup, run } = setup();
    const leaf = deferred<ClinicalDocumentExtractionOutput>();
    executeExtraction.mockImplementation(() => leaf.promise);
    const runner = run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledOnce());
    const release = runner.closeAndRequeue();
    await Promise.resolve();
    expect(executeExtraction.mock.calls[0]![0].abortSignal?.aborted).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();
    leaf.resolve(EMPTY);
    await release;
    expect(state.saveClinicalExtraction).not.toHaveBeenCalled();
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("durably defers the cursor's failed unit at its exact cursor", async () => {
    const { input, state, executeExtraction, run } = setup();
    executeExtraction.mockRejectedValueOnce(new Error("Synthetic provider unavailable."));
    run();
    await vi.waitFor(() => expect(input.onWorkUpdated).toHaveBeenCalledWith(unit.jobId, "2026-09-11T12:01:00.000Z"));
    expect(state.saveClinicalExtraction).not.toHaveBeenCalled();
    expect(state.deferClinicalEnrichment).toHaveBeenCalledWith(expect.objectContaining({
      jobId: unit.jobId, cursorRef: unit.cursorRef, nextAttemptAt: "2026-09-11T12:01:00.000Z",
    }));
  });

  it("keeps a failed lookahead unit outside the cursor's attempt budget and leaves it for the cursor", async () => {
    const lookahead = { ...unit, key: "ahead/3.json", page: 3, cursor: false, cursorRef: "0:0:3" };
    const { state, executeExtraction, run, queue } = setup([lookahead]);
    executeExtraction.mockRejectedValueOnce(new Error("Synthetic provider unavailable."));
    const runner = run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runner.hasOwnedWork()).toBe(false));
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(state.blockClinicalEnrichment).not.toHaveBeenCalled();
    // The same unit is not retried ahead of the cursor; once it is the cursor it runs again.
    queue.push(lookahead);
    runner.kick();
    await vi.waitFor(() => expect(state.planClinicalExtractionUnits).toHaveBeenCalledTimes(3));
    expect(executeExtraction).toHaveBeenCalledOnce();
    queue.splice(0, queue.length, { ...lookahead, cursor: true });
    runner.kick();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(2));
  });

  it("bounds each unit to two minutes and preserves retry ownership after timeout", async () => {
    const { state, executeExtraction, run } = setup();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      executeExtraction.mockImplementation((request) => new Promise((_resolve, reject) => {
        request.abortSignal?.addEventListener("abort", () => reject(new Error("Synthetic deadline.")), { once: true });
      }));
      run();
      await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledOnce());
      expect(timeout).toHaveBeenCalledWith(120_000);
      deadline.abort();
      await vi.waitFor(() => expect(state.deferClinicalEnrichment).toHaveBeenCalledOnce());
      expect(state.saveClinicalExtraction).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("distinguishes unsupported source evidence from a retryable renderer failure", async () => {
    const { state, prepareDocument, executeExtraction, run } = setup([unit, { ...unit, key: "retry/2.json" }]);
    prepareDocument.mockRejectedValueOnce(new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_UNSUPPORTED"));
    prepareDocument.mockRejectedValueOnce(new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED"));
    run();
    await vi.waitFor(() => expect(state.blockClinicalEnrichment).toHaveBeenCalledWith(expect.objectContaining({ cursorRef: unit.cursorRef })));
    await vi.waitFor(() => expect(state.deferClinicalEnrichment).toHaveBeenCalledOnce());
    expect(executeExtraction).not.toHaveBeenCalled();
  });

  it("retains a failed cache write as a release barrier instead of retrying provider work", async () => {
    const { state, cleanup, onError, run } = setup();
    const failure = new Error("Synthetic durable write failure.");
    state.saveClinicalExtraction.mockRejectedValue(failure);
    const runner = run();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(runner.closeAndRequeue()).rejects.toBe(failure);
  });

  it("records each call's usage as soon as it ends, before its result publishes", async () => {
    const { input, state, executeExtraction, run } = setup();
    const records: AssistantUsageRecord[] = [];
    input.usageRecordPort = { async recordUsage(record) {
      records.push(record);
      return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
    } };
    state.saveClinicalExtraction.mockImplementation(async () => {
      // A rollout or kill after this point can no longer drop the usage rows.
      expect(records).toHaveLength(2);
      return "saved";
    });
    executeExtraction.mockImplementation(async (request) => {
      await request.beforeProviderEntry?.();
      request.onProviderUsage?.(SYNTHETIC_USAGE_EVENT);
      request.onProviderUsage?.({ ...SYNTHETIC_USAGE_EVENT, stage: "review" });
      return EMPTY;
    });
    run();
    await vi.waitFor(() => expect(state.saveClinicalExtraction).toHaveBeenCalledOnce());
    expect(new Set(records.map((record) => record.usageId)).size).toBe(2);
    expect(records.every((record) => record.featureKey === "clinical_document_extraction")).toBe(true);
    expect(records.every((record) => record.memberId === "synthetic-member")).toBe(true);
  });

  it("records the usage of a call that a release aborts", async () => {
    const { input, state, executeExtraction, run } = setup();
    const records: AssistantUsageRecord[] = [];
    input.usageRecordPort = { async recordUsage(record) {
      records.push(record);
      return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
    } };
    executeExtraction.mockImplementation((request) => new Promise((_resolve, reject) => {
      request.onProviderUsage?.(SYNTHETIC_USAGE_EVENT);
      request.abortSignal?.addEventListener("abort", () => reject(new Error("Synthetic abort.")), { once: true });
    }));
    const runner = run();
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledOnce());
    await runner.closeAndRequeue();
    expect(records).toHaveLength(1);
    expect(state.saveClinicalExtraction).not.toHaveBeenCalled();
  });
});
