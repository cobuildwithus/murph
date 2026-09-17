import { setImmediate } from "node:timers/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { expect, test, vi } from "vitest";
import * as clinicalEnrichment from "../src/hosted-runtime/clinical-enrichment.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeferred, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test("drains checkpoint-ready effects before restarting an unfinished clinical page", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-checkpoint-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const extractionStarted = createDeferred<void>();
  const successorAt = new Date(Date.now() + 600_000).toISOString();
  const actualRunOne = clinicalEnrichment.runOneHostedClinicalEnrichment;
  const readNextClinicalEnrichment = vi.fn(async () => ({
    status: "extract" as const, jobId: "a".repeat(64), page: 2,
    source: { rawRef: "raw/clinical-records/synthetic/source.pdf", sha256: "b".repeat(64), mediaType: "application/pdf" },
    documentPath: "/synthetic-vault/raw/clinical-records/synthetic/source.pdf",
  }));
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation((input) => actualRunOne({
      ...input,
      state: {
        readNextClinicalEnrichment,
        persistClinicalEnrichmentProposals: vi.fn(),
        blockClinicalEnrichment: vi.fn(),
        deferClinicalEnrichment: vi.fn(),
      },
      async prepareDocument({ signal }) {
        if (!signal) throw new Error("Clinical extraction must carry its owner signal.");
        events.push("extraction:start");
        extractionStarted.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        events.push("extraction:joined");
        throw signal.reason;
      },
    }));
  const durableEffect = vi.fn(async () => { events.push("durable-effect"); });
  let snapshotCount = 0;
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    const mailboxPort = createMailboxPort({ events, items: [] });
    const fetch = mailboxPort.fetch.bind(mailboxPort);
    mailboxPort.fetch = async (request) => {
      // Let a restarted local queue read win the post-checkpoint Web round trip.
      if (snapshotCount > 0) await setImmediate();
      return await fetch(request);
    };
    const result = await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: {
        attemptId: "attempt_synthetic_clinical_checkpoint_effects",
        userId: TEST_USER_ID, leaseGeneration: "7", workspaceVersion: "0",
        runnerIdleTtlMs: 1,
      } }),
      {
        vaultRoot, runtimeWakeSignal,
        async createCheckpointSnapshot() {
          snapshotCount += 1;
          expect(snapshotCount, events.join(",")).toBe(1);
          return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          await extractionStarted.promise;
          return {
            progressed: true, checkpointReason: "assistant_runtime_commit",
            afterCheckpoint: async () => ({
              afterDurableCheckpoint: durableEffect, checkpointReason: "assistant_runtime_commit",
            }),
            nextWakeAt: successorAt, nextWakeReason: "system-mailbox",
          };
        },
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            events, checkpointRequests, workspace: createWorkspaceState({ version: "0" }),
            checkpointWorkspace(request) {
              runtimeWakeSignal.notify();
              return createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
              });
            },
          }),
        }),
      },
    ), 15_000, () => events.join(","));
    expect(durableEffect).toHaveBeenCalledOnce();
    expect(readNextClinicalEnrichment).toHaveBeenCalledOnce();
    expect(events.indexOf("extraction:joined")).toBeLessThan(events.indexOf("durable-effect"));
    expect(checkpointRequests).toHaveLength(1);
    expect(result).toMatchObject({ status: "scheduled", nextWakeAt: successorAt });
  } finally {
    runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});
