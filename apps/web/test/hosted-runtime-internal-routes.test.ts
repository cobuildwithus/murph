import {
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedRuntimeLatencyTraceResponse,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-04-26T00:00:00.000Z";
const MAILBOX_ITEM_2_PAYLOAD_REF = "hosted-mailbox-payload:mailbox_item_2";
const UNSAFE_SENTINEL = "UNSAFE_CONTENT_SENTINEL";

const mocks = vi.hoisted(() => ({
  checkpointHostedWorkspace: vi.fn(),
  fetchHostedMailboxItemsAfterLaneCursors: vi.fn(),
  fetchHostedMailboxPayload: vi.fn(),
  hostedRuntimeMailboxMemberFindUnique: vi.fn(),
  getPrisma: vi.fn(),
  listHostedRuntimeLogs: vi.fn(),
  publishLegacySourceHashBrowserVaultReplicaRef: vi.fn(),
  publishLatestBrowserVaultReplicaRef: vi.fn(),
  readAcceptedRuntimeAttemptFailureSignalOwnerLogId: vi.fn(),
  readHostedMailboxConsumedSeqByLane: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedWorkspace: vi.fn(),
  recordHostedIngressAssistantInputStaged: vi.fn(),
  recordHostedIngressProviderStarted: vi.fn(),
  recordHostedIngressRuntimeMilestone: vi.fn(),
  recordHostedRuntimeLog: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-mailbox/store")>()),
  fetchHostedMailboxItemsAfterLaneCursors: mocks.fetchHostedMailboxItemsAfterLaneCursors,
  fetchHostedMailboxPayload: mocks.fetchHostedMailboxPayload,
  readHostedMailboxConsumedSeqByLane: mocks.readHostedMailboxConsumedSeqByLane,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", async (importOriginal) => ({
  // Keep the real pure helpers (e.g. the mailbox AI-gate predicate); only the
  // gate decision itself is stubbed.
  ...(await importOriginal<
    typeof import("@/src/lib/hosted-orchestration/runtime-usage-decision")
  >()),
  resolveHostedRuntimeAiUsageGate: mocks.resolveHostedRuntimeAiUsageGate,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  checkpointHostedWorkspace: mocks.checkpointHostedWorkspace,
  listHostedRuntimeLogs: mocks.listHostedRuntimeLogs,
  publishLatestBrowserVaultReplicaRef: mocks.publishLatestBrowserVaultReplicaRef,
  readAcceptedRuntimeAttemptFailureSignalOwnerLogId:
    mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId,
  readHostedWorkspace: mocks.readHostedWorkspace,
  recordHostedRuntimeLog: mocks.recordHostedRuntimeLog,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  recordHostedIngressAssistantInputStaged:
    mocks.recordHostedIngressAssistantInputStaged,
  recordHostedIngressProviderStarted: mocks.recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone: mocks.recordHostedIngressRuntimeMilestone,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

vi.mock("@/src/lib/hosted-workspace/legacy-source-hash-browser-vault", () => ({
  publishLegacySourceHashBrowserVaultReplicaRef:
    mocks.publishLegacySourceHashBrowserVaultReplicaRef,
  readLegacyExpectedSourceStateHash: (body: Record<string, unknown>) => {
    if (!Object.hasOwn(body, "expectedSourceStateHash")) {
      return null;
    }
    if (typeof body.expectedSourceStateHash !== "string" || !body.expectedSourceStateHash.trim()) {
      throw new TypeError(
        "Legacy hosted browser-vault replica publish expectedSourceStateHash must be a non-empty string.",
      );
    }
    return body.expectedSourceStateHash;
  },
}));

type MailboxFetchRoute = typeof import("../app/api/internal/hosted-mailbox/fetch/route");
type MailboxPayloadFetchRoute =
  typeof import("../app/api/internal/hosted-mailbox/payload/fetch/route");
type WorkspaceRoute = typeof import("../app/api/internal/hosted-workspace/route");
type WorkspaceCheckpointRoute =
  typeof import("../app/api/internal/hosted-workspace/checkpoint/route");
type BrowserVaultReplicaRoute =
  typeof import("../app/api/internal/hosted-workspace/browser-vault-replica/route");
type RuntimeLogRoute = typeof import("../app/api/internal/hosted-runtime/log/route");
type RuntimeLatencyRoute = typeof import("../app/api/internal/hosted-runtime/latency/route");
type RuntimeStatusRoute = typeof import("../app/api/internal/hosted-runtime/status/route");

let mailboxFetchRoute: MailboxFetchRoute;
let mailboxPayloadFetchRoute: MailboxPayloadFetchRoute;
let workspaceRoute: WorkspaceRoute;
let workspaceCheckpointRoute: WorkspaceCheckpointRoute;
let browserVaultReplicaRoute: BrowserVaultReplicaRoute;
let runtimeLogRoute: RuntimeLogRoute;
let runtimeLatencyRoute: RuntimeLatencyRoute;
let runtimeStatusRoute: RuntimeStatusRoute;

describe("hosted runtime internal web routes", () => {
  beforeAll(async () => {
    mailboxFetchRoute = await import("../app/api/internal/hosted-mailbox/fetch/route");
    mailboxPayloadFetchRoute = await import(
      "../app/api/internal/hosted-mailbox/payload/fetch/route"
    );
    workspaceRoute = await import("../app/api/internal/hosted-workspace/route");
    workspaceCheckpointRoute = await import(
      "../app/api/internal/hosted-workspace/checkpoint/route"
    );
    browserVaultReplicaRoute = await import(
      "../app/api/internal/hosted-workspace/browser-vault-replica/route"
    );
    runtimeLogRoute = await import("../app/api/internal/hosted-runtime/log/route");
    runtimeLatencyRoute = await import("../app/api/internal/hosted-runtime/latency/route");
    runtimeStatusRoute = await import("../app/api/internal/hosted-runtime/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostedRuntimeMailboxMemberFindUnique.mockResolvedValue(
      buildRuntimeMailboxAccessRecord(),
    );
    mocks.getPrisma.mockReturnValue(createPrismaClientStub());
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_routes_1");
    mocks.readHostedMailboxConsumedSeqByLane.mockImplementation((input: {
      lanes?: readonly string[];
    }) => Promise.resolve((input.lanes ?? ["conversation", "system"]).map((lane) => ({
      consumedSeq: "999",
      lane,
    }))));
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveHostedMemberRecord());
    mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId.mockResolvedValue(null);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "allowed",
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_routes_1",
    });
  });

  it("fetches mailbox DTOs by lane cursor without hydrating sidecar payload bodies", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "11",
        lane: "conversation",
      },
      {
        consumedSeq: "0",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-1",
          expiresAt: null,
          id: "mailbox_item_1",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_1",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
        {
          createdAt: FIXED_NOW,
          dedupeKey: "system-dedupe-1",
          expiresAt: null,
          id: "mailbox_item_2",
          kind: "assistant.notification.requested",
          lane: "system",
          laneSeq: "3",
          occurredAt: FIXED_NOW,
          payloadBytes: 128000,
          payloadInlineCiphertext: null,
          payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "12",
      },
      {
        lane: "system",
        maxSeq: "3",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        cursorMode: "imported_seq",
        lanes: [
          {
            importedSeq: "11",
            lane: "conversation",
          },
          {
            importedSeq: "2",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_1",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "11",
          lane: "conversation",
        },
        {
          afterSeq: "2",
          lane: "system",
        },
      ],
      limitPerLane: 10,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(mocks.fetchHostedMailboxPayload).not.toHaveBeenCalled();
    expect(payload.items[1]).toMatchObject({
      payloadInlineCiphertext: null,
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
    });
    expect(JSON.stringify(payload)).not.toContain("payloadCiphertext");
  });

  it("fetches after the local imported watermark while returning the consumed floor", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "14",
      },
      {
        lane: "system",
        maxSeq: "8",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        cursorMode: "imported_seq",
        lanes: [
          {
            importedSeq: "14",
            lane: "conversation",
          },
          {
            importedSeq: "8",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_replay",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.readHostedMailboxConsumedSeqByLane).toHaveBeenCalledWith({
      lanes: ["conversation", "system"],
      userId: "member_routes_1",
    });
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "14",
          lane: "conversation",
        },
        {
          afterSeq: "8",
          lane: "system",
        },
      ],
      limitPerLane: 10,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(payload.consumedSeqByLane).toEqual([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
    expect(payload.items).toHaveLength(0);
  });

  it("anchors legacy conversation fetches at the consumed floor without rewinding system", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "14",
      },
      {
        lane: "system",
        maxSeq: "8",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "14",
            lane: "conversation",
          },
          {
            importedSeq: "8",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_legacy_replay",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "13",
          lane: "conversation",
        },
        {
          afterSeq: "8",
          lane: "system",
        },
      ],
      limitPerLane: 10,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(payload.consumedSeqByLane).toEqual([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
  });

  it("does not strand ungated system work behind consumed conversation metadata when access is denied", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "denied",
    });
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "browser-vault-dedupe-denied-replay",
          expiresAt: null,
          id: "mailbox_browser_vault_denied_replay",
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "2",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_browser_vault_denied_replay",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "14",
      },
      {
        lane: "system",
        maxSeq: "2",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        cursorMode: "imported_seq",
        lanes: [
          {
            importedSeq: "14",
            lane: "conversation",
          },
          {
            importedSeq: "1",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_replay_denied",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "14",
          lane: "conversation",
        },
        {
          afterSeq: "1",
          lane: "system",
        },
      ],
      limitPerLane: 10,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(payload.items.map((item) => item.id)).toEqual([
      "mailbox_browser_vault_denied_replay",
    ]);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("fetches the fresh tail when local import is ahead of consume", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "0",
        lane: "conversation",
      },
      {
        consumedSeq: "0",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-fresh-251",
          expiresAt: null,
          id: "mailbox_item_fresh_251",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "251",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_fresh_251",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "251",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        cursorMode: "imported_seq",
        lanes: [
          {
            importedSeq: "250",
            lane: "conversation",
          },
          {
            importedSeq: "0",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_recovery",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "250",
          lane: "conversation",
        },
        {
          afterSeq: "0",
          lane: "system",
        },
      ],
      limitPerLane: 10,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.laneSeq).toBe("251");
  });

  it("does not AI-gate consumed-ahead restored context when access is denied", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "denied",
    });
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "250",
        lane: "conversation",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-consumed-context-001",
          expiresAt: null,
          id: "mailbox_item_consumed_context_001",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "1",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_consumed_context_001",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "251",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "0",
            lane: "conversation",
          },
        ],
        limitPerLane: 2,
        requestId: "request_mailbox_fetch_stale_local_denied",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).toHaveBeenCalledWith({
      lanes: [
        {
          afterSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 2,
      now: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(payload.items.map((item) => item.id)).toEqual([
      "mailbox_item_consumed_context_001",
    ]);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("does not AI-gate fresh conversation tombstones when access is denied", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "denied",
    });
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "13",
        lane: "conversation",
      },
      {
        consumedSeq: "1",
        lane: "system",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-tombstone-denied",
          expiresAt: FIXED_NOW,
          id: "mailbox_item_tombstone_denied",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "14",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: null,
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
        {
          createdAt: FIXED_NOW,
          dedupeKey: "browser-vault-dedupe-tombstone-denied",
          expiresAt: null,
          id: "mailbox_browser_vault_tombstone_denied",
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "2",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_browser_vault_tombstone_denied",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "14",
      },
      {
        lane: "system",
        maxSeq: "2",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "13",
            lane: "conversation",
          },
          {
            importedSeq: "1",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_tombstone_denied",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.items.map((item) => item.id)).toEqual([
      "mailbox_item_tombstone_denied",
      "mailbox_browser_vault_tombstone_denied",
    ]);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("rejects mailbox fetches for inactive members before reading mailbox state", async () => {
    mocks.hostedRuntimeMailboxMemberFindUnique.mockResolvedValueOnce(null);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "conversation",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_inactive",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
  });

  it("rejects mailbox fetches for thread containers when the owner is inactive", async () => {
    mocks.hostedRuntimeMailboxMemberFindUnique.mockResolvedValueOnce(
      buildRuntimeMailboxAccessRecord({
        threadContainer: {
          owner: buildRuntimeMailboxAccessRecord({
            billingStatus: "paused",
          }),
        },
      }),
    );

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "conversation",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_thread_owner_inactive",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
  });

  it("rejects conversation mailbox items when the AI usage gate denies runtime consumption", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "11",
        lane: "conversation",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-denied",
          expiresAt: null,
          id: "mailbox_item_denied",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_denied",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "12",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "conversation",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_usage_denied",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      userId: "member_routes_1",
    });
  });

  it("rejects manual runtime-control mailbox items when the AI usage gate denies runtime consumption", async () => {
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "manual-dedupe-denied",
          expiresAt: null,
          id: "mailbox_manual_denied",
          kind: "runtime.manual-requested",
          lane: "system",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_denied",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "system",
        maxSeq: "12",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_manual_denied",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      userId: "member_routes_1",
    });
  });

  it("does not AI-gate non-manual system mailbox consumption", async () => {
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "browser-vault-dedupe",
          expiresAt: null,
          id: "mailbox_browser_vault",
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_browser_vault",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "system",
        maxSeq: "12",
      },
    ]);

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "system",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_browser_vault",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("gates the whole mixed mailbox fetch batch when any item needs the AI usage gate", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "11",
        lane: "system",
      },
      {
        consumedSeq: "11",
        lane: "conversation",
      },
    ]);
    mocks.fetchHostedMailboxItemsAfterLaneCursors.mockResolvedValue({
      items: [
        {
          createdAt: FIXED_NOW,
          dedupeKey: "browser-vault-dedupe-mixed",
          expiresAt: null,
          id: "mailbox_browser_vault_mixed",
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_browser_vault_mixed",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
        {
          createdAt: FIXED_NOW,
          dedupeKey: "conversation-dedupe-mixed",
          expiresAt: null,
          id: "mailbox_item_mixed",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_mixed",
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: FIXED_NOW,
          userId: "member_routes_1",
        },
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "system",
        maxSeq: "12",
      },
      {
        lane: "conversation",
        maxSeq: "12",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        lanes: [
          {
            importedSeq: "11",
            lane: "system",
          },
          {
            importedSeq: "11",
            lane: "conversation",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_mixed_denied",
      },
    ));

    // One gated conversation item denies the whole batch, including the
    // non-gated system item: all-or-nothing watermark semantics.
    expect(response.status).toBe(403);
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      userId: "member_routes_1",
    });
  });

  it("fetches a mailbox payload sidecar through the separate signed route", async () => {
    mocks.fetchHostedMailboxPayload.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      payload: {
        createdAt: FIXED_NOW,
        mailboxItemId: "mailbox_item_2",
        payloadCiphertext: "cipher_ref_2",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: "member_routes_1",
      },
      unavailable: null,
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_item_2",
        mailboxItemId: "mailbox_item_2",
        payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
        requestId: "request_payload_fetch_1",
      },
    ));
    const payload = parseHostedMailboxPayloadFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedMailboxPayload).toHaveBeenCalledWith({
      dedupeKey: "dedupe_item_2",
      mailboxItemId: "mailbox_item_2",
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
      requestId: "request_payload_fetch_1",
      userId: "member_routes_1",
    });
    expect(payload.payload?.payloadCiphertext).toBe("cipher_ref_2");
    expect(JSON.stringify(payload)).not.toContain(UNSAFE_SENTINEL);
  });

  it("rejects mailbox payload fetches for inactive members", async () => {
    mocks.hostedRuntimeMailboxMemberFindUnique.mockResolvedValueOnce(buildRuntimeMailboxAccessRecord({
      suspendedAt: new Date("2026-04-26T00:00:00.000Z"),
    }));

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_item_2",
        mailboxItemId: "mailbox_item_2",
        payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
        requestId: "request_payload_fetch_inactive",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.fetchHostedMailboxPayload).not.toHaveBeenCalled();
  });

  it("rejects conversation mailbox payload fetches when the AI usage gate denies runtime consumption", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "11",
        lane: "conversation",
      },
    ]);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_item_2",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "12",
      payloadInlineCiphertext: null,
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
      userId: "member_routes_1",
    });
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_item_2",
        mailboxItemId: "mailbox_item_2",
        payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
        requestId: "request_payload_fetch_usage_denied",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      userId: "member_routes_1",
    });
    expect(mocks.fetchHostedMailboxPayload).not.toHaveBeenCalled();
  });

  it("rejects manual runtime-control mailbox payload fetches when the AI usage gate denies runtime consumption", async () => {
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "11",
        lane: "system",
      },
    ]);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_manual_2",
      kind: "runtime.manual-requested",
      lane: "system",
      laneSeq: "12",
      userId: "member_routes_1",
    });
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "manual-dedupe-2",
        mailboxItemId: "mailbox_manual_2",
        payloadRef: "hosted-mailbox-payload:mailbox_manual_2",
        requestId: "request_payload_fetch_manual_denied",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.readHostedMailboxConsumedSeqByLane).toHaveBeenCalledWith({
      lanes: ["system"],
      userId: "member_routes_1",
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      userId: "member_routes_1",
    });
    expect(mocks.fetchHostedMailboxPayload).not.toHaveBeenCalled();
  });

  it("does not AI-gate consumed conversation mailbox payload replay", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "denied",
    });
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValueOnce([
      {
        consumedSeq: "14",
        lane: "conversation",
      },
    ]);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_item_2",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "14",
      payloadInlineCiphertext: null,
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
      userId: "member_routes_1",
    });
    mocks.fetchHostedMailboxPayload.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      payload: {
        createdAt: FIXED_NOW,
        mailboxItemId: "mailbox_item_2",
        payloadCiphertext: "payload_cipher_2",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: "member_routes_1",
      },
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_item_2",
        mailboxItemId: "mailbox_item_2",
        payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
        requestId: "request_payload_fetch_replay_denied",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.fetchHostedMailboxPayload).toHaveBeenCalledWith({
      dedupeKey: "dedupe_item_2",
      mailboxItemId: "mailbox_item_2",
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
      requestId: "request_payload_fetch_replay_denied",
      userId: "member_routes_1",
    });
  });

  it("does not AI-gate mismatched mailbox payload metadata", async () => {
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_item_other",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "12",
      userId: "member_routes_1",
    });
    mocks.fetchHostedMailboxPayload.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: false,
      },
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_item_2",
        mailboxItemId: "mailbox_item_2",
        payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
        requestId: "request_payload_fetch_mismatched_metadata",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.fetchHostedMailboxPayload).toHaveBeenCalledWith({
      dedupeKey: "dedupe_item_2",
      mailboxItemId: "mailbox_item_2",
      payloadRef: MAILBOX_ITEM_2_PAYLOAD_REF,
      requestId: "request_payload_fetch_mismatched_metadata",
      userId: "member_routes_1",
    });
  });

  it("does not AI-gate non-manual system mailbox payload fetches", async () => {
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_browser_vault",
      kind: "runtime.browser-vault-refresh-requested",
      lane: "system",
      laneSeq: "12",
      userId: "member_routes_1",
    });
    mocks.fetchHostedMailboxPayload.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      payload: {
        createdAt: FIXED_NOW,
        mailboxItemId: "mailbox_browser_vault",
        payloadCiphertext: "cipher_ref_browser_vault",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: "member_routes_1",
      },
      unavailable: null,
    });

    const response = await mailboxPayloadFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/payload/fetch",
      {
        dedupeKey: "dedupe_browser_vault",
        mailboxItemId: "mailbox_browser_vault",
        payloadRef: "hosted-mailbox-payload:mailbox_browser_vault",
        requestId: "request_payload_fetch_browser_vault",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.fetchHostedMailboxPayload).toHaveBeenCalledWith({
      dedupeKey: "dedupe_browser_vault",
      mailboxItemId: "mailbox_browser_vault",
      payloadRef: "hosted-mailbox-payload:mailbox_browser_vault",
      requestId: "request_payload_fetch_browser_vault",
      userId: "member_routes_1",
    });
  });

  it("reads workspace state and checkpoints with the workspace CAS fence", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({ version: "4" }));
    mocks.checkpointHostedWorkspace
      .mockResolvedValueOnce({
        replacedSnapshotRef: createBundleRef("snapshot_1"),
        status: "updated",
        workspace: buildWorkspaceRecord({
          checkpointedAt: "2026-04-26T00:01:00.000Z",
          redactedStatusJson: {
            conversationImportedSeq: "12",
            state: "idle",
          },
          version: "5",
        }),
      })
      .mockResolvedValueOnce({
        replacedSnapshotRef: null,
        status: "conflict",
        workspace: buildWorkspaceRecord({
          snapshotRef: createBundleRef("snapshot_current"),
          version: "6",
        }),
      });

    const readResponse = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace",
      { method: "GET" },
    ));
    expect(parseHostedWorkspaceReadResponse(await readResponse.json()).workspace)
      .toMatchObject({
        userId: "member_routes_1",
        version: "4",
      });

    const checkpointResponse = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        inboxMediaRetentionWakeAt: "2026-04-26T00:10:00.000Z",
        leaseGeneration: "2",
        nextWakeAt: "2026-04-26T00:05:00.000Z",
        nextWakeReason: "mailbox",
        reason: "import",
        redactedStatus: {
          conversationImportedSeq: "12",
          state: "idle",
        },
        browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_2_hash"),
        snapshotRef: createBundleRef("snapshot_2"),
      },
    ));
    const checkpointPayload = parseHostedWorkspaceCheckpointResponse(
      await checkpointResponse.json(),
    );

    expect(checkpointPayload).toMatchObject({
      checkpointed: true,
      replacedSnapshotRef: createBundleRef("snapshot_1"),
      workspace: {
        version: "5",
      },
    });
    expect(mocks.checkpointHostedWorkspace).toHaveBeenCalledWith({
      expectedVersion: "4",
      inboxMediaRetentionWakeAt: "2026-04-26T00:10:00.000Z",
      nextWakeAt: "2026-04-26T00:05:00.000Z",
      nextWakeReason: "mailbox",
      reason: "import",
      redactedStatusJson: {
        conversationImportedSeq: "12",
        state: "idle",
      },
      snapshotRef: createBundleRef("snapshot_2"),
      userId: "member_routes_1",
    });

    const conflictResponse = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_2",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "3",
        reason: "canonical_runtime_commit",
        browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_stale_hash"),
        snapshotRef: createBundleRef("snapshot_stale"),
      },
    ));
    const conflictPayload = parseHostedWorkspaceCheckpointResponse(
      await conflictResponse.json(),
    );

    expect(conflictPayload).toMatchObject({
      checkpointed: false,
      checkpointConflictReason: "workspace_version",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "6",
      },
    });
    expect(JSON.stringify(conflictPayload)).not.toMatch(/runId|committedSeq|finalizeRequired|source_cursor/u);
  });

  it("returns a typed foreground-pending checkpoint conflict for idle shutdown races", async () => {
    mocks.checkpointHostedWorkspace.mockResolvedValue({
      status: "foreground_pending",
      workspace: buildWorkspaceRecord({
        snapshotRef: createBundleRef("snapshot_current"),
        version: "4",
      }),
    });

    const response = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_idle_shutdown_foreground_pending",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "2",
        reason: "idle_shutdown",
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "1",
        },
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
      },
    ));
    const payload = parseHostedWorkspaceCheckpointResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      checkpointed: false,
      checkpointConflictReason: "foreground_pending",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "4",
      },
    });
    expect(mocks.checkpointHostedWorkspace).toHaveBeenCalledWith({
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
      },
      snapshotRef: createBundleRef("snapshot_idle_shutdown"),
      userId: "member_routes_1",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("keeps old idle checkpoint callers compatible with the redacted mailbox imported seq", async () => {
    mocks.checkpointHostedWorkspace.mockResolvedValue({
      status: "foreground_pending",
      workspace: buildWorkspaceRecord({
        snapshotRef: createBundleRef("snapshot_current"),
        version: "4",
      }),
    });

    const response = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_idle_shutdown_redacted_seq",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "2",
        reason: "idle_shutdown",
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "1",
          state: "idle",
        },
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
      },
    ));
    const payload = parseHostedWorkspaceCheckpointResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      checkpointed: false,
      checkpointConflictReason: "foreground_pending",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "4",
      },
    });
    expect(mocks.checkpointHostedWorkspace).toHaveBeenCalledWith({
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
        state: "idle",
      },
      snapshotRef: createBundleRef("snapshot_idle_shutdown"),
      userId: "member_routes_1",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("signals a runtime recheck after checkpointing a future workspace wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    try {
      const nextWakeAt = "2026-04-26T00:05:00.000Z";
      mocks.checkpointHostedWorkspace.mockResolvedValue({
        status: "updated",
        workspace: buildWorkspaceRecord({
          checkpointedAt: "2026-04-26T00:01:00.000Z",
          nextWakeAt,
          nextWakeReason: "assistant",
          version: "5",
        }),
      });

      const response = await workspaceCheckpointRoute.POST(jsonRequest(
        "/api/internal/hosted-workspace/checkpoint",
        {
          attemptId: "attempt_future_wake_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "2",
          nextWakeAt,
          nextWakeReason: "assistant",
          reason: "canonical_runtime_commit",
          snapshotRef: createBundleRef("snapshot_future_wake"),
        },
      ));

      expect(response.status).toBe(200);
      expect(parseHostedWorkspaceCheckpointResponse(await response.json()))
        .toMatchObject({
          checkpointed: true,
          workspace: {
            nextWakeAt,
            nextWakeReason: "assistant",
            version: "5",
          },
        });
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
        userId: "member_routes_1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail checkpointing when the future wake recheck signal is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const nextWakeAt = "2026-04-26T00:05:00.000Z";
      mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
        new Error("Temporal unavailable"),
      );
      mocks.checkpointHostedWorkspace.mockResolvedValue({
        status: "updated",
        workspace: buildWorkspaceRecord({
          checkpointedAt: "2026-04-26T00:01:00.000Z",
          nextWakeAt,
          nextWakeReason: "assistant",
          version: "5",
        }),
      });

      const response = await workspaceCheckpointRoute.POST(jsonRequest(
        "/api/internal/hosted-workspace/checkpoint",
        {
          attemptId: "attempt_future_wake_signal_failure_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "2",
          nextWakeAt,
          nextWakeReason: "assistant",
          reason: "canonical_runtime_commit",
          snapshotRef: createBundleRef("snapshot_future_wake_signal_failure"),
        },
      ));

      expect(response.status).toBe(200);
      expect(parseHostedWorkspaceCheckpointResponse(await response.json()))
        .toMatchObject({
          checkpointed: true,
          workspace: {
            nextWakeAt,
            version: "5",
          },
        });
      expect(warnSpy).toHaveBeenCalledWith(
        "Hosted workspace wake recheck signal failed after checkpoint.",
        {
          errorName: "Error",
        },
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("serves workspace reads for inactive members so the mode-aware runtime owner can run due inbox media retention", async () => {
    // Admission policy is owned by `runtime-reconciliation-facts` and the
    // Temporal runtime workflow: inactive members are confined to
    // `inbox_media_retention` dispatch. Repeating the active-entitlement
    // check on this route would also block the retention run, leaving raw
    // inbox media past the 14-day retention window.
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(buildActiveHostedMemberRecord({
      billingStatus: "canceled",
    }));
    mocks.readHostedWorkspace.mockResolvedValueOnce(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: "2026-04-25T23:59:00.000Z",
      version: "7",
    }));

    const response = await workspaceRoute.GET(new Request(
      "https://example.test/api/internal/hosted-workspace",
    ));
    const payload = parseHostedWorkspaceReadResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: "2026-04-25T23:59:00.000Z",
      userId: "member_routes_1",
      version: "7",
    });
    expect(mocks.readHostedWorkspace).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
    // The route no longer consults member entitlement; that owner lives in
    // reconciliation/runtime invocation.
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("reads workspace state for sponsored Family members", async () => {
    const prisma = createPrismaClientStub();
    prisma.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      group: {
        billingStatus: "active",
        id: "hbag_family",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      groupId: "hbag_family",
      memberId: "member_routes_1",
      role: "member",
      status: "active",
    });
    prisma.hostedAccountGroupMembership.count.mockResolvedValueOnce(2);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(buildActiveHostedMemberRecord({
      billingStatus: "not_started",
    }));
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({ version: "4" }));

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace",
      { method: "GET" },
    ));

    expect(response.status).toBe(200);
    expect(parseHostedWorkspaceReadResponse(await response.json()).workspace)
      .toMatchObject({
        userId: "member_routes_1",
        version: "4",
      });
  });

  it("accepts old runner checkpoint payloads without browser-vault replica refs", async () => {
    mocks.checkpointHostedWorkspace.mockResolvedValue({
      status: "updated",
      workspace: buildWorkspaceRecord({
        checkpointedAt: "2026-04-26T00:01:00.000Z",
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      }),
    });

    const response = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_legacy_runner_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "2",
        reason: "import",
        snapshotRef: createBundleRef("snapshot_2"),
      },
    ));
    const payload = parseHostedWorkspaceCheckpointResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      checkpointed: true,
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
    expect(mocks.checkpointHostedWorkspace).toHaveBeenCalledWith({
      expectedVersion: "4",
      reason: "import",
      snapshotRef: createBundleRef("snapshot_2"),
      userId: "member_routes_1",
    });
  });

  it("publishes latest browser-vault replica refs through the separate derived-data route", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    mocks.publishLatestBrowserVaultReplicaRef.mockResolvedValue({
      status: "published",
      workspace: buildWorkspaceRecord({
        browserVaultReplicaRef: replicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      }),
    });

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        replicaRef,
      },
      runtimeWriteFenceHeaders(),
    ));
    const payload = parseHostedBrowserVaultReplicaPublishResponse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      published: true,
      workspace: {
        browserVaultReplicaRef: replicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
    expect(mocks.publishLatestBrowserVaultReplicaRef).toHaveBeenCalledWith({
      expectedWorkspaceVersion: "4",
      replicaRef,
      userId: "member_routes_1",
    });
  });

  it("rejects browser-vault replica publishes without runtime write-fence headers", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        replicaRef,
      },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        message: "Invalid request.",
      },
    });
    expect(mocks.publishLatestBrowserVaultReplicaRef).not.toHaveBeenCalled();
    expect(mocks.publishLegacySourceHashBrowserVaultReplicaRef)
      .not.toHaveBeenCalled();
  });

  it("fences legacy source-hash browser-vault publishes behind the compatibility helper", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    mocks.publishLegacySourceHashBrowserVaultReplicaRef.mockResolvedValue({
      status: "published",
      workspace: buildWorkspaceRecord({
        browserVaultReplicaRef: replicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      }),
    });

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        expectedSourceStateHash: "snapshot_2_hash",
        replicaRef,
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(response.status).toBe(200);
    expect(mocks.publishLegacySourceHashBrowserVaultReplicaRef)
      .toHaveBeenCalledWith({
        expectedSourceStateHash: "snapshot_2_hash",
        expectedWorkspaceVersion: "4",
        replicaRef,
        userId: "member_routes_1",
      });
    expect(mocks.publishLatestBrowserVaultReplicaRef).not.toHaveBeenCalled();
  });

  it("rejects malformed legacy source-hash browser-vault publish fields before publishing", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        expectedSourceStateHash: "",
        replicaRef,
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        message: "Invalid request.",
      },
    });
    expect(mocks.publishLegacySourceHashBrowserVaultReplicaRef)
      .not.toHaveBeenCalled();
    expect(mocks.publishLatestBrowserVaultReplicaRef).not.toHaveBeenCalled();
  });

  it("treats missing workspace browser-vault publishes as stale work", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    mocks.publishLatestBrowserVaultReplicaRef.mockResolvedValue({
      status: "missing",
      workspace: null,
    });

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        replicaRef,
      },
      runtimeWriteFenceHeaders(),
    ));
    const payload = parseHostedBrowserVaultReplicaPublishResponse(
      await response.json(),
    );

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      published: false,
      workspace: null,
    });
    expect(mocks.publishLatestBrowserVaultReplicaRef).toHaveBeenCalledWith({
      expectedWorkspaceVersion: "4",
      replicaRef,
      userId: "member_routes_1",
    });
  });

  it("records bounded runtime logs and rejects forbidden log payload fields", async () => {
    mocks.recordHostedRuntimeLog.mockResolvedValue({
      at: FIXED_NOW,
      attemptId: "attempt_1",
      checkpointVersion: null,
      component: "mailbox",
      createdAt: FIXED_NOW,
      errorCode: null,
      eventCode: "mailbox.imported",
      id: "runtime_log_1",
      leaseGeneration: "2",
      level: "info",
      mailboxLane: "conversation",
      mailboxSeqEnd: "12",
      mailboxSeqStart: "12",
      outboxIntentRef: null,
      phase: "import",
      redactedJson: {
        count: 1,
        lane: "conversation",
      },
      userId: "member_routes_1",
      workspaceVersion: "5",
    });

    const response = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            attemptId: "attempt_1",
            component: "mailbox",
            eventCode: "mailbox.imported",
            leaseGeneration: "2",
            level: "info",
            mailboxLane: "conversation",
            mailboxSeqEnd: "12",
            mailboxSeqStart: "12",
            phase: "import",
            redactedJson: {
              count: 1,
              lane: "conversation",
              safeErrorMessage: "Codex app-server failed before producing a reply.",
            },
            workspaceVersion: "5",
          },
        ],
      },
    ));

    expect(response.status).toBe(200);
    expect(parseHostedRuntimeLogResponse(await response.json())).toEqual({
      loggedCount: 1,
    });
    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledWith(expect.objectContaining({
      redacted: {
        count: 1,
        lane: "conversation",
        safeErrorMessage: "Codex app-server failed before producing a reply.",
      },
      userId: "member_routes_1",
    }));
    expect(mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();

    const rejectedResponse = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            component: "mailbox",
            eventCode: "mailbox.imported",
            level: "info",
            message: UNSAFE_SENTINEL,
            phase: "import",
          },
        ],
      },
    ));
    const rejectedText = await rejectedResponse.text();

    expect(rejectedResponse.status).toBe(400);
    expect(rejectedText).not.toContain(UNSAFE_SENTINEL);
    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledTimes(1);

    const unsafeCodeResponse = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            component: "mailbox",
            errorCode: ["person", "example.test"].join("@"),
            eventCode: "mailbox.imported",
            level: "info",
            phase: "import",
          },
        ],
      },
    ));
    expect(unsafeCodeResponse.status).toBe(400);
    expect(await unsafeCodeResponse.text()).not.toContain("example.test");

    const unsafeRedactedResponse = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            component: "mailbox",
            eventCode: "mailbox.imported",
            level: "info",
            phase: "import",
            redactedJson: {
              reason: `sent to ${["person", "example.test"].join("@")}`,
            },
          },
        ],
      },
    ));
    expect(unsafeRedactedResponse.status).toBe(400);
    expect(await unsafeRedactedResponse.text()).not.toContain("example.test");

    const oversizedResponse = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: Array.from({ length: 51 }, () => ({
          at: FIXED_NOW,
          component: "mailbox",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
        })),
      },
    ));
    expect(oversizedResponse.status).toBe(400);
    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledTimes(1);
  });

  it("records hosted runtime latency callbacks under the signed user", async () => {
    mocks.recordHostedIngressAssistantInputStaged.mockResolvedValue({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    mocks.recordHostedIngressProviderStarted.mockResolvedValue({
      matchedCount: 2,
      recorded: true,
      unmatchedCount: 0,
    });
    mocks.recordHostedIngressRuntimeMilestone.mockResolvedValue({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });

    const stagedResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputId: "input_1",
          at: FIXED_NOW,
          mailboxItemId: "mailbox_item_1",
          runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
          runtimeAttemptId: "attempt_routes_1",
          runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
          source: "linq",
          type: "assistant_input_staged",
          workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(stagedResponse.status).toBe(200);
    expect(parseHostedRuntimeLatencyTraceResponse(await stagedResponse.json())).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(mocks.recordHostedIngressAssistantInputStaged).toHaveBeenCalledWith({
      assistantInputId: "input_1",
      at: FIXED_NOW,
      authenticatedUserId: "member_routes_1",
      mailboxItemId: "mailbox_item_1",
      runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
      runtimeAttemptId: "attempt_routes_1",
      runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
      source: "linq",
      workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
    });

    const providerResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputIds: ["input_1", "input_2"],
          at: FIXED_NOW,
          providerRequestOrdinal: 0,
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          type: "provider_started",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(providerResponse.status).toBe(200);
    expect(parseHostedRuntimeLatencyTraceResponse(await providerResponse.json())).toEqual({
      matchedCount: 2,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(mocks.recordHostedIngressProviderStarted).toHaveBeenCalledWith({
      assistantInputIds: ["input_1", "input_2"],
      at: FIXED_NOW,
      authenticatedUserId: "member_routes_1",
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_routes_1",
      source: "linq",
    });

    const milestoneResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          at: FIXED_NOW,
          milestone: "mailbox_import_done",
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          type: "runtime_milestone",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(milestoneResponse.status).toBe(200);
    expect(parseHostedRuntimeLatencyTraceResponse(await milestoneResponse.json())).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(mocks.recordHostedIngressRuntimeMilestone).toHaveBeenCalledWith({
      at: FIXED_NOW,
      authenticatedUserId: "member_routes_1",
      milestone: "mailbox_import_done",
      runtimeAttemptId: "attempt_routes_1",
      source: "linq",
    });

    const mismatchedAttemptResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputId: "input_1",
          at: FIXED_NOW,
          mailboxItemId: "mailbox_item_1",
          runtimeAttemptId: "attempt_other",
          source: "linq",
          type: "assistant_input_staged",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(mismatchedAttemptResponse.status).toBe(401);

    const unsafeResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputId: "input_1",
          at: FIXED_NOW,
          mailboxItemId: "mailbox_item_1",
          source: "linq",
          type: "assistant_input_staged",
          userId: "member_routes_2",
        },
      },
    ));

    expect(unsafeResponse.status).toBe(400);
    expect(mocks.recordHostedIngressAssistantInputStaged).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedIngressProviderStarted).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedIngressRuntimeMilestone).toHaveBeenCalledTimes(1);
  });

  it("accepts max-cardinality provider latency callbacks under the shared body limit", async () => {
    mocks.recordHostedIngressProviderStarted.mockResolvedValue({
      matchedCount: 64,
      recorded: true,
      unmatchedCount: 0,
    });
    const assistantInputIds = Array.from({ length: 64 }, (_value, index) =>
      `input_${index.toString().padStart(2, "0")}_${"a".repeat(230)}`
    );

    const response = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputIds,
          at: FIXED_NOW,
          providerRequestOrdinal: 0,
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          type: "provider_started",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(response.status).toBe(200);
    expect(parseHostedRuntimeLatencyTraceResponse(await response.json())).toEqual({
      matchedCount: 64,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(mocks.recordHostedIngressProviderStarted).toHaveBeenCalledWith({
      assistantInputIds,
      at: FIXED_NOW,
      authenticatedUserId: "member_routes_1",
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_routes_1",
      source: "linq",
    });
  });

  it("signals a stateless runtime recheck after an accepted runtime attempt failure log", async () => {
    mocks.recordHostedRuntimeLog.mockResolvedValue({
      at: FIXED_NOW,
      attemptId: null,
      checkpointVersion: null,
      component: "runner",
      createdAt: FIXED_NOW,
      errorCode: "runner_child_failed",
      eventCode: "runner.accepted_attempt_failed",
      id: "runtime_log_failure_1",
      leaseGeneration: null,
      level: "warn",
      mailboxLane: null,
      mailboxSeqEnd: null,
      mailboxSeqStart: null,
      outboxIntentRef: null,
      phase: "error",
      redactedJson: null,
      userId: "member_routes_1",
      workspaceVersion: "5",
    });
    mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId.mockResolvedValue(
      "runtime_log_failure_1",
    );

    const response = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            component: "runner",
            errorCode: "runner_child_failed",
            eventCode: "runner.accepted_attempt_failed",
            level: "warn",
            phase: "error",
            redactedJson: {
              safeErrorMessage: "Runner child process failed.",
            },
            workspaceVersion: "5",
          },
        ],
      },
    ));

    expect(response.status).toBe(200);
    expect(parseHostedRuntimeLogResponse(await response.json())).toEqual({
      loggedCount: 1,
    });
    expect(mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId).toHaveBeenCalledWith({
      since: expect.any(Date),
      userId: "member_routes_1",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
  });

  it("cooldowns accepted runtime attempt failure recheck signals behind the owner log", async () => {
    mocks.recordHostedRuntimeLog.mockResolvedValue({
      at: FIXED_NOW,
      attemptId: null,
      checkpointVersion: null,
      component: "runner",
      createdAt: FIXED_NOW,
      errorCode: "runner_child_failed",
      eventCode: "runner.accepted_attempt_failed",
      id: "runtime_log_failure_2",
      leaseGeneration: null,
      level: "warn",
      mailboxLane: null,
      mailboxSeqEnd: null,
      mailboxSeqStart: null,
      outboxIntentRef: null,
      phase: "error",
      redactedJson: null,
      userId: "member_routes_1",
      workspaceVersion: "5",
    });
    mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId.mockResolvedValue(
      "runtime_log_prior_failure",
    );

    const response = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [
          {
            at: FIXED_NOW,
            component: "runner",
            errorCode: "runner_child_failed",
            eventCode: "runner.accepted_attempt_failed",
            level: "warn",
            phase: "error",
            redactedJson: {
              safeErrorMessage: "Runner child process failed.",
            },
            workspaceVersion: "5",
          },
        ],
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("does not fail runtime log writes when the recheck signal is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.recordHostedRuntimeLog.mockResolvedValue({
      at: FIXED_NOW,
      attemptId: null,
      checkpointVersion: null,
      component: "runner",
      createdAt: FIXED_NOW,
      errorCode: "runner_child_failed",
      eventCode: "runner.accepted_attempt_failed",
      id: "runtime_log_failure_3",
      leaseGeneration: null,
      level: "warn",
      mailboxLane: null,
      mailboxSeqEnd: null,
      mailboxSeqStart: null,
      outboxIntentRef: null,
      phase: "error",
      redactedJson: null,
      userId: "member_routes_1",
      workspaceVersion: "5",
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    mocks.readAcceptedRuntimeAttemptFailureSignalOwnerLogId.mockResolvedValue(
      "runtime_log_failure_3",
    );

    try {
      const response = await runtimeLogRoute.POST(jsonRequest(
        "/api/internal/hosted-runtime/log",
        {
          entries: [
            {
              at: FIXED_NOW,
              component: "runner",
              errorCode: "runner_child_failed",
              eventCode: "runner.accepted_attempt_failed",
              level: "warn",
              phase: "error",
              redactedJson: {
                safeErrorMessage: "Runner child process failed.",
              },
              workspaceVersion: "5",
            },
          ],
        },
      ));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Hosted runtime recheck signal failed after accepted-attempt failure log.",
        expect.objectContaining({
          errorCode: "HOSTED_RUNTIME_RECHECK_SIGNAL_FAILED",
          errorMessage: "Temporal unavailable",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns redacted status from workspace state, mailbox high-water, and structured logs", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-04-26T00:10:00.000Z",
      redactedStatusJson: {
        conversationImportedSeq: "10",
        state: "idle",
        systemImportedSeq: "2",
      },
      version: "5",
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "12",
      },
      {
        lane: "system",
        maxSeq: "2",
      },
    ]);
    mocks.listHostedRuntimeLogs.mockResolvedValue([
      {
        at: FIXED_NOW,
        attemptId: "attempt_1",
        checkpointVersion: "5",
        component: "workspace",
        createdAt: FIXED_NOW,
        errorCode: null,
        eventCode: "checkpoint.committed",
        id: "runtime_log_2",
        leaseGeneration: "2",
        level: "info",
        mailboxLane: null,
        mailboxSeqEnd: null,
        mailboxSeqStart: null,
        outboxIntentRef: null,
        phase: "checkpoint",
        redactedJson: {
          checkpointReason: "canonical_runtime_commit",
        },
        userId: "member_routes_1",
        workspaceVersion: "5",
      },
    ]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=5",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.listHostedRuntimeLogs).toHaveBeenCalledWith({
      limit: 5,
      userId: "member_routes_1",
    });
    expect(payload).toMatchObject({
      mailboxLag: [
        {
          importedSeq: "10",
          lag: "2",
          lane: "conversation",
          maxSeq: "12",
        },
        {
          importedSeq: "2",
          lag: "0",
          lane: "system",
          maxSeq: "2",
        },
      ],
      workspace: {
        redactedStatus: {
          conversationImportedSeq: "10",
          state: "idle",
          systemImportedSeq: "2",
        },
        version: "5",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(UNSAFE_SENTINEL);
    expect(JSON.stringify(payload)).not.toMatch(/payloadCiphertext|message|email|phone|token/u);
  });

  it("rejects partial numeric hosted runtime status log limits", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: null,
      version: "0",
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);
    mocks.listHostedRuntimeLogs.mockResolvedValue([]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=10abc",
      { method: "GET" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.listHostedRuntimeLogs).toHaveBeenCalledWith({
      limit: 20,
      userId: "member_routes_1",
    });
  });

  it("does not treat foreground mailbox import logs as checkpointed progress", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: null,
      version: "0",
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "0",
      },
      {
        lane: "system",
        maxSeq: "2",
      },
    ]);
    mocks.listHostedRuntimeLogs.mockResolvedValue([]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.mailboxLag).toEqual([
      {
        importedSeq: "0",
        lag: "0",
        lane: "conversation",
        maxSeq: "0",
      },
      {
        importedSeq: "0",
        lag: "2",
        lane: "system",
        maxSeq: "2",
      },
    ]);
    expect(payload.workspace?.redactedStatus).toBeNull();
  });
});

function jsonRequest(
  path: string,
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request(`https://join.example.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}

function runtimeWriteFenceHeaders(): Record<string, string> {
  return {
    "x-hosted-runtime-attempt-id": "attempt_routes_1",
    "x-hosted-runtime-lease-generation": "9",
    "x-hosted-runtime-workspace-version": "4",
  };
}

function buildWorkspaceRecord(
  overrides: Partial<{
    browserVaultReplicaRef: Record<string, unknown> | null;
    checkpointedAt: string | null;
    createdAt: string;
    inboxMediaRetentionWakeAt: string | null;
    nextWakeAt: string | null;
    nextWakeReason: string | null;
    redactedStatusJson: Record<string, unknown> | null;
    snapshotRef: Record<string, unknown> | null;
    updatedAt: string;
    userId: string;
    version: string;
  }> = {},
) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: null,
    createdAt: FIXED_NOW,
    inboxMediaRetentionWakeAt: null,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: null,
    snapshotRef: createBundleRef("snapshot_1"),
    updatedAt: FIXED_NOW,
    userId: "member_routes_1",
    version: "4",
    ...overrides,
  };
}

function buildActiveHostedMemberRecord(overrides: Partial<{
  billingStatus: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: "active",
    createdAt: new Date(FIXED_NOW),
    id: "member_routes_1",
    suspendedAt: null,
    updatedAt: new Date(FIXED_NOW),
    ...overrides,
  };
}

function createPrismaClientStub() {
  return {
    hostedMember: {
      findUnique: mocks.hostedRuntimeMailboxMemberFindUnique,
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async (): Promise<unknown | null> => null),
    },
    kind: "prisma",
  };
}

function buildRuntimeMailboxAccessRecord(overrides: Partial<{
  id: string;
  accountGroupMemberships: Array<{
    group: { billingStatus: string; suspendedAt: Date | null };
    status: string;
  }>;
  billingStatus: string;
  suspendedAt: Date | null;
  threadContainer: {
    owner: {
      accountGroupMemberships: Array<{
        group: { billingStatus: string; suspendedAt: Date | null };
        status: string;
      }>;
      billingStatus: string;
      suspendedAt: Date | null;
    };
  } | null;
}> = {}) {
  return {
    id: "member_routes_1",
    accountGroupMemberships: [],
    billingStatus: "active",
    suspendedAt: null,
    threadContainer: null,
    ...overrides,
  };
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: FIXED_NOW,
  };
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "internal-route-test",
    generatedAt: FIXED_NOW,
    keyId: "browser-key-internal-route",
    objectKey: "browser-vault/member-routes/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:internal-route",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}
