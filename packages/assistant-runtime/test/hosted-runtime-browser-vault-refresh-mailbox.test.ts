import {
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostedAssistantAskCompletionPreemptedError,
} from "../src/hosted-runtime/events/assistant-ask-completion-errors.ts";

const mocks = vi.hoisted(() => ({
  executeHostedMailboxEvent: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedMailboxEvent: mocks.executeHostedMailboxEvent,
}));

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxHandledThroughSeq,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeHostedMailboxEvent.mockResolvedValue(createMailboxMetrics());
});

describe("legacy Browser Vault refresh mailbox compaction", () => {
  it("collapses a long contiguous run into one refresh intent and advances the handled cursor", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-browser-vault-mailbox-collapse-",
    );
    let handledThroughWhileClaimed: string | null = null;

    try {
      for (let seq = 1; seq <= 128; seq += 1) {
        await enqueueRuntimeControlItem({
          kind: "runtime.browser-vault-refresh-requested",
          seq,
          vaultRoot: workspace.vaultRoot,
        });
      }
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toHaveLength(128);

      mocks.executeHostedMailboxEvent.mockImplementationOnce(async () => {
        handledThroughWhileClaimed = resolveHostedSystemMailboxHandledThroughSeq({
          importedSeq: "128",
          state: await readHostedSystemMailboxState(workspace.vaultRoot),
        });
        return createMailboxMetrics();
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(prepared).toMatchObject({
        item: {
          mailboxLaneSeq: "128",
          wake: { kind: "runtime.browser-vault-refresh-requested" },
        },
        itemId: "mailbox_browser_vault_refresh_128",
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
      expect(handledThroughWhileClaimed).toBe("127");
      const completedState = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(completedState.pending).toEqual([]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "128",
        state: completedState,
      })).toBe("128");
    } finally {
      await workspace.cleanup();
    }
  });

  it("stops at an interleaved non-refresh system item", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-browser-vault-mailbox-interleaved-",
    );

    try {
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 1,
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 2,
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueRuntimeControlItem({
        kind: "runtime.manual-requested",
        seq: 3,
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 4,
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 5,
        vaultRoot: workspace.vaultRoot,
      });

      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { mailboxLaneSeq: "2" },
        itemId: "mailbox_browser_vault_refresh_2",
      });
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toMatchObject([
          {
            mailboxLaneSeq: "3",
            wake: { kind: "runtime.manual-requested" },
          },
          {
            mailboxLaneSeq: "4",
            wake: { kind: "runtime.browser-vault-refresh-requested" },
          },
          {
            mailboxLaneSeq: "5",
            wake: { kind: "runtime.browser-vault-refresh-requested" },
          },
        ]);

      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { mailboxLaneSeq: "3" },
        itemId: "mailbox_runtime_manual_requested_3",
      });
      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { mailboxLaneSeq: "5" },
        itemId: "mailbox_browser_vault_refresh_5",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("does not collapse across a missing system-lane sequence", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-browser-vault-mailbox-gap-",
    );

    try {
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 1,
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueRuntimeControlItem({
        kind: "runtime.browser-vault-refresh-requested",
        seq: 3,
        vaultRoot: workspace.vaultRoot,
      });

      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { mailboxLaneSeq: "1" },
        itemId: "mailbox_browser_vault_refresh_1",
      });
      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { mailboxLaneSeq: "3" },
        itemId: "mailbox_browser_vault_refresh_3",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(2);
    } finally {
      await workspace.cleanup();
    }
  });

  it("retains the collapsed refresh intent when foreground work preempts it", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-browser-vault-mailbox-preemption-",
    );

    try {
      for (let seq = 1; seq <= 4; seq += 1) {
        await enqueueRuntimeControlItem({
          kind: "runtime.browser-vault-refresh-requested",
          seq,
          vaultRoot: workspace.vaultRoot,
        });
      }
      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        new HostedAssistantAskCompletionPreemptedError(),
      );

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime(),
        runtimeEnv: {},
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        item: { attemptCount: 1, mailboxLaneSeq: "4", status: "pending" },
        itemId: "mailbox_browser_vault_refresh_4",
        status: "preempted",
      });
      const preemptedState = await readHostedSystemMailboxState(
        workspace.vaultRoot,
      );
      expect(preemptedState.pending).toMatchObject([
        {
          attemptCount: 1,
          mailboxLaneSeq: "4",
          nextAttemptAt: null,
          status: "pending",
        },
      ]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "4",
        state: preemptedState,
      })).toBe("3");
      await expect(prepareNext(workspace.vaultRoot)).resolves.toMatchObject({
        item: { attemptCount: 2, mailboxLaneSeq: "4" },
        itemId: "mailbox_browser_vault_refresh_4",
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(2);
    } finally {
      await workspace.cleanup();
    }
  });
});

async function prepareNext(vaultRoot: string) {
  return await prepareHostedSystemMailboxItemForCheckpoint({
    executionContext: null,
    now: () => FIXED_NOW,
    runtime: createRuntime(),
    runtimeEnv: {},
    vaultRoot,
  });
}

async function enqueueRuntimeControlItem(input: {
  kind:
    | "runtime.browser-vault-refresh-requested"
    | "runtime.manual-requested";
  seq: number;
  vaultRoot: string;
}): Promise<void> {
  const item = createResolvedRuntimeControlItem(input);
  const wake = buildHostedExecutionRuntimeControlWake({
    eventId: item.item.dedupeKey,
    kind: input.kind,
    occurredAt: FIXED_NOW,
    userId: "test-user",
  });
  await enqueueHostedSystemMailboxItem({
    item,
    vaultRoot: input.vaultRoot,
    wake,
  });
}

function createResolvedRuntimeControlItem(input: {
  kind:
    | "runtime.browser-vault-refresh-requested"
    | "runtime.manual-requested";
  seq: number;
}): HostedMailboxResolvedImportItem {
  const kindSlug = input.kind === "runtime.browser-vault-refresh-requested"
    ? "browser_vault_refresh"
    : "runtime_manual_requested";
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: `runtime-control:${kindSlug}:${input.seq}`,
    expiresAt: null,
    id: `mailbox_${kindSlug}_${input.seq}`,
    kind: input.kind,
    lane: "system",
    laneSeq: String(input.seq),
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "synthetic-ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "test-user",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "synthetic-ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-runtime-control-request",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createRuntime(): HostedSystemMailboxRuntimeForTest {
  const platform: HostedRuntimePlatform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
  };

  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform,
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function createMailboxMetrics() {
  return {
    bootstrapResult: null,
    conversationMetrics: null,
    mailboxLane: "assistant-notification" as const,
    nextWakeAt: null,
    postCheckpointRecord: null,
    redactedLogEntries: [],
  };
}
