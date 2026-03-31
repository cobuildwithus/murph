import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareHostedDispatchContext: vi.fn(async () => null),
  sendGatewayMessageLocal: vi.fn(async () => ({
    delivery: null,
    messageId: null,
    queued: true,
    sessionKey: "gwcs_example",
  })),
}));

vi.mock("@murph/gateway-core/local", () => ({
  sendGatewayMessageLocal: mocks.sendGatewayMessageLocal,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedDispatchContext: mocks.prepareHostedDispatchContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("hosted gateway dispatch forwards clientRequestId to the local gateway send path", async () => {
  const { executeHostedDispatchEvent } = await import("../src/hosted-runtime/events.ts");

  const dispatch = {
    event: {
      clientRequestId: "req-123",
      kind: "gateway.message.send",
      replyToMessageId: "5001",
      sessionKey: "gwcs_example",
      text: "Please follow up.",
      userId: "member_123",
    },
    eventId: "gateway-send:abc123",
    occurredAt: "2026-03-31T09:15:00.000Z",
  } as const;

  const metrics = await executeHostedDispatchEvent({
    dispatch,
    emailBaseUrl: "https://email.example.test",
    runtime: {
      commitTimeoutMs: null,
      userEnv: {},
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: null,
        internalToken: null,
        schedulerToken: null,
        shareBaseUrl: null,
        shareToken: null,
      },
    },
    runtimeEnv: {},
    vaultRoot: "/tmp/hosted-gateway-test",
  });

  assert.deepEqual(metrics, {
    bootstrapResult: null,
    shareImportResult: null,
    shareImportTitle: null,
  });
  assert.equal(mocks.prepareHostedDispatchContext.mock.calls.length, 1);
  assert.deepEqual(mocks.sendGatewayMessageLocal.mock.calls[0]?.[0], {
    clientRequestId: "req-123",
    dispatchMode: "queue-only",
    replyToMessageId: "5001",
    sessionKey: "gwcs_example",
    text: "Please follow up.",
    vault: "/tmp/hosted-gateway-test",
  });
});
