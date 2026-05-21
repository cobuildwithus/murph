import { describe, expect, it } from "vitest";

import type {
  HostedRuntimeDemand,
  HostedRuntimeDemandRequest,
  HostedRuntimeDemandWorkspaceProjection,
  HostedRuntimeEnsureExecutionResponse,
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimeSignal,
  HostedUserRuntimeWorkflowInput,
} from "../src/index.js";
import {
  createHostedUserRuntimeWorkflowMachine,
  createWorkspaceWakeKey,
  HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS,
  HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
  HOSTED_USER_RUNTIME_DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
  type HostedUserRuntimeWorkflowMachine,
  type HostedUserRuntimeWorkflowRuntime,
} from "../src/workflows/hosted-user-runtime.js";

const BASE_TIME_MS = Date.parse("2026-05-20T12:00:00.000Z");

describe("hostedUserRuntimeWorkflow loop", () => {
  it("runs Cloudflare execution after a mailbox signal when demand reports mailbox backlog", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({
      mailboxLag: [mailboxLag()],
      source: "mailbox_backlog",
    }));
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        reason: "nudge",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.mailboxSignalCount).toBe(0);
    expect(continued.state?.latestMailboxPointer).toBeNull();
    expect(continued.state?.lastDemandSource).toBe("mailbox_backlog");
  });

  it("waits for a future idle nextWakeAt with a signal-or-timer condition", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([60_000]);
  });

  it("lets a signal interrupt idle wait and drive a new demand read", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    runtime.onWait = () => {
      machine.applySignal(manualSignal());
    };

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([60_000]);
    expect(runtime.demandRequests[1]).toMatchObject({
      manualRunRequested: true,
    });
    expect(runtime.executionRequests).toHaveLength(1);
  });

  it("uses runtime_wake_sent recommendedRecheckAt before re-reading demand", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeWakeSent(isoAfter(45_000)));
    runtime.demands.push(idleDemand(isoAfter(120_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.waits[0]).toBe(45_000);
    expect(runtime.demandRequests).toHaveLength(2);
    expect(runtime.demandRequests[1].manualRunRequested).toBe(false);
  });

  it("clears due runtime-result wake state after processing is accepted", async () => {
    const runtime = new FakeWorkflowRuntime();
    const runtimeResultWakeAt = isoAfter(-1);
    runtime.demands.push((request) => {
      expect(request.runtimeResultWakeAt).toBe(runtimeResultWakeAt);
      return runDemand({ source: "runtime_result_wake" });
    });
    runtime.executions.push(runtimeWakeSent(isoAfter(45_000)));
    runtime.demands.push((request) => {
      expect(request.runtimeResultWakeAt).toBeNull();
      return idleDemand(null);
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      state: {
        ...emptyCarryForwardState(),
        runtimeResultWakeAt,
        runtimeResultWakeReason: "assistant",
      },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([45_000, null]);
    expect(runtime.executionRequests).toHaveLength(1);
    expect(continued.state).toMatchObject({
      lastDemandKind: "idle",
      runtimeResultWakeAt: null,
      runtimeResultWakeReason: null,
    });
  });

  it("lets a signal interrupt runtime_wake_sent recheck wait", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeWakeSent(isoAfter(45_000)));
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal("manual-before-wake"));
    runtime.onWait = () => {
      machine.applySignal(manualSignal("manual-during-wake"));
    };

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([45_000]);
    expect(runtime.demandRequests[1].manualRunRequested).toBe(true);
    expect(runtime.executionRequests).toHaveLength(2);
  });

  it("re-reads demand immediately when a signal arrives before runtime_wake_sent returns", async () => {
    const runtime = new FakeWorkflowRuntime();
    let machine: HostedUserRuntimeWorkflowMachine | null = null;
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(() => {
      machine?.applySignal(browserVaultSignal());
      return runtimeWakeSent(isoAfter(45_000));
    });
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal("manual-before-wake"));

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([]);
    expect(runtime.demandRequests[1]).toMatchObject({
      browserVaultRefreshRequested: true,
      manualRunRequested: true,
    });
    expect(runtime.executionRequests).toHaveLength(2);
  });

  it("falls back to the configured active-wake delay when no recommended recheck is returned", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeWakeSent(null));

    const machine = createMachine(runtime, {
      options: {
        activeWakeRecheckDelayMs: 7_000,
        continueAsNewAfterIterations: 1,
      },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS).toBeGreaterThan(1_000);
    expect(runtime.waits).toEqual([7_000]);
  });

  it("passes carried runtime result wake time and reason into demand reads", async () => {
    const runtime = new FakeWorkflowRuntime();
    const runtimeResultNextWakeAt = isoAfter(300_000);
    runtime.demands.push((request) => {
      expect(request.runtimeResultWakeAt).toBe(runtimeResultNextWakeAt);
      expect(request.runtimeResultWakeReason).toBe("assistant");
      return idleDemand(isoAfter(600_000));
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        runtimeResultWakeAt: runtimeResultNextWakeAt,
        runtimeResultWakeReason: "assistant",
      },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);
  });

  it("records accepted runtime processing status", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({
      mailboxLag: [mailboxLag()],
      source: "mailbox_backlog",
    }));
    runtime.executions.push(runtimeWakeSent(isoAfter(11_000)));
    runtime.demands.push(idleDemand(null));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([11_000, null]);
    expect(continued.state).toMatchObject({
      lastExecutionKind: "runtime_processing_accepted",
      lastRuntimeAttemptId: "runtime_attempt_test",
      lastRuntimeStatus: "scheduled",
    });
  });

  it("lets a signal interrupt accepted processing recheck wait", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({
      mailboxLag: [mailboxLag()],
      source: "mailbox_backlog",
    }));
    runtime.executions.push(runtimeWakeSent(isoAfter(30_000)));
    runtime.demands.push((request) => {
      expect(request.manualRunRequested).toBe(true);
      return runDemand({ source: "manual" });
    });
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());
    runtime.onWait = () => {
      runtime.onWait = null;
      machine.applySignal(manualSignal("manual-during-processing-recheck"));
    };

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([30_000]);
    expect(runtime.now).toBe(BASE_TIME_MS);
    expect(runtime.executionRequests).toHaveLength(2);
    expect(runtime.executionRequests[1]?.reason).toBe("manual");
  });

  it("does not pass usage decisions into execution", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        reason: "manual",
        userId: "member_test",
      },
    ]);
    expect(runtime.executionRequests[0]).not.toHaveProperty(
      "aiUsageAllowDecision",
    );
    expect(runtime.executionRequests[0]).not.toHaveProperty(
      "requiresAiUsageDecision",
    );
  });

  it("passes runtimeResultWakeAt through so demand can prefer runtime_result_wake over workspace wake", async () => {
    const runtime = new FakeWorkflowRuntime();
    const runtimeResultWakeAt = isoAfter(-1);
    const workspace = workspaceProjection({
      nextWakeAt: isoAfter(-1),
      version: "workspace-version-1",
    });
    runtime.demands.push((request) => {
      expect(request.runtimeResultWakeAt).toBe(runtimeResultWakeAt);
      expect(request.runtimeResultWakeReason).toBe("assistant");
      return runDemand({
        source: "runtime_result_wake",
        workspace,
      });
    });
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        runtimeResultWakeAt,
        runtimeResultWakeReason: "assistant",
      },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toHaveLength(1);
    expect(runtime.continuedInput?.state?.lastDemandSource).toBe(
      "runtime_result_wake",
    );
  });

  it("carries ignoredWorkspaceWakeKey after a completed workspace wake", async () => {
    const runtime = new FakeWorkflowRuntime();
    const workspace = workspaceProjection({
      nextWakeAt: isoAfter(-1),
      nextWakeReason: "assistant",
      version: "workspace-version-1",
    });
    runtime.demands.push(runDemand({
      source: "workspace_wake",
      workspace,
    }));
    runtime.executions.push(runtimeCompleted());
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[1].ignoredWorkspaceWakeKey).toBe(
      createWorkspaceWakeKey(workspace),
    );
  });

  it("does not clear a signal that arrives while demand is awaited", async () => {
    const runtime = new FakeWorkflowRuntime();
    let machine: HostedUserRuntimeWorkflowMachine | null = null;
    runtime.demands.push(() => {
      machine?.applySignal(manualSignal("manual-during-demand"));
      return idleDemand(isoAfter(60_000));
    });
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[1].manualRunRequested).toBe(true);
    expect(runtime.executionRequests).toHaveLength(1);
  });

  it("does not clear signals that arrive while execution is awaited", async () => {
    const runtime = new FakeWorkflowRuntime();
    let machine: HostedUserRuntimeWorkflowMachine | null = null;
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(() => {
      machine?.applySignal(browserVaultSignal());
      return runtimeCompleted();
    });
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[1]).toMatchObject({
      browserVaultRefreshRequested: true,
      manualRunRequested: true,
    });
  });

  it("does not reapply ignored workspace wake key after a signal arrives during execution", async () => {
    const runtime = new FakeWorkflowRuntime();
    let machine: HostedUserRuntimeWorkflowMachine | null = null;
    const workspace = workspaceProjection({
      nextWakeAt: isoAfter(-1),
      nextWakeReason: "assistant_due",
      version: "workspace-version-1",
    });
    runtime.demands.push(runDemand({
      source: "workspace_wake",
      workspace,
    }));
    runtime.executions.push(() => {
      machine?.applySignal(manualSignal("manual-during-workspace-wake"));
      return runtimeCompleted();
    });
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted());

    machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[1]).toMatchObject({
      ignoredWorkspaceWakeKey: null,
      manualRunRequested: true,
    });
    expect(runtime.executionRequests).toHaveLength(2);
  });

  it("clears mailbox and explicit wake flags once demand is idle", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        browserVaultRefreshRequested: true,
        deviceSyncRecoveryRequested: true,
        lagRecoveryObserved: true,
        latestMailboxPointer: {
          lane: "conversation",
          laneSeq: "7",
          mailboxItemId: "mailbox_item_test",
          source: "test",
        },
        mailboxSignalCount: 3,
        manualRunRequested: true,
      },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(continued.state).toMatchObject({
      browserVaultRefreshRequested: false,
      deviceSyncRecoveryRequested: false,
      lagRecoveryObserved: false,
      latestMailboxPointer: null,
      mailboxSignalCount: 0,
      manualRunRequested: false,
    });
  });

  it("records device-sync and lag recovery signals as coalesced flags", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        ignoredWorkspaceWakeKey: "workspace-version:2026-05-20T12:00:00.000Z:assistant",
      },
      userId: "member_test",
    });
    machine.applySignal({
      kind: "device_sync_recovery_requested",
    });
    machine.applySignal({
      kind: "mailbox_lag_observed",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[0]).toMatchObject({
      deviceSyncRecoveryRequested: true,
      ignoredWorkspaceWakeKey: null,
      lagRecoveryObserved: true,
    });
  });

  it("records malformed raw signals as no-op diagnostics", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    expect(() => machine.applySignal({
      kind: "manual_run_requested",
      source: "unexpected-source",
    })).not.toThrow();

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[0]).toMatchObject({
      browserVaultRefreshRequested: false,
      deviceSyncRecoveryRequested: false,
      lagRecoveryObserved: false,
      manualRunRequested: false,
    });
    expect(continued.state).toMatchObject({
      invalidSignalCount: 1,
      lastInvalidSignalErrorCode: "TypeError",
      signalVersion: 0,
    });
  });

  it("waits until blocked demand retryAt or a newer signal", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push({
      kind: "blocked",
      mailboxLag: [],
      reason: "ai_usage_gate_unavailable",
      retryAt: isoAfter(30_000),
      workspace: null,
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([30_000]);
  });

  it("lets a signal interrupt blocked demand retry wait", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push({
      kind: "blocked",
      mailboxLag: [],
      reason: "ai_usage_gate_unavailable",
      retryAt: isoAfter(30_000),
      workspace: null,
    });
    runtime.demands.push((request) => {
      expect(request.manualRunRequested).toBe(true);
      return runDemand({ source: "manual" });
    });
    runtime.executions.push(runtimeCompleted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    runtime.onWait = () => {
      runtime.onWait = null;
      machine.applySignal(manualSignal("manual-during-blocked-retry"));
    };

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([30_000]);
    expect(runtime.now).toBe(BASE_TIME_MS);
    expect(runtime.executionRequests).toHaveLength(1);
    expect(runtime.executionRequests[0]?.reason).toBe("manual");
  });

  it("records execution errors and keeps the workflow alive for retry", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(() => {
      const error = new Error("transport failed") as Error & { code: string };
      error.code = "retryable_transport";
      throw error;
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    const continued = await runUntilContinueAsNew(machine);
    expect(machine.readStatus()).toMatchObject({
      lastExecutionErrorCode: "retryable_transport",
      lastExecutionKind: "failed",
    });
    expect(runtime.waits).toEqual([30_000]);
    expect(continued.state).toMatchObject({
      lastExecutionErrorCode: "retryable_transport",
      lastExecutionKind: "failed",
    });
  });

  it("waits for a signal only after non-retryable execution failures", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(() => {
      throw nonRetryableActivityFailure("hosted_orchestrator_http_non_retryable");
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([null]);
    expect(continued.state).toMatchObject({
      lastExecutionErrorCode: "hosted_orchestrator_http_non_retryable",
      lastExecutionKind: "failed",
    });
  });

  it("keeps old retry timer behavior when the non-retryable wait patch is inactive", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.signalOnlyNonRetryableFailureWaitEnabled = false;
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(() => {
      throw nonRetryableActivityFailure("hosted_orchestrator_http_non_retryable");
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([
      HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
    ]);
  });

  it("records demand read errors and keeps the workflow alive for retry", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(() => {
      const error = new Error("web unavailable") as Error & { code: string };
      error.code = "demand_transport_unavailable";
      throw error;
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toHaveLength(0);
    expect(runtime.waits).toEqual([30_000]);
    expect(continued.state).toMatchObject({
      lastDemandKind: null,
      lastDemandNextWakeAt: null,
      lastDemandSource: "demand_read_failed",
      lastExecutionErrorCode: "demand_transport_unavailable",
    });
  });

  it("waits for a signal only after non-retryable demand read failures", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(() => {
      throw nonRetryableActivityFailure(
        "hosted_orchestrator_invalid_protocol_response",
      );
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toHaveLength(0);
    expect(runtime.waits).toEqual([null]);
    expect(continued.state).toMatchObject({
      lastDemandKind: null,
      lastDemandNextWakeAt: null,
      lastDemandSource: "demand_read_failed",
      lastExecutionErrorCode: "hosted_orchestrator_invalid_protocol_response",
    });
  });

  it("does not sleep when runtime_wake_sent recheck is already due or malformed", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeWakeSent("not-an-iso-timestamp"));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([]);
  });

  it("continues as new with compact carry-forward state after the configured threshold", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(idleDemand(isoAfter(60_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        mailboxSignalCount: 3,
        runtimeResultWakeAt: isoAfter(300_000),
        runtimeResultWakeReason: "assistant",
      },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(continued).toEqual({
      options: normalizedContinuedOptions({ continueAsNewAfterIterations: 1 }),
      state: expect.objectContaining({
        lastDemandKind: "idle",
        mailboxSignalCount: 0,
        runtimeResultWakeAt: isoAfter(300_000),
        runtimeResultWakeReason: "assistant",
        signalVersion: 0,
      }),
      userId: "member_test",
    });
    expect(continued.state).not.toHaveProperty("lastDemand");
    expect(continued.state).not.toHaveProperty("redactedStatus");
    expect(continued.state).not.toHaveProperty("aiUsageAllowDecision");
  });

  it("continues as new when Temporal suggests it before the iteration threshold", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.suggestContinueAsNew = true;

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 100 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests).toHaveLength(0);
    expect(runtime.executionRequests).toHaveLength(0);
    expect(continued).toEqual({
      options: normalizedContinuedOptions({ continueAsNewAfterIterations: 100 }),
      state: expect.objectContaining({
        mailboxSignalCount: 1,
        latestMailboxPointer: expect.objectContaining({
          mailboxItemId: "mailbox_item_test",
        }),
        signalVersion: 1,
      }),
      userId: "member_test",
    });
  });

  it("upgrades the legacy ensure-execution timeout when continuing as new", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.suggestContinueAsNew = true;

    const machine = createMachine(runtime, {
      options: {
        continueAsNewAfterIterations: 100,
        ensureCloudflareExecutionStartToCloseTimeoutMs: 630_000,
      },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(continued.options).toMatchObject({
      continueAsNewAfterIterations: 100,
      ensureRuntimeProcessingStartToCloseTimeoutMs:
        HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS,
    });
  });
});

function normalizedContinuedOptions(
  overrides: Partial<NonNullable<HostedUserRuntimeWorkflowInput["options"]>>,
): NonNullable<HostedUserRuntimeWorkflowInput["options"]> {
  return {
    activeWakeRecheckDelayMs: HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS,
    continueAsNewAfterIterations: 500,
    ensureRuntimeProcessingStartToCloseTimeoutMs:
      HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS,
    readRuntimeDemandStartToCloseTimeoutMs: 10_000,
    runtimeCompletedFailureRecheckDelayMs:
      HOSTED_USER_RUNTIME_DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
    ...overrides,
  };
}

class ContinueAsNewSignal extends Error {
  constructor(readonly input: HostedUserRuntimeWorkflowInput) {
    super("continue-as-new");
  }
}

type DemandHandler = (
  request: HostedRuntimeDemandRequest,
) => HostedRuntimeDemand | Promise<HostedRuntimeDemand>;
type ExecutionInput = Parameters<
  HostedUserRuntimeWorkflowRuntime["ensureRuntimeProcessing"]
>[0];
type ExecutionHandler = (
  request: ExecutionInput,
) => HostedRuntimeEnsureProcessingResponse | Promise<HostedRuntimeEnsureProcessingResponse>;
type RunDemand = Extract<HostedRuntimeDemand, { kind: "run" }>;

class FakeWorkflowRuntime implements HostedUserRuntimeWorkflowRuntime {
  continuedInput: HostedUserRuntimeWorkflowInput | null = null;
  readonly demandRequests: HostedRuntimeDemandRequest[] = [];
  readonly demands: Array<DemandHandler | HostedRuntimeDemand> = [];
  readonly executionRequests: ExecutionInput[] = [];
  readonly executions: Array<ExecutionHandler | HostedRuntimeEnsureProcessingResponse> = [];
  now = BASE_TIME_MS;
  onWait: (() => void) | null = null;
  signalOnlyNonRetryableFailureWaitEnabled = true;
  suggestContinueAsNew = false;
  readonly waits: Array<number | null> = [];
  private uuidCounter = 0;

  async continueAsNew(input: HostedUserRuntimeWorkflowInput): Promise<never> {
    this.continuedInput = input;
    throw new ContinueAsNewSignal(input);
  }

  continueAsNewSuggested(): boolean {
    return this.suggestContinueAsNew;
  }

  async ensureCloudflareExecution(): Promise<HostedRuntimeEnsureExecutionResponse> {
    throw new Error("Unexpected ensureCloudflareExecution call.");
  }

  async ensureRuntimeProcessing(
    request: ExecutionInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    this.executionRequests.push(request);
    const next = this.executions.shift();
    if (!next) {
      throw new Error("Unexpected ensureRuntimeProcessing call.");
    }
    return typeof next === "function" ? next(request) : next;
  }

  useEnsureRuntimeProcessing(): boolean {
    return true;
  }

  nowMs(): number {
    return this.now;
  }

  async readRuntimeDemand(
    request: HostedRuntimeDemandRequest,
  ): Promise<HostedRuntimeDemand> {
    this.demandRequests.push(request);
    const next = this.demands.shift();
    if (!next) {
      throw new Error("Unexpected readRuntimeDemand call.");
    }
    return typeof next === "function" ? next(request) : next;
  }

  useSignalOnlyWaitForNonRetryableFailure(): boolean {
    return this.signalOnlyNonRetryableFailureWaitEnabled;
  }

  uuid(): string {
    this.uuidCounter += 1;
    return `orchestration-attempt-${this.uuidCounter}`;
  }

  async waitForSignalOrTimeout(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): Promise<void> {
    this.waits.push(timeoutMs);
    this.onWait?.();
    if (!predicate() && timeoutMs !== null) {
      this.now += timeoutMs;
    }
  }
}

function createMachine(
  runtime: FakeWorkflowRuntime,
  input: HostedUserRuntimeWorkflowInput,
): HostedUserRuntimeWorkflowMachine {
  return createHostedUserRuntimeWorkflowMachine(input, runtime);
}

async function runUntilContinueAsNew(
  machine: HostedUserRuntimeWorkflowMachine,
): Promise<HostedUserRuntimeWorkflowInput> {
  try {
    await machine.run();
  } catch (error) {
    if (error instanceof ContinueAsNewSignal) {
      return error.input;
    }
    throw error;
  }

  throw new Error("Expected workflow to continue as new.");
}

function emptyCarryForwardState(): NonNullable<HostedUserRuntimeWorkflowInput["state"]> {
  return {
    browserVaultRefreshRequested: false,
    currentWaitReason: null,
    currentWaitUntil: null,
    deviceSyncRecoveryRequested: false,
    ignoredWorkspaceWakeKey: null,
    invalidSignalCount: 0,
    lagRecoveryObserved: false,
    lastOrchestrationAttemptId: null,
    lastInvalidSignalErrorCode: null,
    lastDemandKind: null,
    lastDemandNextWakeAt: null,
    lastDemandSource: null,
    lastExecutionAt: null,
    lastExecutionErrorCode: null,
    lastExecutionKind: null,
    lastMailboxLagLaneCount: 0,
    lastRuntimeAttemptId: null,
    lastRuntimeStatus: null,
    latestMailboxPointer: null,
    mailboxSignalCount: 0,
    manualRunRequested: false,
    runtimeFailedWithoutNextWakeCount: 0,
    runtimeResultWakeAt: null,
    runtimeResultWakeReason: null,
    sameRuntimeWakeSentCount: 0,
    signalVersion: 0,
  };
}

function mailboxSignal(): HostedRuntimeSignal {
  return {
    kind: "mailbox_appended",
    lane: "conversation",
    laneSeq: "7",
    mailboxItemId: "mailbox_item_test",
    source: "test",
  };
}

function manualSignal(_label = "manual_signal_test"): HostedRuntimeSignal {
  return {
    kind: "manual_run_requested",
  };
}

function browserVaultSignal(): HostedRuntimeSignal {
  return {
    kind: "browser_vault_refresh_requested",
  };
}

function mailboxLag() {
  return {
    importedSeq: "0",
    lag: "1",
    lane: "conversation" as const,
    maxSeq: "1",
    maxUpdatedAt: isoAfter(-30_000),
  };
}

function runDemand(input: {
  mailboxLag?: RunDemand["mailboxLag"];
  source: RunDemand["source"];
  workspace?: HostedRuntimeDemandWorkspaceProjection | null;
}): HostedRuntimeDemand {
  return {
    kind: "run",
    mailboxLag: input.mailboxLag ?? [],
    reason: input.source === "browser_vault_refresh"
      ? "browser_vault_refresh"
      : input.source === "manual"
        ? "manual"
        : "nudge",
    source: input.source,
    workspace: input.workspace ?? null,
  };
}

function idleDemand(nextWakeAt: string | null): HostedRuntimeDemand {
  return {
    kind: "idle",
    mailboxLag: [],
    nextWakeAt,
    workspace: null,
  };
}

function runtimeCompleted(
  input: Partial<HostedRuntimeEnsureProcessingResponse> = {},
): HostedRuntimeEnsureProcessingResponse {
  return {
    action: input.action ?? "started",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: input.recommendedRecheckAt ?? isoAfter(0),
    runtimeAttemptId: input.runtimeAttemptId ?? "runtime_attempt_test",
  };
}

function runtimeWakeSent(
  recommendedRecheckAt: string | null,
): HostedRuntimeEnsureProcessingResponse {
  return {
    action: "woken",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt,
    runtimeAttemptId: "runtime_attempt_test",
  };
}

function nonRetryableActivityFailure(type: string): Error {
  const applicationFailure = new Error("permanent hosted control failure") as
    Error & {
      nonRetryable: boolean;
      type: string;
    };
  applicationFailure.nonRetryable = true;
  applicationFailure.type = type;
  return new Error("activity failed", {
    cause: applicationFailure,
  });
}

function workspaceProjection(
  input: Partial<HostedRuntimeDemandWorkspaceProjection>,
): HostedRuntimeDemandWorkspaceProjection {
  return {
    nextWakeAt: input.nextWakeAt ?? null,
    nextWakeReason: input.nextWakeReason ?? null,
    version: input.version ?? null,
  };
}

function isoAfter(deltaMs: number): string {
  return new Date(BASE_TIME_MS + deltaMs).toISOString();
}
