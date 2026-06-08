import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  createHostedDeviceConnectIntentTx: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  recordHostedRuntimeLogTx: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  recordHostedRuntimeLogTx: mocks.recordHostedRuntimeLogTx,
}));

vi.mock("@/src/lib/device-sync/connect-intents", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/device-sync/connect-intents")
  >("@/src/lib/device-sync/connect-intents");

  return {
    ...actual,
    createHostedDeviceConnectIntentTx: mocks.createHostedDeviceConnectIntentTx,
  };
});

describe("hosted device sync reconnect notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      memberId: "member_123",
      phoneLookupKey: "phone:lookup",
      phoneNumber: "+15551234567",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_thread_123",
      linqRecipientPhone: "+15557654321",
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.createHostedDeviceConnectIntentTx.mockResolvedValue({
      claim: "dc_reconnect_opaque",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_reconnect_opaque&connectSource=whoop",
      deviceConnectUrl: "https://join.example.test/device/connect/dc_reconnect_opaque",
      expiresAt: "2026-05-22T22:03:28.000Z",
    });
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async (input) => ({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: "hmi_reconnect_123",
        dedupeKey: input.envelope.eventId,
      },
    }));
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends an exact-text preferred-channel reconnect notice with a direct connect URL", async () => {
    const {
      appendHostedDeviceSyncReconnectNoticeTx,
      startHostedDeviceSyncReconnectNoticeWorkflowBestEffort,
    } = await import("@/src/lib/device-sync/reconnect-notice");

    const result = await appendHostedDeviceSyncReconnectNoticeTx({
      appliedAt: "2026-05-19T22:03:28.000Z",
      connection: buildConnection(),
      failureCode: "WHOOP_TOKEN_REQUEST_FAILED",
      observedTokenVersion: 3,
      request: new Request("https://join.example.test/api/internal/device-sync/runtime/apply"),
      tx: { kind: "tx" } as never,
      userId: "member_123",
    });

    expect(result).toEqual({
      inserted: true,
      mailboxItemId: "hmi_reconnect_123",
      outcome: "inserted",
    });
    expect(mocks.createHostedDeviceConnectIntentTx).toHaveBeenCalledWith(expect.objectContaining({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      memberId: "member_123",
      provider: "whoop",
      ttlMs: 259200000,
    }));
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested",
      userId: "member_123",
      notification: {
        deliveryDispatchMode: "queue-only",
        responsePolicy: {
          kind: "require_send_exact_text",
          text:
            "Murph needs you to reconnect WHOOP so your wearable data can sync again: https://join.example.test/connect#deviceConnectIntent=dc_reconnect_opaque&connectSource=whoop",
        },
        route: {
          channel: "linq",
        },
      },
    });
    expect(envelope.notification.firstContact).toBeUndefined();
    expect(JSON.stringify(envelope)).not.toContain("whoop-client-secret");

    await startHostedDeviceSyncReconnectNoticeWorkflowBestEffort("hmi_reconnect_123");
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      mailboxItemId: "hmi_reconnect_123",
    });
  });

  it("does not create a fresh connect intent when the notice dedupe key already exists", async () => {
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "hmi_existing",
    });
    const { appendHostedDeviceSyncReconnectNoticeTx } = await import("@/src/lib/device-sync/reconnect-notice");

    await expect(appendHostedDeviceSyncReconnectNoticeTx({
      appliedAt: "2026-05-19T22:03:28.000Z",
      connection: buildConnection(),
      failureCode: "WHOOP_TOKEN_REQUEST_FAILED",
      observedTokenVersion: 3,
      request: new Request("https://join.example.test/api/internal/device-sync/runtime/apply"),
      tx: { kind: "tx" } as never,
      userId: "member_123",
    })).resolves.toMatchObject({
      inserted: false,
      mailboxItemId: "hmi_existing",
      outcome: "duplicate",
    });

    expect(mocks.createHostedDeviceConnectIntentTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses connection sources to resolve Junction-backed reconnect targets and notice labels", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_test_key");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-user-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_REGION", "us");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
    mocks.createHostedDeviceConnectIntentTx.mockResolvedValueOnce({
      claim: "dc_reconnect_opaque",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_reconnect_opaque&connectSource=garmin",
      deviceConnectUrl: "https://join.example.test/device/connect/dc_reconnect_opaque",
      expiresAt: "2026-05-22T22:03:28.000Z",
    });
    const { appendHostedDeviceSyncReconnectNoticeTx } = await import("@/src/lib/device-sync/reconnect-notice");

    await expect(appendHostedDeviceSyncReconnectNoticeTx({
      appliedAt: "2026-05-19T22:03:28.000Z",
      connection: buildJunctionConnection(),
      failureCode: "JUNCTION_TOKEN_REQUEST_FAILED",
      observedTokenVersion: null,
      request: new Request("https://join.example.test/api/internal/device-sync/runtime/apply"),
      tx: { kind: "tx" } as never,
      userId: "member_123",
    })).resolves.toMatchObject({
      inserted: true,
      mailboxItemId: "hmi_reconnect_123",
      outcome: "inserted",
    });

    expect(mocks.createHostedDeviceConnectIntentTx).toHaveBeenCalledWith(expect.objectContaining({
      connectSourceId: "garmin",
      connectTarget: "garmin",
      provider: "junction",
      sourceProviderSlug: "garmin",
    }));
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      notification: {
        responsePolicy: {
          text:
            "Murph needs you to reconnect Garmin so your wearable data can sync again: https://join.example.test/connect#deviceConnectIntent=dc_reconnect_opaque&connectSource=garmin",
        },
      },
    });
  });
});

function buildConnection() {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    displayName: "WHOOP",
    externalAccountId: "whoop-account",
    id: "dsc_whoop",
    lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
    lastErrorMessage: "WHOOP token request failed.",
    lastSyncCompletedAt: "2026-05-18T00:00:00.000Z",
    lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
    lastSyncStartedAt: "2026-05-19T22:03:27.000Z",
    lastWebhookAt: null,
    metadata: {},
    nextReconcileAt: null,
    provider: "whoop",
    scopes: ["offline"],
    setupExpiresAt: null,
    setupPhase: null,
    status: "reauthorization_required" as const,
    updatedAt: "2026-05-19T22:03:28.000Z",
  };
}

function buildJunctionConnection() {
  return {
    ...buildConnection(),
    displayName: "Junction",
    externalAccountId: "junction-account",
    id: "dsc_junction",
    lastErrorCode: "JUNCTION_TOKEN_REQUEST_FAILED",
    lastErrorMessage: "Junction token request failed.",
    provider: "junction",
    sources: [
      {
        displayName: null,
        firstSeenAt: "2026-05-01T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-05-19T22:00:00.000Z",
        resourceCount: 3,
        sourceProviderSlug: "garmin",
        status: "connected" as const,
      },
    ],
  };
}
