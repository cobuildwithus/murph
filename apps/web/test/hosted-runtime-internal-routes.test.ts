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
  after: vi.fn<(task: () => Promise<void> | void) => void>(),
  checkpointHostedWorkspace: vi.fn(),
  fetchHostedMailboxItemsAfterLaneCursors: vi.fn(),
  fetchHostedMailboxPayload: vi.fn(),
  fetchHostedRuntimeMailboxProjection: vi.fn(),
  hostedRuntimeMailboxMemberFindUnique: vi.fn(),
  hostedThreadContainerParticipantFindFirst: vi.fn(),
  getPrisma: vi.fn(),
  isHostedRuntimeLogDatabaseConfigured: vi.fn(),
  listHostedRuntimeLogs: vi.fn(),
  publishLatestBrowserVaultReplicaRef: vi.fn(),
  claimHostedAcceptedAttemptFailureRecheck: vi.fn(),
  readHostedMailboxConsumedSeqByLane: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedActiveGroupRunningBit: vi.fn(),
  readHostedRuntimeOwnerReleaseMailboxLagActionable: vi.fn(),
  readHostedWorkspace: vi.fn(),
  recordHostedIngressAssistantInputStaged: vi.fn(),
  recordHostedIngressAssistantMilestone: vi.fn(),
  recordHostedIngressProviderStarted: vi.fn(),
  recordHostedIngressRuntimeMilestone: vi.fn(),
  tryMarkHostedMailboxConversationAiUsageDenied: vi.fn(),
  recordHostedRuntimeLogs: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-mailbox/store")>()),
  fetchHostedMailboxItemsAfterLaneCursors: mocks.fetchHostedMailboxItemsAfterLaneCursors,
  fetchHostedMailboxPayload: mocks.fetchHostedMailboxPayload,
  fetchHostedRuntimeMailboxProjection: mocks.fetchHostedRuntimeMailboxProjection,
  readHostedMailboxConsumedSeqByLane: mocks.readHostedMailboxConsumedSeqByLane,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
  tryMarkHostedMailboxConversationAiUsageDenied:
    mocks.tryMarkHostedMailboxConversationAiUsageDenied,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  isHostedVeniceAssistantEnabled: () =>
    process.env.HOSTED_VENICE_ENABLED === "1",
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-store", () => ({
  readHostedActiveGroupRunningBit: mocks.readHostedActiveGroupRunningBit,
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
  publishLatestBrowserVaultReplicaRef: mocks.publishLatestBrowserVaultReplicaRef,
  claimHostedAcceptedAttemptFailureRecheck:
    mocks.claimHostedAcceptedAttemptFailureRecheck,
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/hosted-runtime-log/write", () => ({
  writeHostedRuntimeLogs: mocks.recordHostedRuntimeLogs,
}));

vi.mock("@/src/lib/hosted-runtime-log/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-runtime-log/database")>()),
  isHostedRuntimeLogDatabaseConfigured:
    mocks.isHostedRuntimeLogDatabaseConfigured,
}));

vi.mock("@/src/lib/hosted-runtime-log/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-runtime-log/store")>()),
  listHostedRuntimeLogs: mocks.listHostedRuntimeLogs,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  recordHostedIngressAssistantInputStaged:
    mocks.recordHostedIngressAssistantInputStaged,
  recordHostedIngressAssistantMilestone:
    mocks.recordHostedIngressAssistantMilestone,
  recordHostedIngressProviderStarted: mocks.recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone: mocks.recordHostedIngressRuntimeMilestone,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-reconciliation-facts", () => ({
  readHostedRuntimeOwnerReleaseMailboxLagActionable:
    mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable,
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
type RuntimeOwnerReleasedRoute =
  typeof import("../app/api/internal/hosted-runtime/owner-released/route");
type RuntimeLatencyRoute = typeof import("../app/api/internal/hosted-runtime/latency/route");
type RuntimeStatusRoute = typeof import("../app/api/internal/hosted-runtime/status/route");

let mailboxFetchRoute: MailboxFetchRoute;
let mailboxPayloadFetchRoute: MailboxPayloadFetchRoute;
let workspaceRoute: WorkspaceRoute;
let workspaceCheckpointRoute: WorkspaceCheckpointRoute;
let browserVaultReplicaRoute: BrowserVaultReplicaRoute;
let runtimeLogRoute: RuntimeLogRoute;
let runtimeOwnerReleasedRoute: RuntimeOwnerReleasedRoute;
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
    runtimeOwnerReleasedRoute = await import(
      "../app/api/internal/hosted-runtime/owner-released/route"
    );
    runtimeLatencyRoute = await import("../app/api/internal/hosted-runtime/latency/route");
    runtimeStatusRoute = await import("../app/api/internal/hosted-runtime/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HOSTED_CUSTOM_CHAT_COMPLETIONS_ENABLED;
    delete process.env.HOSTED_CUSTOM_INFERENCE_ENABLED;
    delete process.env.HOSTED_VENICE_ENABLED;
    mocks.hostedRuntimeMailboxMemberFindUnique.mockResolvedValue(
      buildRuntimeMailboxAccessRecord(),
    );
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(createPrismaClientStub());
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_routes_1",
      }),
    );
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_routes_1");
    mocks.readHostedMailboxConsumedSeqByLane.mockImplementation((input: {
      lanes?: readonly string[];
    }) => Promise.resolve((input.lanes ?? ["conversation", "system"]).map((lane) => ({
      consumedSeq: "999",
      lane,
    }))));
    mocks.fetchHostedRuntimeMailboxProjection.mockImplementation(async (input: {
      cursorMode?: "imported_seq" | null;
      lanes: readonly { importedSeq: string; lane: "conversation" | "system" }[];
      limitPerLane: number;
      now: Date;
      userId: string;
    }) => {
      const requestedLanes = input.lanes.map((entry) => entry.lane);
      const consumedSeqByLane = await mocks.readHostedMailboxConsumedSeqByLane({
        lanes: requestedLanes,
        userId: input.userId,
      });
      const consumedEntries: Array<[string, bigint]> = consumedSeqByLane.map(
        (entry: { consumedSeq: string; lane: string }) => [
          entry.lane,
          BigInt(entry.consumedSeq),
        ],
      );
      const consumedByLane = new Map<string, bigint>(consumedEntries);
      const itemsResult = await mocks.fetchHostedMailboxItemsAfterLaneCursors({
        lanes: input.lanes.map((entry) => {
          const importedSeq = BigInt(entry.importedSeq);
          const consumedSeq = consumedByLane.get(entry.lane) ?? 0n;
          return {
            afterSeq: input.cursorMode === "imported_seq" || entry.lane !== "conversation"
              ? entry.importedSeq
              : (consumedSeq < importedSeq ? consumedSeq : importedSeq).toString(),
            lane: entry.lane,
          };
        }),
        limitPerLane: input.limitPerLane,
        now: input.now,
        userId: input.userId,
      });
      const maxSeqByLane = await mocks.readHostedMailboxMaxSeqByLane({
        lanes: requestedLanes,
        userId: input.userId,
      });
      return {
        consumedSeqByLane,
        items: itemsResult.items,
        maxSeqByLane,
      };
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.readHostedActiveGroupRunningBit.mockResolvedValue(null);
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveHostedMemberRecord());
    mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable.mockResolvedValue(true);
    mocks.claimHostedAcceptedAttemptFailureRecheck.mockResolvedValue(false);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "allowed",
    });
    mocks.tryMarkHostedMailboxConversationAiUsageDenied.mockResolvedValue(false);
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_routes_1",
    });
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    mocks.listHostedRuntimeLogs.mockResolvedValue([]);
  });

  it("signals a facts recheck after an authenticated runtime owner release", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/hosted-runtime/owner-released",
      { method: "POST" },
    );

    const response = await runtimeOwnerReleasedRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signaled: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 0 },
    );
    expect(mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
  });

  it("signals an authenticated explicit immediate recheck without a mailbox read", async () => {
    mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable.mockResolvedValue(false);
    const request = new Request(
      "https://join.example.test/api/internal/hosted-runtime/owner-released"
        + "?immediateRecheckRequested=1",
      { method: "POST" },
    );

    const response = await runtimeOwnerReleasedRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signaled: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 0 },
    );
    expect(mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
  });

  it("rejects noncanonical owner-release queries after authentication", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/hosted-runtime/owner-released"
        + "?immediateRecheckRequested=1&immediateRecheckRequested=1",
      { method: "POST" },
    );

    const response = await runtimeOwnerReleasedRoute.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 0 },
    );
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("preserves the owner horizon when no durable work is visible", async () => {
    mocks.readHostedRuntimeOwnerReleaseMailboxLagActionable.mockResolvedValue(false);

    const response = await runtimeOwnerReleasedRoute.POST(new Request(
      "https://join.example.test/api/internal/hosted-runtime/owner-released",
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signaled: false });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("surfaces runtime owner-release signal failures to Cloudflare", async () => {
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    const response = await runtimeOwnerReleasedRoute.POST(new Request(
      "https://join.example.test/api/internal/hosted-runtime/owner-released",
      { method: "POST" },
    ));

    expect(response.status).toBe(500);
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
    expect(mocks.fetchHostedRuntimeMailboxProjection).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHostedRuntimeMailboxProjection).toHaveBeenCalledWith({
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
      now: expect.any(Date),
      userId: "member_routes_1",
    });
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

  it("returns ordinary mailbox work when the optional sponsorship bit is unavailable", async () => {
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
      ],
    });
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "12",
      },
    ]);
    mocks.readHostedActiveGroupRunningBit.mockRejectedValueOnce(
      new Error("Optional sponsorship storage unavailable"),
    );

    const response = await mailboxFetchRoute.POST(jsonRequest(
      "/api/internal/hosted-mailbox/fetch",
      {
        cursorMode: "imported_seq",
        lanes: [
          {
            importedSeq: "11",
            lane: "conversation",
          },
        ],
        limitPerLane: 10,
        requestId: "request_mailbox_fetch_without_bit",
      },
    ));
    const payload = parseHostedMailboxFetchResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.groupRunningBit).toBeUndefined();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: "mailbox_item_1",
      lane: "conversation",
      laneSeq: "12",
    });
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
    expect(mocks.fetchHostedRuntimeMailboxProjection).not.toHaveBeenCalled();
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
    expect(mocks.fetchHostedRuntimeMailboxProjection).not.toHaveBeenCalled();
    expect(mocks.fetchHostedMailboxItemsAfterLaneCursors).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
  });

  it("projects low usage only with an allowed conversation mailbox batch", async () => {
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
          dedupeKey: "conversation-dedupe-low",
          expiresAt: null,
          id: "mailbox_item_low",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "12",
          occurredAt: FIXED_NOW,
          payloadBytes: 64,
          payloadInlineCiphertext: "cipher_inline_low",
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
      status: "allowed",
      usageRunningLow: true,
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
        requestId: "request_mailbox_fetch_usage_low",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conversationUsageStatus: "low",
      items: [expect.objectContaining({ id: "mailbox_item_low" })],
    });
    expect(
      mocks.tryMarkHostedMailboxConversationAiUsageDenied,
    ).not.toHaveBeenCalled();
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
    expect(
      mocks.tryMarkHostedMailboxConversationAiUsageDenied,
    ).toHaveBeenCalledWith({
      afterConversationLaneSeq: 11n,
      prisma: expect.objectContaining({ kind: "prisma" }),
      throughConversationLaneSeq: 12n,
      userId: "member_routes_1",
    });
  });

  it("does not AI-gate manual runtime-control mailbox imports", async () => {
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

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
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

  it("does not AI-gate manual runtime-control mailbox payload imports", async () => {
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_manual_2",
      kind: "runtime.manual-requested",
      lane: "system",
      laneSeq: "12",
      userId: "member_routes_1",
    });
    mocks.fetchHostedMailboxPayload.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      payload: {
        createdAt: FIXED_NOW,
        mailboxItemId: "mailbox_manual_2",
        payloadCiphertext: "cipher_ref_manual",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: "member_routes_1",
      },
      unavailable: null,
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

    expect(response.status).toBe(200);
    expect(mocks.readHostedMailboxConsumedSeqByLane).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.fetchHostedMailboxPayload).toHaveBeenCalled();
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

  it("omits a stored Venice override while the rollout gate is disabled", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({ version: "4" }));
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValueOnce({
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      solAvailable: false,
    });

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace",
      { method: "GET" },
    ));
    const payload = parseHostedWorkspaceReadResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.hostedAssistantProviderOverride).toBeUndefined();
  });

  it("projects the current platform usage decision for a managed route", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(
      buildWorkspaceRecord({ version: "4" }),
    );
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace",
    ));
    const payload = parseHostedWorkspaceReadResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.platformAiUsageAllowed).toBe(false);
    expect(payload.hostedAssistantCustomInferenceOverride).toBeUndefined();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_only",
      prisma: expect.any(Object),
      userId: "member_routes_1",
    });
  });

  it("projects a selected custom route without managed inference facts", async () => {
    process.env.HOSTED_CUSTOM_INFERENCE_ENABLED = "1";
    mocks.readHostedWorkspace.mockResolvedValue(
      buildWorkspaceRecord({ version: "4" }),
    );
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValueOnce({
      customInferenceReverificationRequired: false,
      customInferenceSelected: true,
      hostedAssistantCustomInferenceOverride: {
        contextWindowTokens: 131_072,
        modelAlias: "murph-custom-r3",
        protocol: "responses",
        revision: 3,
        supportsImages: false,
        verificationProfile:
          "murph-codex-0.147.0-portable-responses-v1",
      },
      hostedAssistantModelOverride: "gpt-5.6-sol",
      hostedAssistantProviderOverride: "venice",
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      solAvailable: true,
    });
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace"
        + "?customInferenceVersion=1",
    ));
    const payload = parseHostedWorkspaceReadResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      hostedAssistantCustomInferenceOverride: {
        modelAlias: "murph-custom-r3",
        protocol: "responses",
        revision: 3,
      },
      platformAiUsageAllowed: false,
    });
    expect(payload.hostedAssistantModelOverride).toBeUndefined();
    expect(payload.hostedAssistantProviderOverride).toBeUndefined();
    expect(payload.hostedAssistantReasoningEffortOverride).toBeUndefined();
  });

  it("fails closed when the runtime cannot consume a selected custom route", async () => {
    process.env.HOSTED_CUSTOM_INFERENCE_ENABLED = "1";
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValueOnce({
      customInferenceReverificationRequired: false,
      customInferenceSelected: true,
      hostedAssistantCustomInferenceOverride: {
        contextWindowTokens: 131_072,
        modelAlias: "murph-custom-r3",
        protocol: "responses",
        revision: 3,
        supportsImages: false,
        verificationProfile:
          "murph-codex-0.147.0-portable-responses-v1",
      },
      model: "gpt-5.6-terra",
      solAvailable: false,
    });

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CUSTOM_INFERENCE_CONSUMER_UNSUPPORTED",
      },
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("fails closed when a selected Chat route is not enabled", async () => {
    process.env.HOSTED_CUSTOM_INFERENCE_ENABLED = "1";
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValueOnce({
      customInferenceReverificationRequired: false,
      customInferenceSelected: true,
      hostedAssistantCustomInferenceOverride: {
        contextWindowTokens: 131_072,
        modelAlias: "murph-custom-r3",
        protocol: "chat_completions",
        revision: 3,
        supportsImages: false,
        verificationProfile:
          "murph-codex-0.147.0-portable-responses-v1",
      },
      model: "gpt-5.6-terra",
      solAvailable: false,
    });

    const response = await workspaceRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace"
        + "?customInferenceVersion=1",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CUSTOM_CHAT_COMPLETIONS_UNAVAILABLE",
      },
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("reads workspace state and checkpoints with the workspace CAS fence", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({ version: "4" }));
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValueOnce({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      hostedAssistantProviderOverride: "venice",
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      solAvailable: true,
    });
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
    expect(parseHostedWorkspaceReadResponse(await readResponse.json()))
      .toMatchObject({
        hostedAssistantModelOverride: "gpt-5.6-sol",
        hostedAssistantProviderOverride: "venice",
        hostedAssistantReasoningEffortOverride: "high",
        workspace: {
        userId: "member_routes_1",
        version: "4",
        },
      });
    expect(mocks.readHostedMemberAssistantModelPreference).toHaveBeenCalledWith({
      memberId: "member_routes_1",
      prisma: expect.any(Object),
    });

    const checkpointResponse = await workspaceCheckpointRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/checkpoint",
      {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        handledConversationMailboxItemIds: ["item_terminal_12"],
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
      handledConversationMailboxItemIds: ["item_terminal_12"],
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

  it("returns an ahead-input observation while committing an idle shutdown checkpoint", async () => {
    mocks.checkpointHostedWorkspace.mockResolvedValue({
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      status: "updated",
      workspace: buildWorkspaceRecord({
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
        version: "5",
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
      checkpointed: true,
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      workspace: {
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
        version: "5",
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
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      status: "updated",
      workspace: buildWorkspaceRecord({
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
        version: "5",
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
      checkpointed: true,
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      workspace: {
        snapshotRef: createBundleRef("snapshot_idle_shutdown"),
        version: "5",
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
      expect(mocks.after).toHaveBeenCalledTimes(1);
      await mocks.after.mock.calls[0]?.[0]();
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
        userId: "member_routes_1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a due workspace checkpoint before running its recheck signal", async () => {
    const nextWakeAt = "2026-04-25T23:59:00.000Z";
    let resolveSignal!: () => void;
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveSignal = resolve;
        }),
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
        attemptId: "attempt_due_wake_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "2",
        nextWakeAt,
        nextWakeReason: "assistant",
        reason: "idle_shutdown",
        snapshotRef: createBundleRef("snapshot_due_wake"),
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
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();

    const signalTask = mocks.after.mock.calls[0]?.[0]();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
    resolveSignal();
    await signalTask;
  });

  it("does not fail checkpointing when the wake recheck signal is unavailable", async () => {
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
      expect(mocks.after).toHaveBeenCalledTimes(1);
      await mocks.after.mock.calls[0]?.[0]();
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

  it.each(["P1001", "P2022"] as const)(
    "serves workspace reads for inactive members when the selective assistant configuration read fails with %s",
    async (preferenceReadErrorCodeDetail) => {
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
      mocks.readHostedMemberAssistantModelPreference.mockRejectedValueOnce(
        Object.assign(
          new Error("optional model preference read unavailable"),
          {
            code: preferenceReadErrorCodeDetail,
            status: 503,
          },
        ),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
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
        expect(payload.hostedAssistantModelOverride).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
          "Hosted workspace assistant configuration read failed; using fleet defaults.",
          {
            errorCode: "HOSTED_WORKSPACE_ASSISTANT_CONFIGURATION_READ_FAILED",
            fallback: "fleet_default",
            preferenceReadErrorCode: "runtime_error",
            preferenceReadErrorCodeDetail,
            preferenceReadErrorDetail: "optional model preference read unavailable",
            preferenceReadErrorMessage: "Hosted execution runtime failed.",
            preferenceReadErrorName: "Error",
            preferenceReadErrorStatus: 503,
            operation: "read_hosted_member_assistant_configuration",
          },
        );
        // The route avoids the unrelated core-state admission read. Model
        // entitlement is isolated behind the optional preference owner above.
        expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    },
  );

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
  });

  it("rejects the retired source-hash browser-vault publish field", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");

    const response = await browserVaultReplicaRoute.POST(jsonRequest(
      "/api/internal/hosted-workspace/browser-vault-replica",
      {
        expectedSourceStateHash: "snapshot_2_hash",
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

  it("writes the maximum runtime log batch with a single database call", async () => {
    // The callback accepts 50 entries and the pool defaults to 15 clients, so
    // one Prisma call per entry would make the pool the request's concurrency
    // limiter. One callback must cost one statement.
    mocks.recordHostedRuntimeLogs.mockResolvedValue(50);

    const entries = Array.from({ length: 50 }, (_, index) => ({
      at: FIXED_NOW,
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "info",
      mailboxSeqStart: String(index),
      phase: "import",
    }));

    const response = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      { entries },
    ));

    expect(response.status).toBe(200);
    expect(parseHostedRuntimeLogResponse(await response.json())).toEqual({
      loggedCount: 50,
    });
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledOnce();
    expect(mocks.recordHostedRuntimeLogs.mock.calls[0]?.[0]?.entries).toHaveLength(50);
  });

  it("reports zero persisted logs when deletion wins the diagnostic race", async () => {
    mocks.recordHostedRuntimeLogs.mockResolvedValue(0);

    const response = await runtimeLogRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/log",
      {
        entries: [{
          at: FIXED_NOW,
          component: "mailbox",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
        }],
      },
    ));

    expect(response.status).toBe(200);
    expect(parseHostedRuntimeLogResponse(await response.json())).toEqual({
      loggedCount: 0,
    });
  });

  it("records bounded runtime logs and rejects forbidden log payload fields", async () => {
    mocks.recordHostedRuntimeLogs.mockResolvedValue(1);

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
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledWith(expect.objectContaining({
      entries: [expect.objectContaining({
        redactedJson: {
          count: 1,
          lane: "conversation",
          safeErrorMessage: "Codex app-server failed before producing a reply.",
        },
      })],
      userId: "member_routes_1",
    }));
    expect(mocks.claimHostedAcceptedAttemptFailureRecheck).not.toHaveBeenCalled();
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
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledTimes(1);

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
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledTimes(1);
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
    mocks.recordHostedIngressAssistantMilestone.mockResolvedValue({
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

    const assistantMilestoneResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputIds: ["input_1", "input_2"],
          at: FIXED_NOW,
          milestone: "first_codex_output_observed",
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          type: "assistant_milestone",
        },
      },
      runtimeWriteFenceHeaders(),
    ));

    expect(assistantMilestoneResponse.status).toBe(200);
    expect(parseHostedRuntimeLatencyTraceResponse(
      await assistantMilestoneResponse.json(),
    )).toEqual({
      matchedCount: 2,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(mocks.recordHostedIngressAssistantMilestone).toHaveBeenCalledWith({
      assistantInputIds: ["input_1", "input_2"],
      at: FIXED_NOW,
      authenticatedUserId: "member_routes_1",
      milestone: "first_codex_output_observed",
      runtimeAttemptId: "attempt_routes_1",
      runtimeLeaseGeneration: "9",
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
      runtimeLeaseGeneration: "9",
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

    const incompleteFenceResponse = await runtimeLatencyRoute.POST(jsonRequest(
      "/api/internal/hosted-runtime/latency",
      {
        event: {
          assistantInputIds: ["input_1"],
          at: FIXED_NOW,
          milestone: "first_codex_output_observed",
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          type: "assistant_milestone",
        },
      },
      {
        "x-hosted-runtime-attempt-id": "attempt_routes_1",
      },
    ));

    expect(incompleteFenceResponse.status).toBe(401);

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
    expect(mocks.recordHostedIngressAssistantMilestone).toHaveBeenCalledTimes(1);
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

  it("warns only for latency rows a trace row rejected, never for untraced inputs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.recordHostedIngressProviderStarted.mockResolvedValue({
        matchedCount: 0,
        recorded: false,
        unmatchedCount: 1,
        untracedCount: 1,
      });
      const untracedResponse = await runtimeLatencyRoute.POST(jsonRequest(
        "/api/internal/hosted-runtime/latency",
        {
          event: {
            assistantInputIds: ["input_untraced_1"],
            at: FIXED_NOW,
            providerRequestOrdinal: 0,
            runtimeAttemptId: "attempt_routes_1",
            source: "linq",
            type: "provider_started",
          },
        },
        runtimeWriteFenceHeaders(),
      ));

      expect(untracedResponse.status).toBe(200);
      // Assert the raw body, not the parsed projection: the parser drops
      // unknown keys, so reparsing here would still pass if the route leaked
      // untracedCount to the runner. The wire contract must stay exactly these
      // three fields so the runner's existing retry, which covers a staged
      // callback still in flight, keeps working.
      expect(await untracedResponse.json()).toEqual({
        matchedCount: 0,
        recorded: false,
        unmatchedCount: 1,
      });
      expect(warn).not.toHaveBeenCalled();

      mocks.recordHostedIngressProviderStarted.mockResolvedValue({
        matchedCount: 1,
        recorded: true,
        unmatchedCount: 2,
        untracedCount: 1,
      });
      const rejectedResponse = await runtimeLatencyRoute.POST(jsonRequest(
        "/api/internal/hosted-runtime/latency",
        {
          event: {
            assistantInputIds: ["input_traced_1", "input_rejected_1", "input_untraced_1"],
            at: FIXED_NOW,
            providerRequestOrdinal: 0,
            runtimeAttemptId: "attempt_routes_1",
            source: "linq",
            type: "provider_started",
          },
        },
        runtimeWriteFenceHeaders(),
      ));

      expect(rejectedResponse.status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted runtime latency trace callback had rejected rows.",
        {
          eventType: "provider_started",
          matchedCount: 1,
          rejectedCount: 1,
          runtimeAttemptId: "attempt_routes_1",
          source: "linq",
          untracedCount: 1,
        },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("signals a stateless runtime recheck after an accepted runtime attempt failure log", async () => {
    mocks.recordHostedRuntimeLogs.mockResolvedValue(1);
    mocks.claimHostedAcceptedAttemptFailureRecheck.mockResolvedValue(true);

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
    // Recovery ownership is a workspace claim, not an election among the log
    // rows this request happened to insert.
    expect(mocks.claimHostedAcceptedAttemptFailureRecheck).toHaveBeenCalledWith({
      cooldownMs: 30_000,
      userId: "member_routes_1",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      userId: "member_routes_1",
    });
  });

  it("still claims and signals when the diagnostic batch write fails", async () => {
    // Recovery must not be gated on the diagnostic insert: the runner's log
    // writer is best effort and never retries a failed callback.
    mocks.recordHostedRuntimeLogs.mockRejectedValue(
      new Error("Synthetic runtime log insert failure."),
    );
    mocks.claimHostedAcceptedAttemptFailureRecheck.mockResolvedValue(true);

    await expect(runtimeLogRoute.POST(jsonRequest(
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
    ))).resolves.toBeDefined();

    expect(mocks.claimHostedAcceptedAttemptFailureRecheck).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(1);
    expect(
      mocks.signalHostedRuntimeRecheckRuntime.mock.invocationCallOrder[0]!,
    ).toBeLessThan(mocks.recordHostedRuntimeLogs.mock.invocationCallOrder[0]!);
  });

  it("cooldowns accepted runtime attempt failure recheck signals behind the workspace claim", async () => {
    mocks.recordHostedRuntimeLogs.mockResolvedValue(1);
    mocks.claimHostedAcceptedAttemptFailureRecheck.mockResolvedValue(false);

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
    // The diagnostics still persist; only the recovery signal is suppressed.
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledTimes(1);
  });

  it("does not fail runtime log writes when the recheck signal is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.recordHostedRuntimeLogs.mockResolvedValue(1);
    mocks.claimHostedAcceptedAttemptFailureRecheck.mockResolvedValue(true);
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
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

  it("reads runtime-log windows from the dedicated store", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);
    mocks.listHostedRuntimeLogs.mockResolvedValue([
      buildRuntimeLogRecord({
        at: "2026-04-26T00:00:01.000Z",
        id: "runtime_log_isolated",
      }),
    ]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=2",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recentLogs?.map((entry) => entry.at)).toEqual([
      "2026-04-26T00:00:01.000Z",
    ]);
    expect(mocks.listHostedRuntimeLogs).toHaveBeenCalledWith({
      limit: 2,
      userId: "member_routes_1",
    });
  });

  it("marks the runtime-log window unavailable when isolated reads fail", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);
    mocks.listHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=1",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recentLogs).toBeUndefined();
    expect(mocks.listHostedRuntimeLogs).toHaveBeenCalledWith({
      limit: 1,
      userId: "member_routes_1",
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime status isolated-log read failed.",
      expect.objectContaining({
        errorCode: "HOSTED_RUNTIME_STATUS_LOG_READ_FAILED",
      }),
    );
    consoleWarn.mockRestore();
  });

  it("returns an empty runtime-log window after the dedicated read succeeds", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);
    mocks.listHostedRuntimeLogs.mockResolvedValue([]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=1",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recentLogs).toEqual([]);
    expect(mocks.listHostedRuntimeLogs).toHaveBeenCalledOnce();
  });

  it("returns no logs without reading when the dedicated database is unconfigured", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(false);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=1",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recentLogs).toEqual([]);
    expect(mocks.listHostedRuntimeLogs).not.toHaveBeenCalled();
  });

  it("skips the runtime-log database when status requests no diagnostics", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([]);

    const response = await runtimeStatusRoute.GET(new Request(
      "https://join.example.test/api/internal/hosted-runtime/status?logLimit=0",
      { method: "GET" },
    ));
    const payload = parseHostedRuntimeWebStatusResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recentLogs).toEqual([]);
    expect(mocks.listHostedRuntimeLogs).not.toHaveBeenCalled();
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

function buildRuntimeLogRecord(
  overrides: Partial<{
    at: string;
    id: string;
  }> = {},
) {
  return {
    at: FIXED_NOW,
    attemptId: "attempt_1",
    checkpointVersion: "5",
    component: "workspace" as const,
    createdAt: FIXED_NOW,
    errorCode: null,
    eventCode: "checkpoint.committed" as const,
    id: "runtime_log_1",
    leaseGeneration: "2",
    level: "info" as const,
    mailboxLane: null,
    mailboxSeqEnd: null,
    mailboxSeqStart: null,
    outboxIntentRef: null,
    phase: "checkpoint" as const,
    redactedJson: null,
    userId: "member_routes_1",
    workspaceVersion: "5",
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
    hostedThreadContainerParticipant: {
      findFirst: mocks.hostedThreadContainerParticipantFindFirst,
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
