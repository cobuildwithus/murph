import { describe, expect, it } from "vitest";

import type {
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimeReconciliationFacts,
  HostedRuntimeReconciliationFactsWorkspace,
  HostedRuntimeSignal,
  HostedUserRuntimeWorkflowInput,
} from "../src/index.js";
import {
  createHostedUserRuntimeWorkflowMachine,
  HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
  type HostedUserRuntimeWorkflowMachine,
  type HostedUserRuntimeWorkflowRuntime,
} from "../src/workflows/hosted-user-runtime.js";

const BASE_TIME_MS = Date.parse("2026-05-20T12:00:00.000Z");

describe("hostedUserRuntimeWorkflow loop", () => {
  it("reads reconciliation facts before executing a fresh mailbox signal", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "conversation" })],
    }));
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.reconciliationRequests).toEqual([{ userId: "member_test" }]);
    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.mailboxSignalCount).toBe(0);
    expect(continued.state?.latestMailboxPointer).toBeNull();
    expect(continued.state?.lastReconciliationStatus).toBe("work_pending");
    expect(continued.state?.lastMailboxLagLaneCount).toBe(1);
  });

  it("reads reconciliation facts before executing fresh system mailbox signals", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "system" })],
    }));
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal({
      lane: "system",
      mailboxItemId: "mailbox_system_test",
    }));

    await runUntilContinueAsNew(machine);

    expect(runtime.reconciliationRequests).toEqual([{ userId: "member_test" }]);
    expect(runtime.executionRequests).toHaveLength(1);
  });

  it("keeps legacy direct mailbox execution for histories without the reconciliation-first patch", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.reconciliationBeforeMailboxProcessing = false;
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.reconciliationRequests).toEqual([]);
    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.mailboxSignalCount).toBe(0);
    expect(continued.state?.latestMailboxPointer).toBeNull();
    expect(continued.state?.lastReconciliationStatus).toBe("work_pending");
    expect(continued.state?.lastMailboxLagLaneCount).toBe(0);
  });

  it("does not sleep on failed runtime execution when a recheck signal arrives", async () => {
    const runtime = new FakeWorkflowRuntime();
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });
    runtime.executions.push(async () => {
      machine.applySignal(runtimeRecheckSignal());
      throw new Error("cloudflare unavailable");
    });
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "conversation" })],
    }));
    runtime.facts.push(reconciliationFacts());
    machine.applySignal(mailboxSignal());

    await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([null]);
    expect(runtime.waits).not.toContain(30_000);
    expect(runtime.reconciliationRequests).toEqual([
      { userId: "member_test" },
      { userId: "member_test" },
    ]);
  });

  it("uses execution retry waits for runtime execution failures marked non-retryable", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "conversation" })],
    }));
    runtime.executions.push(() => {
      throw nonRetryableError("cloudflare unavailable");
    });

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([30_000]);
    expect(continued.state?.lastExecutionErrorCode).toBe("Error");
  });

  it("reads reconciliation facts for carried mailbox pointers", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag()],
    }));
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      state: {
        ...emptyCarryForwardState(),
        latestMailboxPointer: {
          lane: "conversation",
          laneSeq: "7",
          mailboxItemId: "mailbox_item_test",
        },
        mailboxSignalCount: 1,
      },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.reconciliationRequests).toEqual([{ userId: "member_test" }]);
    expect(runtime.executionRequests).toHaveLength(1);
  });

  it("waits until a future workspace wake from reconciliation facts", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      workspace: workspaceProjection({ nextWakeAt: isoAfter(60_000) }),
    }));
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([60_000]);
    expect(continued.state?.lastReconciliationStatus).toBe("idle");
    expect(continued.state?.lastReconciliationNextWakeAt).toBe(isoAfter(60_000));
  });

  it("waits for a future inbox media retention wake before a later assistant wake", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      workspace: workspaceProjection({
        inboxMediaRetentionWakeAt: isoAfter(45_000),
        nextWakeAt: isoAfter(120_000),
        nextWakeReason: "assistant",
      }),
    }));
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([45_000]);
    expect(continued.state?.lastReconciliationStatus).toBe("idle");
    expect(continued.state?.lastReconciliationNextWakeAt).toBe(isoAfter(45_000));
  });

  it("re-reads reconciliation facts after a workspace wake timer before alarming", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      workspace: workspaceProjection({
        nextWakeAt: isoAfter(60_000),
        nextWakeReason: "assistant_due",
      }),
    }));
    runtime.facts.push(reconciliationFacts({
      workspace: workspaceProjection({
        nextWakeAt: isoAfter(-1),
        nextWakeReason: "assistant_due",
      }),
    }));
    runtime.executions.push(processingAccepted());
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 2 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([60_000]);
    expect(runtime.reconciliationRequests).toEqual([
      { userId: "member_test" },
      { userId: "member_test" },
    ]);
    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.lastReconciliationNextWakeAt).toBe(isoAfter(-1));
  });

  it("runs mailbox work before due inbox media retention", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "conversation" })],
      workspace: workspaceProjection({
        inboxMediaRetentionWakeAt: isoAfter(-1),
        nextWakeAt: isoAfter(-1),
        nextWakeReason: "assistant_due",
      }),
    }));
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.latestMailboxPointer).toBeNull();
    expect(continued.state?.mailboxSignalCount).toBe(0);
  });

  it("keeps retention-first replay behavior for histories before the mailbox-priority patch", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.mailboxBeforeInboxMediaRetention = false;
    runtime.facts.push(reconciliationFacts({
      mailboxLag: [mailboxLag({ lane: "conversation" })],
      workspace: workspaceProjection({
        inboxMediaRetentionWakeAt: isoAfter(-1),
        nextWakeAt: isoAfter(-1),
        nextWakeReason: "assistant_due",
      }),
    }));
    runtime.executions.push(processingAccepted());

    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });
    machine.applySignal(mailboxSignal());

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        processingMode: "inbox_media_retention",
        userId: "member_test",
      },
    ]);
    expect(continued.state?.latestMailboxPointer).toEqual({
      lane: "conversation",
      laneSeq: "7",
      mailboxItemId: "mailbox_item_test",
    });
    expect(continued.state?.mailboxSignalCount).toBe(1);
  });

  it("drives an alarm when reconciliation facts show a due workspace wake", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      workspace: workspaceProjection({
        nextWakeAt: isoAfter(-1),
        nextWakeReason: "assistant_due",
      }),
    }));
    runtime.executions.push(processingAccepted());
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([
      {
        orchestrationAttemptId: "orchestration-attempt-1",
        userId: "member_test",
      },
    ]);
  });

  it("blocks without processing when reconciliation facts deny work", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(reconciliationFacts({
      blocked: {
        reason: "ai_usage_gate_unavailable",
        retryAt: isoAfter(30_000),
      },
    }));
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.executionRequests).toEqual([]);
    expect(runtime.waits).toEqual([30_000]);
    expect(continued.state?.lastReconciliationStatus).toBe("blocked");
    expect(continued.state?.lastReconciliationBlockedReason).toBe(
      "ai_usage_gate_unavailable",
    );
  });

  it("records reconciliation read failures and uses retry waits for failures marked non-retryable", async () => {
    const runtime = new FakeWorkflowRuntime();
    runtime.facts.push(async () => {
      throw nonRetryableError("web unavailable");
    });
    const machine = createMachine(runtime, {
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    });

    const continued = await runUntilContinueAsNew(machine);

    expect(runtime.waits).toEqual([30_000]);
    expect(continued.state?.lastReconciliationStatus).toBeNull();
    expect(continued.state?.lastExecutionErrorCode).toBe("Error");
  });

  it("rejects legacy direct runtime signals instead of storing flags", () => {
    const runtime = new FakeWorkflowRuntime();
    const machine = createMachine(runtime, {
      userId: "member_test",
    });

    for (const kind of legacyDirectSignalKinds()) {
      machine.applySignal({ kind });
    }

    const status = machine.readStatus();
    expect(status.invalidSignalCount).toBe(4);
    expect(status.signalVersion).toBe(0);
  });
});

function normalizedContinuedOptions(
  overrides: Partial<NonNullable<HostedUserRuntimeWorkflowInput["options"]>>,
): NonNullable<HostedUserRuntimeWorkflowInput["options"]> {
  return {
    continueAsNewAfterHistoryEvents: 750,
    continueAsNewAfterIterations: 500,
    ensureRuntimeProcessingStartToCloseTimeoutMs:
      HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
    readRuntimeReconciliationFactsStartToCloseTimeoutMs: 10_000,
    ...overrides,
  };
}

class ContinueAsNewSignal extends Error {
  constructor(readonly input: HostedUserRuntimeWorkflowInput) {
    super("continue-as-new");
  }
}

type ReconciliationInput = Parameters<
  HostedUserRuntimeWorkflowRuntime["readRuntimeReconciliationFacts"]
>[0];
type ReconciliationHandler = (
  request: ReconciliationInput,
) => HostedRuntimeReconciliationFacts | Promise<HostedRuntimeReconciliationFacts>;
type ExecutionInput = Parameters<
  HostedUserRuntimeWorkflowRuntime["ensureRuntimeProcessing"]
>[0];
type ExecutionHandler = (
  request: ExecutionInput,
) => HostedRuntimeEnsureProcessingResponse | Promise<HostedRuntimeEnsureProcessingResponse>;
class FakeWorkflowRuntime implements HostedUserRuntimeWorkflowRuntime {
  continuedInput: HostedUserRuntimeWorkflowInput | null = null;
  readonly reconciliationRequests: ReconciliationInput[] = [];
  readonly facts: Array<ReconciliationHandler | HostedRuntimeReconciliationFacts> = [];
  readonly executionRequests: ExecutionInput[] = [];
  readonly executions: Array<ExecutionHandler | HostedRuntimeEnsureProcessingResponse> = [];
  now = BASE_TIME_MS;
  onWait: (() => void) | null = null;
  mailboxBeforeInboxMediaRetention = true;
  reconciliationBeforeMailboxProcessing = true;
  suggestContinueAsNew = false;
  historyLength = 0;
  readonly waits: Array<number | null> = [];
  private uuidCounter = 0;

  async continueAsNew(input: HostedUserRuntimeWorkflowInput): Promise<never> {
    this.continuedInput = input;
    throw new ContinueAsNewSignal(input);
  }

  continueAsNewSuggested(): boolean {
    return this.suggestContinueAsNew;
  }

  currentHistoryLength(): number {
    return this.historyLength;
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

  nowMs(): number {
    return this.now;
  }

  mailboxBeforeInboxMediaRetentionEnabled(): boolean {
    return this.mailboxBeforeInboxMediaRetention;
  }

  reconciliationBeforeMailboxProcessingEnabled(): boolean {
    return this.reconciliationBeforeMailboxProcessing;
  }

  async readRuntimeReconciliationFacts(
    request: ReconciliationInput,
  ): Promise<HostedRuntimeReconciliationFacts> {
    this.reconciliationRequests.push(request);
    const next = this.facts.shift();
    if (!next) {
      throw new Error("Unexpected readRuntimeReconciliationFacts call.");
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
    currentWaitReason: null,
    currentWaitUntil: null,
    invalidSignalCount: 0,
    lastOrchestrationAttemptId: null,
    lastInvalidSignalErrorCode: null,
    lastExecutionAt: null,
    lastExecutionErrorCode: null,
    lastExecutionKind: null,
    lastMailboxLagLaneCount: 0,
    lastReconciliationBlockedReason: null,
    lastReconciliationNextWakeAt: null,
    lastReconciliationStatus: null,
    lastRuntimeAttemptId: null,
    lastRuntimeStatus: null,
    latestMailboxPointer: null,
    mailboxSignalCount: 0,
    signalVersion: 0,
  };
}

function mailboxSignal(
  overrides: Partial<Extract<HostedRuntimeSignal, { kind: "mailbox_appended" }>> = {},
): HostedRuntimeSignal {
  return {
    kind: "mailbox_appended",
    lane: "conversation",
    laneSeq: "7",
    mailboxItemId: "mailbox_item_test",
    ...overrides,
  };
}

function runtimeRecheckSignal(): HostedRuntimeSignal {
  return {
    kind: "runtime_recheck_requested",
  };
}

function legacyDirectSignalKinds(): string[] {
  return [
    ["manual", "run", "requested"].join("_"),
    ["browser", "vault", "refresh", "requested"].join("_"),
    ["mailbox", "lag", "observed"].join("_"),
    ["device", "sync", "recovery", "requested"].join("_"),
  ];
}

function mailboxLag(input: {
  lane?: "conversation" | "system";
} = {}) {
  const lane = input.lane ?? "conversation";
  return {
    importedSeq: "0",
    lag: "1",
    lane,
    maxSeq: "1",
    maxUpdatedAt: isoAfter(-30_000),
  };
}

function reconciliationFacts(input: {
  blocked?: HostedRuntimeReconciliationFacts["blocked"];
  mailboxLag?: HostedRuntimeReconciliationFacts["mailboxLag"];
  workspace?: HostedRuntimeReconciliationFactsWorkspace | null;
} = {}): HostedRuntimeReconciliationFacts {
  return {
    blocked: input.blocked ?? null,
    mailboxLag: input.mailboxLag ?? [],
    workspace: input.workspace ?? null,
  };
}

function workspaceProjection(
  input: Partial<HostedRuntimeReconciliationFactsWorkspace>,
): HostedRuntimeReconciliationFactsWorkspace {
  return {
    inboxMediaRetentionWakeAt: input.inboxMediaRetentionWakeAt ?? null,
    nextWakeAt: input.nextWakeAt ?? null,
    nextWakeReason: input.nextWakeReason ?? null,
    version: input.version ?? null,
  };
}

function processingAccepted(
  input: Partial<
    Extract<
      HostedRuntimeEnsureProcessingResponse,
      { kind: "runtime_processing_accepted" }
    >
  > = {},
): HostedRuntimeEnsureProcessingResponse {
  return {
    action: input.action ?? "started",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: input.recommendedRecheckAt ?? isoAfter(0),
    runtimeAttemptId: input.runtimeAttemptId ?? "runtime_attempt_test",
  };
}

function nonRetryableError(message: string): Error & { nonRetryable: true } {
  const error = new Error(message) as Error & { nonRetryable: true };
  error.nonRetryable = true;
  return error;
}

function isoAfter(deltaMs: number): string {
  return new Date(BASE_TIME_MS + deltaMs).toISOString();
}
