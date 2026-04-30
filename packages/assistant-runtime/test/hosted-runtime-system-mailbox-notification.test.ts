import assert from "node:assert/strict";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-04-27T00:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeHostedMailboxEvent.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    redactedLogEntries: [],
  });
});

describe("hosted system mailbox notification execution context", () => {
  it("keeps delegated Vercel Gateway billing context on queued notification wakes", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:gateway-billing",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId: "member_123",
        stripeCustomerId: "cus_platform_gateway",
        userEnvKeys: [],
      },
    };

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedNotificationItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          executionContext: expect.objectContaining({
            hosted: expect.objectContaining({
              memberId: "member_123",
              stripeCustomerId: "cus_platform_gateway",
            }),
          }),
          forceQueueOnlyAssistantNotification: true,
          wake: expect.objectContaining({
            kind: "assistant.notification.requested",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform>,
): HostedSystemMailboxRuntimeForTest {
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
    ...platformOverrides,
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

function createResolvedNotificationItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "assistant.notification.requested:gateway-billing",
    expiresAt: null,
    id: "mailbox_item_system_notification",
    kind: "assistant.notification.requested",
    lane: "system",
    laneSeq: "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "dispatch-assistant-notification",
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
