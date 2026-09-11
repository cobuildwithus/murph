import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { classifyHostedSystemMailboxExecutionClass } from "@murphai/hosted-execution/orchestration-control";
import {
  admitHostedClinicalEnrichmentWake,
  makeHostedClinicalEnrichmentWakeDue,
  setHostedClinicalEnrichmentWakeNextAttempt,
} from "../src/hosted-runtime/clinical-enrichment-wake.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxNextWakeCandidate,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
  type HostedSystemMailboxRuntime,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/hosted-runtime/events.ts", () => ({ executeHostedMailboxEvent: mocks.execute }));
const now = "2026-09-11T12:00:00.000Z";
const later = "2026-09-11T12:01:00.000Z";
const jobId = "a".repeat(64);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

async function admit() {
  const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-wake-");
  cleanup.push(workspace.cleanup);
  const admission = { vaultRoot: workspace.vaultRoot, userId: "member_synthetic", jobId, occurredAt: now };
  await admitHostedClinicalEnrichmentWake(admission);
  return { ...workspace, admission };
}

function runtime(): HostedSystemMailboxRuntime {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: { async get() { return null; }, async put() {} },
      effectsPort: { async readRawEmailMessage() { return null; }, async sendEmail() {} },
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

describe("clinical enrichment durable wake", () => {
  it("restores one exact job pointer with a cold-resume wake and default-owned execution", async () => {
    const { vaultRoot, admission } = await admit();
    await expect(admitHostedClinicalEnrichmentWake(admission)).resolves.toEqual({ admitted: false, nextWakeAt: now });
    const state = await readHostedSystemMailboxState(vaultRoot);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({
      mailboxLaneSeq: null,
      routeAction: "apply-clinical-enrichment",
      wake: { kind: "clinical-records.enrichment-requested", jobId, userId: "member_synthetic" },
    });
    expect(await resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot, now: () => now })).toMatchObject({ at: now });
    expect(classifyHostedSystemMailboxExecutionClass({
      kind: state.pending[0]!.wake.kind,
      dedupeKey: state.pending[0]!.mailboxDedupeKey,
    })).toBe("default_owned");
  });

  it("rejects extra wake content and invalid job ids before admission", async () => {
    const { vaultRoot, admission } = await admit();
    const wake = (await readHostedSystemMailboxState(vaultRoot)).pending[0]!.wake;
    expect(() => parseHostedExecutionWake({ ...wake, documentText: "untrusted evidence" })).toThrow();
    expect(() => parseHostedExecutionWake({ ...wake, jobId: "../invalid" })).toThrow();
    await expect(admitHostedClinicalEnrichmentWake({ ...admission, userId: "member_other" })).rejects.toThrow("conflicts");
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toHaveLength(1);
  });

  it("preserves deferred time on replay and advances only the exact ready job", async () => {
    const { vaultRoot, admission } = await admit();
    await setHostedClinicalEnrichmentWakeNextAttempt({ vaultRoot, jobId, nextAttemptAt: later });
    await expect(admitHostedClinicalEnrichmentWake(admission)).resolves.toEqual({ admitted: false, nextWakeAt: later });
    expect(await resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot, now: () => now })).toMatchObject({ at: later });
    expect(await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId: "b".repeat(64), now: new Date(now) })).toBe(false);
    expect(await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId, now: new Date(now) })).toBe(true);
    expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]!.nextAttemptAt).toBe(now);
  });

  it.each(["sending", "recording"] as const)("does not replace an existing %s claim on admission or readiness", async (status) => {
    const { vaultRoot, admission } = await admit();
    await updateHostedSystemMailboxState(vaultRoot, state => ({
      pending: state.pending.map(item => ({ ...item, status, attemptCount: 3, nextAttemptAt: later })),
    }));
    await admitHostedClinicalEnrichmentWake(admission);
    expect(await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId, now: new Date(now) })).toBe(false);
    expect(await setHostedClinicalEnrichmentWakeNextAttempt({ vaultRoot, jobId, nextAttemptAt: now })).toBe(false);
    expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toMatchObject({ status, attemptCount: 3, nextAttemptAt: later });
  });

  it("retains pending extraction until its bounded retry instead of consuming the wake", async () => {
    const { vaultRoot } = await admit();
    mocks.execute.mockResolvedValue({
      backgroundMaintenanceYielded: true,
      bootstrapResult: null,
      conversationMetrics: null,
      deliveryIntentIds: [],
      mailboxLane: "clinical-records",
      nextWakeAt: later,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    const result = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: ["apply-clinical-enrichment"],
      now: () => now,
      runtime: runtime(),
      runtimeEnv: {},
      retainProcessedItemUntilRecorded: true,
      vaultRoot,
    });
    expect(result).toMatchObject({ status: "preempted", item: { status: "pending", nextAttemptAt: later } });
    expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toMatchObject({
      status: "pending", nextAttemptAt: later, postCheckpointRecord: null, lastErrorCode: null,
    });
    expect(await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: ["apply-clinical-enrichment"], now: () => now,
      runtime: runtime(), runtimeEnv: {}, vaultRoot,
    })).toBeNull();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("yields before apply execution when foreground work is ready", async () => {
    const { vaultRoot } = await admit();
    const result = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: ["apply-clinical-enrichment"], now: () => now,
      runtime: runtime(), runtimeEnv: {}, vaultRoot,
      shouldYieldBackgroundMaintenance: () => true,
    });
    expect(result).toMatchObject({ status: "preempted", item: { status: "pending", nextAttemptAt: null } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

