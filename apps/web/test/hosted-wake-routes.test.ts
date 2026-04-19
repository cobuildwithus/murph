import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionAssistantCronTickWake,
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedExecutionWakePayloadTx: vi.fn(),
  commitHostedExecutionCursorTx: vi.fn(),
  countPendingHostedWakes: vi.fn(),
  getPrisma: vi.fn(),
  listHostedWakeRepairCandidates: vi.fn(),
  listHostedWakesAfterSeq: vi.fn(),
  materializeHostedDueWakesTx: vi.fn(),
  recordHostedWakeTerminalTx: vi.fn(),
  readHostedWakeLifecycle: vi.fn(),
  readHostedExecutionCursor: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  triggerHostedWakeUserBestEffort: vi.fn(),
  quarantineHostedWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/http")>(
    "@/src/lib/http",
  );

  return {
    ...actual,
    readOptionalJsonObject: mocks.readOptionalJsonObject,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-wake/lifecycle", () => ({
  readHostedWakeLifecycle:
    mocks.readHostedWakeLifecycle,
}));

vi.mock("@/src/lib/hosted-wake/control", () => ({
  triggerHostedWakeUserBestEffort: mocks.triggerHostedWakeUserBestEffort,
}));

vi.mock("@/src/lib/hosted-wake/materialize", () => ({
  materializeHostedDueWakesTx: mocks.materializeHostedDueWakesTx,
}));

vi.mock("@/src/lib/hosted-wake/queue", () => ({
  appendHostedExecutionWakePayloadTx: mocks.appendHostedExecutionWakePayloadTx,
}));

vi.mock("@/src/lib/hosted-wake/store", () => ({
  commitHostedExecutionCursorTx: mocks.commitHostedExecutionCursorTx,
  countPendingHostedWakes: mocks.countPendingHostedWakes,
  listHostedWakeRepairCandidates: mocks.listHostedWakeRepairCandidates,
  listHostedWakesAfterSeq: mocks.listHostedWakesAfterSeq,
  quarantineHostedWakeTx: mocks.quarantineHostedWakeTx,
  recordHostedWakeTerminalTx: mocks.recordHostedWakeTerminalTx,
  readHostedExecutionCursor: mocks.readHostedExecutionCursor,
}));

describe("hosted wake internal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.triggerHostedWakeUserBestEffort.mockResolvedValue(true);
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (callback: (tx: { label: string }) => Promise<unknown>) =>
        callback({ label: "wake-route-tx" })),
    });
    mocks.appendHostedExecutionWakePayloadTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "evt_tick",
        id: "wake_24",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadBytes: 128,
        payloadCiphertext: "ciphertext_inline_123",
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "24",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
      },
    });
    mocks.materializeHostedDueWakesTx.mockResolvedValue({
      targetSeqHint: "24",
      wakeMaterializationHints: {
        deviceSyncWakeAt: "2026-04-17T01:00:00.000Z",
      },
    });
    mocks.listHostedWakesAfterSeq.mockResolvedValue({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      wakes: [
        {
          behavior: "ordered",
          fetchProof: "proof_24",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "evt_tick",
          id: "wake_24",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 128,
          payloadCiphertext: "ciphertext_inline_123",
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          quarantineCode: null,
          quarantinedAt: null,
          seq: "24",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member_123",
        },
      ],
    });
    mocks.readHostedExecutionCursor.mockResolvedValue({
      committedSeq: "24",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "26",
      snapshotRef: null,
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member_123",
      version: "3",
    });
    mocks.countPendingHostedWakes.mockResolvedValue(1);
    mocks.readHostedWakeLifecycle.mockResolvedValue({
      eventId: "evt_tick",
      state: "queued",
    });
    mocks.commitHostedExecutionCursorTx.mockResolvedValue({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: { checkpoint: "wake_24" },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });
    mocks.recordHostedWakeTerminalTx.mockResolvedValue(true);
    mocks.quarantineHostedWakeTx.mockResolvedValue(true);
    mocks.listHostedWakeRepairCandidates.mockResolvedValue([
      {
        committedSeq: "24",
        nextSeq: "26",
        pendingWakeCount: 1,
        targetSeqHint: "25",
        userId: "member_123",
      },
    ]);
  });

  it("parses and forwards wake append requests", async () => {
    const wake = buildHostedExecutionAssistantCronTickWake({
      eventId: "evt_tick",
      occurredAt: "2026-04-17T00:00:00.000Z",
      reason: "manual",
      userId: "member_123",
    });
    mocks.readOptionalJsonObject.mockResolvedValue({
      wake,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/append/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: expect.objectContaining({
        id: "wake_24",
        seq: "24",
      }),
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).toHaveBeenCalledWith({
      wake,
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
    });
  });

  it("rejects wake append requests whose wake userId does not match the bound user", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      wake: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_tick",
        occurredAt: "2026-04-17T00:00:00.000Z",
        reason: "manual",
        userId: "member_other",
      }),
    });

    const { POST } = await import("../app/api/internal/hosted-wake/append/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).not.toHaveBeenCalled();
  });

  it("parses and forwards unseen wake fetch requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      afterSeq: "12",
      limit: 128,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/unseen/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      wakes: [
        {
          behavior: "ordered",
          fetchProof: "proof_24",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "evt_tick",
          id: "wake_24",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 128,
          payloadCiphertext: "ciphertext_inline_123",
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          quarantineCode: null,
          quarantinedAt: null,
          seq: "24",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member_123",
        },
      ],
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.listHostedWakesAfterSeq).toHaveBeenCalledWith({
      afterSeq: 12n,
      limit: 128,
      prisma: expect.anything(),
      userId: "member_123",
    });
  });

  it("parses and forwards wake cursor commit requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: {
        checkpoint: "wake_24",
      },
    });

    const { POST } = await import("../app/api/internal/hosted-wake/commit/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: {
          checkpoint: "wake_24",
        },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.commitHostedExecutionCursorTx).toHaveBeenCalledWith({
      committedSeq: 24n,
      expectedVersion: 3n,
      snapshotRef: {
        checkpoint: "wake_24",
      },
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });
  });

  it("parses and forwards hosted wake terminal receipt requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      state: "completed",
      wakeId: "wake_24",
      wakeSeq: "24",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/terminal/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: true,
    });
    expect(mocks.recordHostedWakeTerminalTx).toHaveBeenCalledWith({
      fetchProof: "proof_24",
      state: "completed",
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
      wakeId: "wake_24",
      wakeSeq: 24n,
    });
  });

  it("parses and forwards wake cursor commit requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: {
        checkpoint: "wake_24_final",
      },
    });
    mocks.commitHostedExecutionCursorTx.mockResolvedValueOnce({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: {
          checkpoint: "wake_24_final",
        },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });

    const { POST } = await import("../app/api/internal/hosted-wake/commit/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: {
          checkpoint: "wake_24_final",
        },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.commitHostedExecutionCursorTx).toHaveBeenCalledWith({
      committedSeq: 24n,
      expectedVersion: 3n,
      snapshotRef: {
        checkpoint: "wake_24_final",
      },
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });
  });

  it("parses and forwards hosted wake materialization requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T00:00:00.000Z",
        deviceSyncWakeAt: "2026-04-17T01:00:00.000Z",
      },
    });

    const { POST } = await import("../app/api/internal/hosted-wake/materialize/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      targetSeqHint: "24",
      wakeMaterializationHints: {
        deviceSyncWakeAt: "2026-04-17T01:00:00.000Z",
      },
    });
    expect(mocks.materializeHostedDueWakesTx).toHaveBeenCalledWith({
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T00:00:00.000Z",
        deviceSyncWakeAt: "2026-04-17T01:00:00.000Z",
      },
    });
  });

  it("parses and forwards wake quarantine requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      quarantineCode: "invalid-dispatch-payload",
      wakeId: "wake_24",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/quarantine/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      quarantined: true,
    });
    expect(mocks.quarantineHostedWakeTx).toHaveBeenCalledWith({
      quarantineCode: "invalid-dispatch-payload",
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
      wakeId: "wake_24",
    });
  });

  it("reads hosted wake status from the canonical cursor and optional wake lifecycle", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_tick",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/status/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      wakeState: "queued",
      pendingWakeCount: 1,
    });
    expect(mocks.readHostedExecutionCursor).toHaveBeenCalledWith({
      prisma: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.readHostedWakeLifecycle).toHaveBeenCalledWith({
      eventId: "evt_tick",
      prisma: expect.anything(),
      userId: "member_123",
    });
  });

  it("omits wakeState when the canonical wake row is absent", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_missing",
    });
    mocks.readHostedWakeLifecycle.mockResolvedValue(null);

    const { POST } = await import("../app/api/internal/hosted-wake/status/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      pendingWakeCount: 1,
    });
  });

  it("returns replacement metadata when a coalesced event has been superseded", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_old",
    });
    mocks.readHostedWakeLifecycle.mockResolvedValue({
      eventId: "evt_old",
      replacedByEventId: "evt_new",
      state: "replaced",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/status/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      pendingWakeCount: 1,
      replacedByEventId: "evt_new",
      wakeState: "replaced",
    });
  });

  it("repairs stale wake cursors through the hosted wake control client", async () => {
    const { GET } = await import("../app/api/internal/hosted-wake/repair/route");
    const response = await GET(new Request("https://example.test", { method: "GET" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      examined: 1,
      nudged: 1,
      staleAfterMs: 60_000,
    });
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledOnce();
    expect(mocks.listHostedWakeRepairCandidates).toHaveBeenCalledWith({
      limit: 128,
      olderThan: expect.any(Date),
    });
    expect(mocks.triggerHostedWakeUserBestEffort).toHaveBeenCalledWith({
      context: "hosted-wake.repair",
      targetSeqHint: "25",
      userId: "member_123",
    });
  });
});
