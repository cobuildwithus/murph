import { describe, expect, it } from "vitest";

import type {
  HostedRuntimeDemand,
  HostedRuntimeDemandRequest,
  HostedRuntimeDemandWorkspaceProjection,
  HostedRuntimeEnsureExecutionResponse,
  HostedRuntimeSignal,
  HostedUserRuntimeWorkflowInput,
} from "../src/index.js";
import {
  createHostedUserRuntimeWorkflowMachine,
  createWorkspaceWakeKey,
  HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS,
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

  it("preserves runtime result wake time and reason on the next demand read", async () => {
    const runtime = new FakeWorkflowRuntime();
    const runtimeResultNextWakeAt = isoAfter(300_000);
    runtime.demands.push(runDemand({ source: "manual" }));
    runtime.executions.push(runtimeCompleted({
      runtimeResultNextWakeAt,
      runtimeResultNextWakeReason: "assistant",
    }));
    runtime.demands.push(idleDemand(isoAfter(600_000)));

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    machine.applySignal(manualSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[1].runtimeResultWakeAt).toBe(
      runtimeResultNextWakeAt,
    );
    expect(runtime.demandRequests[1].runtimeResultWakeReason).toBe("assistant");
  });

  it("does not pass usage decisions into execution", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.demands.push(runDemand({
      requiresAiUsageDecision: true,
      source: "manual",
    }));
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
      connectionId: "connection_test",
      eventId: "device_event_test",
      kind: "device_sync_recovery_requested",
      reason: "dirty",
    });
    machine.applySignal({
      eventId: "lag_event_test",
      kind: "mailbox_lag_observed",
      source: "test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.demandRequests[0]).toMatchObject({
      deviceSyncRecoveryRequested: true,
      ignoredWorkspaceWakeKey: null,
      lagRecoveryObserved: true,
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
      options: { continueAsNewAfterIterations: 1 },
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
});

class ContinueAsNewSignal extends Error {
  constructor(readonly input: HostedUserRuntimeWorkflowInput) {
    super("continue-as-new");
  }
}

type DemandHandler = (
  request: HostedRuntimeDemandRequest,
) => HostedRuntimeDemand | Promise<HostedRuntimeDemand>;
type ExecutionInput = Parameters<
  HostedUserRuntimeWorkflowRuntime["ensureCloudflareExecution"]
>[0];
type ExecutionHandler = (
  request: ExecutionInput,
) => HostedRuntimeEnsureExecutionResponse | Promise<HostedRuntimeEnsureExecutionResponse>;
type RunDemand = Extract<HostedRuntimeDemand, { kind: "run" }>;

class FakeWorkflowRuntime implements HostedUserRuntimeWorkflowRuntime {
  continuedInput: HostedUserRuntimeWorkflowInput | null = null;
  readonly demandRequests: HostedRuntimeDemandRequest[] = [];
  readonly demands: Array<DemandHandler | HostedRuntimeDemand> = [];
  readonly executionRequests: ExecutionInput[] = [];
  readonly executions: Array<ExecutionHandler | HostedRuntimeEnsureExecutionResponse> = [];
  now = BASE_TIME_MS;
  onWait: (() => void) | null = null;
  readonly waits: Array<number | null> = [];
  private uuidCounter = 0;

  async continueAsNew(input: HostedUserRuntimeWorkflowInput): Promise<never> {
    this.continuedInput = input;
    throw new ContinueAsNewSignal(input);
  }

  async ensureCloudflareExecution(
    request: ExecutionInput,
  ): Promise<HostedRuntimeEnsureExecutionResponse> {
    this.executionRequests.push(request);
    const next = this.executions.shift();
    if (!next) {
      throw new Error("Unexpected ensureCloudflareExecution call.");
    }
    return typeof next === "function" ? next(request) : next;
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
    deviceSyncRecoveryRequested: false,
    ignoredWorkspaceWakeKey: null,
    lagRecoveryObserved: false,
    lastDemandKind: null,
    lastDemandNextWakeAt: null,
    lastDemandSource: null,
    lastExecutionAt: null,
    lastExecutionErrorCode: null,
    lastExecutionKind: null,
    lastMailboxLagLaneCount: 0,
    latestMailboxPointer: null,
    mailboxSignalCount: 0,
    manualRunRequested: false,
    runtimeResultWakeAt: null,
    runtimeResultWakeReason: null,
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

function manualSignal(eventId = "manual_event_test"): HostedRuntimeSignal {
  return {
    eventId,
    kind: "manual_run_requested",
    source: "test",
  };
}

function browserVaultSignal(): HostedRuntimeSignal {
  return {
    eventId: "browser_vault_event_test",
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
  requiresAiUsageDecision?: boolean;
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
    requiresAiUsageDecision: input.requiresAiUsageDecision ?? false,
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
  input: Partial<Extract<HostedRuntimeEnsureExecutionResponse, { kind: "runtime_completed" }>> = {},
): HostedRuntimeEnsureExecutionResponse {
  return {
    action: input.action ?? "started",
    kind: "runtime_completed",
    runtimeAttemptId: input.runtimeAttemptId ?? "runtime_attempt_test",
    runtimeResultNextWakeAt: input.runtimeResultNextWakeAt ?? null,
    runtimeResultNextWakeReason: input.runtimeResultNextWakeReason ?? null,
    runtimeStatus: input.runtimeStatus ?? "idle",
  };
}

function runtimeWakeSent(
  recommendedRecheckAt: string | null,
): HostedRuntimeEnsureExecutionResponse {
  return {
    kind: "runtime_wake_sent",
    recommendedRecheckAt,
    runtimeAttemptId: "runtime_attempt_test",
  };
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
