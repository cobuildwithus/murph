import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";
import type { ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { runOneHostedClinicalEnrichment, type HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";

const provider = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@murphai/assistant-engine/assistant-codex", () => ({
  executeCodexAppServerTurn: provider.execute,
  readCodexAppServerTurnFailureContext: () => null,
}));

it.each([
  { initialMs: 100_000, cancel: false, correctionCalls: 0 },
  { initialMs: 50_000, cancel: false, correctionCalls: 1 },
  { initialMs: 100_000, cancel: true, correctionCalls: 0 },
])("preserves extraction after $initialMs ms with cancellation=$cancel", async ({ initialMs, cancel, correctionCalls }) => {
  const vaultRoot = await realpath(await mkdtemp(path.join(tmpdir(), "clinical-recovery-deadline-")));
  const rawRef = "raw/clinical/fhir/synthetic/batch/attachments/report.txt";
  const documentPath = path.join(vaultRoot, rawRef);
  const text = "Synthetic clinical report. Exam 2020-03-12T12:00:00Z. Glucose 90 mg/dL, pulse 72 bpm. Routine review.";
  const date = { dateBasis: "document" as const, dateEvidence: "2020-03-12T12:00:00Z" };
  const at = "2020-03-12T12:00:00Z";
  const outputs: Record<string, ClinicalDocumentExtractionOutput> = {
    labs: { status: "complete", records: [{ ...date, payload: { kind: "test", occurredAt: at, title: "Glucose", note: "Glucose result.", resultStatus: "unknown", testName: "Glucose", results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }] } }] },
    measurements: { status: "complete", records: [
      { ...date, payload: { kind: "measurement", occurredAt: at, title: "Pulse", note: "Pulse reading.", measurements: [{ metric: "heart-rate", value: 72, unit: "bpm" }] } },
      { ...date, payload: { kind: "measurement", occurredAt: "2026-07-10T12:00:00Z", title: "Unsupported date", note: "Pulse reading.", measurements: [{ metric: "heart-rate", value: 73, unit: "bpm" }] } },
    ] },
    history: { status: "complete", records: [{ ...date, payload: { kind: "note", occurredAt: at, title: "Routine review", note: "Routine review." } }] },
  };
  const state = {
    readNextClinicalEnrichment: vi.fn().mockResolvedValue({ status: "extract", jobId: "a".repeat(64), page: 1, timeZone: "UTC", documentPath,
      source: { rawRef, sha256: createHash("sha256").update(text).digest("hex"), mediaType: "text/plain" } }),
    persistClinicalEnrichmentProposals: vi.fn().mockResolvedValue(undefined),
    blockClinicalEnrichment: vi.fn(), deferClinicalEnrichment: vi.fn().mockResolvedValue({ nextAttemptAt: "2026-07-10T13:00:00Z" }),
  };
  const parent = new AbortController();
  let elapsed = 0;
  const deadlines: { at: number; controller: AbortController }[] = [];
  const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const timer = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    deadlines.push({ at: elapsed + ms, controller });
    return controller.signal;
  });
  const advance = (ms: number) => {
    elapsed += ms;
    for (const deadline of deadlines) if (deadline.at <= elapsed) deadline.controller.abort(new Error("Synthetic deadline"));
  };
  let initialCalls = 0;
  let releaseInitial!: () => void;
  const allInitialStarted = new Promise<void>((resolve) => { releaseInitial = resolve; });
  provider.execute.mockImplementation(async (turn) => {
    const assignment = JSON.parse(turn.prompt.slice(turn.prompt.indexOf("{")));
    if (assignment.invalidRecords) {
      // A correction taking 25 seconds fits its own 30-second cap, but would
      // cross the page deadline after the 100-second initial extraction.
      advance(25_000);
      turn.abortSignal?.throwIfAborted();
      return { finalMessage: JSON.stringify({ corrections: [] }), jsonEvents: [] };
    }
    initialCalls++;
    if (initialCalls === 3) {
      advance(initialMs);
      if (cancel) parent.abort();
      releaseInitial();
    }
    await allInitialStarted;
    return { finalMessage: JSON.stringify(outputs[assignment.family]), jsonEvents: [] };
  });
  const input: HostedClinicalEnrichmentInput = {
    abortSignal: parent.signal, codexHome: null, env: {}, vaultRoot, memberId: "synthetic-member",
    state, onStateMutation() {}, resolveProviderAuthority: async () => "current",
    prepareDocument: async () => ({ totalPages: 1, extractedText: text, renderedPages: [], scratchRoots: [], async cleanup() {} }),
  };
  try {
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, text);
    const result = await runOneHostedClinicalEnrichment(input);
    expect({ result, calls: provider.execute.mock.calls.length, elapsed }).toEqual({
      result: cancel ? "idle" : "settled", calls: 3 + correctionCalls, elapsed: initialMs + correctionCalls * 25_000,
    });
    expect(state.deferClinicalEnrichment).not.toHaveBeenCalled();
    expect(state.blockClinicalEnrichment).not.toHaveBeenCalled();
    if (cancel) expect(state.persistClinicalEnrichmentProposals).not.toHaveBeenCalled();
    else {
      expect(state.persistClinicalEnrichmentProposals).toHaveBeenCalledOnce();
      expect(state.persistClinicalEnrichmentProposals).toHaveBeenCalledWith(expect.objectContaining({ outputs: {
        labs: outputs.labs, history: outputs.history,
        measurements: { ...outputs.measurements, status: "blocked", reason: expect.any(String) },
      } }));
    }
  } finally {
    clock.mockRestore(); timer.mockRestore(); provider.execute.mockReset();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
