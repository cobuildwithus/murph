import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  handleHostedShareAcceptedDispatch: vi.fn(),
  prepareHostedDispatchContext: vi.fn(),
  queueAssistantFirstContactWelcome: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedDispatchContext: mocks.prepareHostedDispatchContext,
}));

vi.mock("@murphai/assistant-engine", () => ({
  queueAssistantFirstContactWelcome: mocks.queueAssistantFirstContactWelcome,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalMessageSender: Symbol("assistantGatewayLocalMessageSender"),
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
}));

vi.mock("@murphai/gateway-local", () => ({
  sendGatewayMessageLocal: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  ingestHostedEmailMessage: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  ingestHostedLinqMessage: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/share.ts", () => ({
  handleHostedShareAcceptedDispatch: mocks.handleHostedShareAcceptedDispatch,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  ingestHostedTelegramMessage: vi.fn(),
}));

import { executeHostedDispatchEvent } from "../src/hosted-runtime/events.ts";

function createRuntime() {
  return {
    commitTimeoutMs: null,
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: {
        async commit() {},
        async deletePreparedSideEffect() {},
        async readRawEmailMessage() {
          return null;
        },
        async readSideEffect() {
          return null;
        },
        async sendEmail() {},
        async writeSideEffect(record: unknown) {
          return record;
        },
      },
      usageExportPort: null,
    },
    userEnv: {},
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepareHostedDispatchContext.mockResolvedValue(null);
  mocks.handleHostedShareAcceptedDispatch.mockResolvedValue({
    shareImportResult: null,
    shareImportTitle: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted runtime event coverage", () => {
  it("treats activation without first contact as a noop welcome path", async () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_member_activated",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const result = await executeHostedDispatchEvent({
      dispatch,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.queueAssistantFirstContactWelcome).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      shareImportResult: null,
      shareImportTitle: null,
    });
  });

  it("returns noop metrics for assistant cron ticks and device-sync wakes", async () => {
    const runtime = createRuntime();
    const cronDispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "evt_cron",
      occurredAt: "2026-04-08T00:05:00.000Z",
      reason: "scheduled",
      userId: "member_123",
    });
    const wakeDispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      eventId: "evt_wake",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "manual-refresh",
      userId: "member_123",
    });

    await expect(
      executeHostedDispatchEvent({
        dispatch: cronDispatch,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toEqual({
      bootstrapResult: null,
      shareImportResult: null,
      shareImportTitle: null,
    });

    await expect(
      executeHostedDispatchEvent({
        dispatch: wakeDispatch,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toEqual({
      bootstrapResult: null,
      shareImportResult: null,
      shareImportTitle: null,
    });
  });

  it("delegates hydrated share acceptance to the share handler", async () => {
    mocks.handleHostedShareAcceptedDispatch.mockResolvedValue({
      shareImportResult: "imported",
      shareImportTitle: "Shared export",
    });
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:15:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });
    const sharePack = {
      ownerUserId: "member_sender",
      shareId: "share_123",
    };

    const result = await executeHostedDispatchEvent({
      dispatch,
      runtime: createRuntime(),
      runtimeEnv: {},
      sharePack,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.handleHostedShareAcceptedDispatch).toHaveBeenCalledWith({
      dispatch,
      sharePack,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });
    assert.deepEqual(result, {
      bootstrapResult: null,
      shareImportResult: "imported",
      shareImportTitle: "Shared export",
    });
  });

  it("fails closed on unexpected dispatch event kinds", async () => {
    await expect(
      executeHostedDispatchEvent({
        dispatch: {
          event: {
            kind: "unexpected.event",
          },
          eventId: "evt_unexpected",
          occurredAt: "2026-04-08T00:20:00.000Z",
        } as never,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).rejects.toThrow(/Unexpected hosted execution event/u);
  });
});
