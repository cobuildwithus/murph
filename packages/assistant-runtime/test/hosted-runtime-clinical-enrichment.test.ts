import { describe, expect, it, vi } from "vitest";
import type { ClinicalDocumentExtractionInput } from "@murphai/assistant-engine/clinical-document-extraction";
import type { ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import type { ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import type { HostedWorkspaceDurableCheckpointEffect } from "../src/hosted-runtime/workspace-runner.ts";

import { ClinicalEnrichmentDocumentError } from "../src/hosted-runtime/clinical-enrichment-document.ts";
import { runOneHostedClinicalEnrichment, type HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";

const NOW = "2026-09-11T12:00:00.000Z";
const EMPTY: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const work = {
  status: "extract" as const,
  jobId: "a".repeat(64),
  source: { rawRef: "raw/clinical-records/synthetic/source.pdf", sha256: "b".repeat(64), mediaType: "application/pdf" },
  documentPath: "/synthetic-vault/raw/clinical-records/synthetic/source.pdf",
  page: 2,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function setup() {
  const abort = new AbortController();
  const state = {
    readNextClinicalEnrichment: vi.fn<NonNullable<HostedClinicalEnrichmentInput["state"]>["readNextClinicalEnrichment"]>().mockResolvedValue(work),
    persistClinicalEnrichmentProposals: vi.fn().mockResolvedValue(undefined),
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
  const input: HostedClinicalEnrichmentInput = {
    abortSignal: abort.signal,
    codexHome: null,
    env: {},
    memberId: "synthetic-member",
    vaultRoot: "/synthetic-vault",
    now: () => NOW,
    onStateMutation: vi.fn(),
    onExtractionStarted: vi.fn(),
    onWorkUpdated: vi.fn().mockResolvedValue(undefined),
    resolveProviderAuthority: vi.fn().mockResolvedValue("current"),
    state,
    prepareDocument,
    executeExtraction,
  };
  return { input, abort, state, cleanup, prepareDocument, executeExtraction };
}

describe("clinical document background runner", () => {
  it("does not open an extraction checkpoint window for an empty queue", async () => {
    const { input, state, executeExtraction } = setup();
    state.readNextClinicalEnrichment.mockResolvedValueOnce(null);
    expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
    expect(input.onExtractionStarted).not.toHaveBeenCalled();
    expect(input.onStateMutation).not.toHaveBeenCalled();
    expect(executeExtraction).not.toHaveBeenCalled();
  });
  it("runs exactly three independent families for one page and freezes proposals before waking canonical apply", async () => {
    const { input, state, executeExtraction, cleanup } = setup();
    const leaves = [deferred<ClinicalDocumentExtractionOutput>(), deferred<ClinicalDocumentExtractionOutput>(), deferred<ClinicalDocumentExtractionOutput>()];
    executeExtraction.mockImplementation(async (request) => {
      await request.beforeProviderEntry?.();
      return leaves[["labs", "measurements", "history"].indexOf(request.family)]!.promise;
    });
    const running = runOneHostedClinicalEnrichment(input);
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(3));
    expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    expect(input.onExtractionStarted).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    for (const [request] of executeExtraction.mock.calls) {
      expect(request.source).toEqual(work.source);
      expect(request.renderedPages).toEqual([{ page: 2, path: "/synthetic-scratch/page.png" }]);
    }
    leaves[0]!.resolve(EMPTY);
    leaves[1]!.resolve(EMPTY);
    leaves[2]!.resolve({ status: "blocked", records: [], reason: "Synthetic ambiguous history." });
    expect(await running).toBe("settled");
    expect(state.persistClinicalEnrichmentProposals).toHaveBeenCalledWith(expect.objectContaining({
      jobId: work.jobId, sourceSha256: work.source.sha256, page: 2, totalPages: 5,
      outputs: { labs: EMPTY, measurements: EMPTY, history: { status: "blocked", records: [], reason: "Synthetic ambiguous history." } },
    }));
    expect(input.onWorkUpdated).toHaveBeenCalledWith(work.jobId, null);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not release scratch or persist after cancellation until every child exits", async () => {
    const { input, abort, state, executeExtraction, cleanup } = setup();
    const leaves = [deferred<ClinicalDocumentExtractionOutput>(), deferred<ClinicalDocumentExtractionOutput>(), deferred<ClinicalDocumentExtractionOutput>()];
    executeExtraction.mockImplementation((request) => leaves[["labs", "measurements", "history"].indexOf(request.family)]!.promise);
    const running = runOneHostedClinicalEnrichment(input);
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(3));
    abort.abort();
    leaves[0]!.resolve(EMPTY);
    leaves[1]!.resolve(EMPTY);
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    leaves[2]!.resolve(EMPTY);
    expect(await running).toBe("idle");
    expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("aborts sibling leaves on provider failure and durably defers the unchanged page after joining", async () => {
    const { input, state, executeExtraction, cleanup } = setup();
    const failure = deferred<ClinicalDocumentExtractionOutput>();
    const sibling = deferred<ClinicalDocumentExtractionOutput>();
    executeExtraction.mockImplementation((request) => request.family === "labs" ? failure.promise : sibling.promise);
    const running = runOneHostedClinicalEnrichment(input);
    await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(3));
    failure.reject(new Error("Synthetic provider unavailable."));
    await vi.waitFor(() => expect(executeExtraction.mock.calls[1]![0].abortSignal?.aborted).toBe(true));
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    sibling.resolve(EMPTY);
    expect(await running).toBe("idle");
    expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    expect(state.deferClinicalEnrichment).toHaveBeenCalledWith(expect.objectContaining({ jobId: work.jobId, nextAttemptAt: "2026-09-11T12:01:00.000Z" }));
    expect(input.onWorkUpdated).toHaveBeenCalledWith(work.jobId, "2026-09-11T12:01:00.000Z");
  });

  it("checks current provider authority before entry and leaves work resumable on handoff", async () => {
    const { input, state } = setup();
    input.resolveProviderAuthority = vi.fn().mockResolvedValue("handoff");
    expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
    expect(input.resolveProviderAuthority).toHaveBeenCalled();
    expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
  });

  it("bounds each page to two minutes and preserves retry ownership after timeout", async () => {
    const { input, state, executeExtraction } = setup();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      executeExtraction.mockImplementation((request) => new Promise((_resolve, reject) => {
        request.abortSignal?.addEventListener("abort", () => reject(new Error("Synthetic deadline.")), { once: true });
      }));
      const running = runOneHostedClinicalEnrichment(input);
      await vi.waitFor(() => expect(executeExtraction).toHaveBeenCalledTimes(3));
      expect(timeout).toHaveBeenCalledWith(120_000);
      deadline.abort();
      expect(await running).toBe("idle");
      expect(state.deferClinicalEnrichment).toHaveBeenCalledOnce();
      expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("continues other documents when the durable owner exhausts one document's retries", async () => {
    const { input, state, executeExtraction } = setup();
    executeExtraction.mockRejectedValue(new Error("Synthetic provider unavailable."));
    state.deferClinicalEnrichment.mockResolvedValue({ status: "pending", nextAttemptAt: undefined });
    expect(await runOneHostedClinicalEnrichment(input)).toBe("settled");
    expect(input.onWorkUpdated).toHaveBeenCalledWith(work.jobId, null);
  });

  it("does not resample durable proposals and does not launch not-due work", async () => {
    const { input, state, executeExtraction } = setup();
    state.readNextClinicalEnrichment.mockResolvedValueOnce({ status: "apply", jobId: work.jobId });
    expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
    state.readNextClinicalEnrichment.mockResolvedValueOnce({ status: "deferred", jobId: work.jobId, nextAttemptAt: "2026-09-11T12:01:00.000Z" });
    expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
    expect(executeExtraction).not.toHaveBeenCalled();
    expect(input.onWorkUpdated).toHaveBeenCalledWith(work.jobId, "2026-09-11T12:01:00.000Z");
  });

  it("distinguishes unsupported source evidence from a retryable renderer failure", async () => {
    const { input, state, prepareDocument, executeExtraction } = setup();
    prepareDocument.mockRejectedValueOnce(new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_UNSUPPORTED"));
    expect(await runOneHostedClinicalEnrichment(input)).toBe("settled");
    expect(state.blockClinicalEnrichment).toHaveBeenCalledOnce();
    prepareDocument.mockRejectedValueOnce(new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED"));
    expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
    expect(state.deferClinicalEnrichment).toHaveBeenCalledOnce();
    expect(executeExtraction).not.toHaveBeenCalled();
  });

  it("retains a failed proposal write as an ownership barrier instead of retrying provider work", async () => {
    const { input, state, cleanup } = setup();
    state.persistClinicalEnrichmentProposals.mockRejectedValue(new Error("Synthetic durable write failure."));
    await expect(runOneHostedClinicalEnrichment(input)).rejects.toThrow("Synthetic durable write failure.");
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("accounts each family separately after checkpoint even when their provider ordinals match", async () => {
    const { input, executeExtraction } = setup();
    const effects: HostedWorkspaceDurableCheckpointEffect[] = [];
    const records: AssistantUsageRecord[] = [];
    input.usageRecordPort = { async recordUsage(record) {
      records.push(record);
      return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
    } };
    input.deferUsageUntilAfterDurableCheckpoint = (effect) => { effects.push(effect); };
    const event: ReadOnlyAssistantAskProviderUsageEvent = {
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
    executeExtraction.mockImplementation(async (request) => {
      await request.beforeProviderEntry?.();
      request.onProviderUsage?.(event);
      return EMPTY;
    });
    expect(await runOneHostedClinicalEnrichment(input)).toBe("settled");
    expect(records).toEqual([]);
    expect(effects).toHaveLength(1);
    await effects[0]!();
    expect(records).toHaveLength(3);
    expect(new Set(records.map((record) => record.usageId)).size).toBe(3);
    expect(records.every((record) => record.featureKey === "clinical_document_extraction")).toBe(true);
    expect(records.every((record) => record.memberId === "synthetic-member")).toBe(true);
  });
});
