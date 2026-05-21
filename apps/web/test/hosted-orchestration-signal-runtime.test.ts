import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  readHostedMailboxItemCheckpointById: vi.fn(),
  signalWithStart: vi.fn(),
}));

const defaultWorkflowOptions = {
  ensureCloudflareExecutionStartToCloseTimeoutMs: 630_000,
  readRuntimeDemandStartToCloseTimeoutMs: 10_000,
};

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxItemCheckpointById:
    mocks.readHostedMailboxItemCheckpointById,
}));

import {
  buildHostedRuntimeSignalEventId,
  sanitizeHostedRuntimeSignalSource,
  signalHostedBrowserVaultRefreshRuntime,
  signalHostedDeviceSyncMailboxRuntime,
  signalHostedMailboxAppendRuntime,
  signalHostedManualRunRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";

describe("hosted runtime Temporal signaling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signalWithStart.mockResolvedValue(undefined);
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue({
      id: "mailbox_123",
      lane: "conversation",
      laneSeq: "42",
      userId: "member_123",
    });
  });

  it("signals the per-user workflow with only a mailbox pointer", async () => {
    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      source: "email:agentmail",
    })).resolves.toEqual({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      {
        args: [{
          options: defaultWorkflowOptions,
          userId: "member_123",
        }],
        signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "conversation",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
          source: "email:agentmail",
        }],
        taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
        workflowId: "hosted-user-runtime:member_123",
      },
    );
    const signal = mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0];
    expect(Object.keys(signal as Record<string, unknown>).sort()).toEqual([
      "kind",
      "lane",
      "laneSeq",
      "mailboxItemId",
      "source",
    ]);
    expect(JSON.stringify(signal)).not.toMatch(/Please look|providerHeaders|messageText/u);
  });

  it("bounds and sanitizes mailbox source strings before signaling", async () => {
    const source = sanitizeHostedRuntimeSignalSource(
      " Agent Mail / Provider Hook <> With Spaces And A Very Very Long Tail ",
    );

    expect(source).toMatch(/^[a-z0-9._:-]+$/u);
    expect(source.length).toBeLessThanOrEqual(64);

    await signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      source,
    });

    expect(mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0]).toMatchObject({
      source,
    });
  });

  it("signals duplicate mailbox append attempts safely", async () => {
    const client = buildClient();

    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });
    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledTimes(2);
    expect(mocks.signalWithStart.mock.calls[1]?.[1]?.signalArgs[0]).toEqual(
      mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0],
    );
  });

  it("uses device-sync recovery signals for recovery handoff semantics", async () => {
    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          eventId: "device-sync-recovery:dirty:mailbox_123",
          kind: "device_sync_recovery_requested",
          reason: "dirty",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("signals browser-vault refresh with a deterministic pointer-only event id", async () => {
    await signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      source: "browser-vault/session",
      userId: "member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          eventId: "browser-vault-refresh:browser-vault-session:member_123",
          kind: "browser_vault_refresh_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(JSON.stringify(mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0])).not.toMatch(
      /prompt|headers|payload|message/u,
    );
  });

  it("signals manual runs with bounded source and event id", async () => {
    await signalHostedManualRunRuntime({
      client: buildClient(),
      eventSource: "settings.email.sync",
      source: "user",
      userId: "member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          eventId: "manual-run:user:settings.email.sync:member_123",
          kind: "manual_run_requested",
          source: "user",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("bounds generated runtime signal event ids", () => {
    const eventId = buildHostedRuntimeSignalEventId(
      "manual run",
      "admin",
      "A".repeat(240),
      "member_123",
    );

    expect(eventId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    expect(eventId.length).toBeLessThanOrEqual(192);
  });
});

function buildClient() {
  return {
    workflow: {
      signalWithStart: mocks.signalWithStart,
    },
  };
}
