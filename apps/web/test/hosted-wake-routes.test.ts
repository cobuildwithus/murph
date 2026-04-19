import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/contracts";

const TEST_SNAPSHOT_REF = {
  hash: "hash_24",
  key: "bundles/vault/hash_24",
  size: 24,
  updatedAt: "2026-04-17T00:00:00.000Z",
} as const;

const mocks = vi.hoisted(() => ({
  HostedWakeFetchProofStaleError: class HostedWakeFetchProofStaleError extends TypeError {},
  appendHostedExecutionWakePayloadTx: vi.fn(),
  commitHostedExecutionCursorTx: vi.fn(),
  countPendingHostedWakes: vi.fn(),
  finalizeHostedExecutionCursorTx: vi.fn(),
  getPrisma: vi.fn(),
  listHostedExecutableWakes: vi.fn(),
  listHostedWakeRepairCandidates: vi.fn(),
  materializeHostedAssistantCronWakeTx: vi.fn(),
  materializeHostedDueWakesTx: vi.fn(),
  recordHostedWakeTerminalTx: vi.fn(),
  readHostedWakeLifecycle: vi.fn(),
  readHostedExecutionCursor: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  nudgeHostedWakeUserBestEffort: vi.fn(),
  quarantineHostedWakeTx: vi.fn(),
  validateHostedWakeFetchProofCurrent: vi.fn(),
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
  nudgeHostedWakeUserBestEffort: mocks.nudgeHostedWakeUserBestEffort,
}));

vi.mock("@/src/lib/hosted-wake/materialize", () => ({
  materializeHostedDueWakesTx: mocks.materializeHostedDueWakesTx,
}));

vi.mock("@/src/lib/hosted-wake/queue", () => ({
  appendHostedExecutionWakePayloadTx: mocks.appendHostedExecutionWakePayloadTx,
  materializeHostedAssistantCronWakeTx: mocks.materializeHostedAssistantCronWakeTx,
}));

vi.mock("@/src/lib/hosted-wake/store", () => ({
  HostedWakeFetchProofStaleError: mocks.HostedWakeFetchProofStaleError,
  commitHostedExecutionCursorTx: mocks.commitHostedExecutionCursorTx,
  countPendingHostedWakes: mocks.countPendingHostedWakes,
  finalizeHostedExecutionCursorTx: mocks.finalizeHostedExecutionCursorTx,
  listHostedExecutableWakes: mocks.listHostedExecutableWakes,
  listHostedWakeRepairCandidates: mocks.listHostedWakeRepairCandidates,
  quarantineHostedWakeTx: mocks.quarantineHostedWakeTx,
  recordHostedWakeTerminalTx: mocks.recordHostedWakeTerminalTx,
  readHostedExecutionCursor: mocks.readHostedExecutionCursor,
  validateHostedWakeFetchProofCurrent: mocks.validateHostedWakeFetchProofCurrent,
}));

describe("hosted wake internal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.nudgeHostedWakeUserBestEffort.mockResolvedValue(true);
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
    mocks.listHostedExecutableWakes.mockResolvedValue({
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
    mocks.validateHostedWakeFetchProofCurrent.mockResolvedValue({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      fetchProofCurrent: true,
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
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
      finalizeToken: "finalize_token_24",
    });
    mocks.finalizeHostedExecutionCursorTx.mockResolvedValue({
      finalized: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member_123",
        version: "5",
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

  it("parses and forwards unseen wake fetch requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
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
    expect(mocks.listHostedExecutableWakes).toHaveBeenCalledWith({
      limit: 128,
      prisma: expect.anything(),
      userId: "member_123",
    });
  });

  it("rejects caller-supplied afterSeq on executable unseen wake fetch requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      afterSeq: "1",
      limit: 128,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/unseen/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.listHostedExecutableWakes).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied afterSeq even when present as null on executable unseen wake fetch requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      afterSeq: null,
      limit: 128,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/unseen/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.listHostedExecutableWakes).not.toHaveBeenCalled();
  });

  it("parses and forwards wake cursor commit requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      assistantNextWakeAt: "2026-04-17T02:00:00.000Z",
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: TEST_SNAPSHOT_REF,
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
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
      finalizeToken: "finalize_token_24",
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.commitHostedExecutionCursorTx).toHaveBeenCalledWith({
      assistantNextWakeAt: "2026-04-17T02:00:00.000Z",
      committedSeq: 24n,
      expectedVersion: 3n,
      snapshotRef: TEST_SNAPSHOT_REF,
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });
  });

  it("parses and forwards wake cursor finalize requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      assistantNextWakeAt: "2026-04-17T03:00:00.000Z",
      finalizeToken: "finalize_token_24",
      snapshotRef: TEST_SNAPSHOT_REF,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/finalize/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      finalized: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member_123",
        version: "5",
      },
    });
    expect(mocks.finalizeHostedExecutionCursorTx).toHaveBeenCalledWith({
      assistantNextWakeAt: "2026-04-17T03:00:00.000Z",
      finalizeToken: "finalize_token_24",
      snapshotRef: TEST_SNAPSHOT_REF,
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

  it("accepts quarantined hosted wake terminal receipt requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      state: "quarantined",
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
      state: "quarantined",
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
      wakeId: "wake_24",
      wakeSeq: 24n,
    });
  });

  it("maps stale hosted wake terminal fetch fences to a specific conflict response", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      state: "completed",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
    mocks.recordHostedWakeTerminalTx.mockRejectedValue(new mocks.HostedWakeFetchProofStaleError(
      "Hosted wake fetch proof is stale for the current cursor.",
    ));

    const { HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE } = await import(
      "@murphai/hosted-execution/contracts"
    );

    const { POST } = await import("../app/api/internal/hosted-wake/terminal/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE,
        message: "Hosted wake fetch proof is stale.",
      },
    });
  });

  it("rejects replaced hosted wake terminal receipt requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      state: "replaced",
      wakeId: "wake_24",
      wakeSeq: "24",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/terminal/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.recordHostedWakeTerminalTx).not.toHaveBeenCalled();
  });

  it("parses and forwards wake cursor commit requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: TEST_SNAPSHOT_REF,
    });
    mocks.commitHostedExecutionCursorTx.mockResolvedValueOnce({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
      finalizeToken: "finalize_token_24",
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
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
      finalizeToken: "finalize_token_24",
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.commitHostedExecutionCursorTx).toHaveBeenCalledWith({
      committedSeq: 24n,
      expectedVersion: 3n,
      snapshotRef: TEST_SNAPSHOT_REF,
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });
  });

  it("rejects commit requests whose snapshotRef is not a hosted bundle ref", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: {
        checkpoint: "wake_24",
      },
    });

    const { POST } = await import("../app/api/internal/hosted-wake/commit/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.commitHostedExecutionCursorTx).not.toHaveBeenCalled();
  });

  it("materializes hosted wakes from canonical web-owned state", async () => {
    const { POST } = await import("../app/api/internal/hosted-wake/materialize/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      targetSeqHint: "24",
      wakeMaterializationHints: {
        deviceSyncWakeAt: "2026-04-17T01:00:00.000Z",
      },
    });
    expect(mocks.materializeHostedDueWakesTx).toHaveBeenCalledWith(expect.objectContaining({
      appendAssistantCronWake: expect.any(Function),
      appendWakePayload: expect.any(Function),
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    }));

    const materializeCall = mocks.materializeHostedDueWakesTx.mock.calls[0]?.[0];
    expect(materializeCall).toBeDefined();

    await materializeCall!.appendAssistantCronWake({
      occurredAt: "2026-04-17T00:00:00.000Z",
      reason: "alarm",
      userId: "member_123",
    });
    expect(mocks.materializeHostedAssistantCronWakeTx).toHaveBeenCalledWith({
      occurredAt: "2026-04-17T00:00:00.000Z",
      reason: "alarm",
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });

    await materializeCall!.appendWakePayload({
      wake: {
        eventId: "evt_materialized",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-17T00:00:00.000Z",
        reason: "alarm",
        userId: "member_123",
      },
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).toHaveBeenCalledWith({
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      wake: {
        eventId: "evt_materialized",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-17T00:00:00.000Z",
        reason: "alarm",
        userId: "member_123",
      },
    });
  });

  it("parses and forwards wake quarantine requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      quarantineCode: "invalid-dispatch-payload",
      wakeId: "wake_24",
      wakeSeq: "24",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/quarantine/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      quarantined: true,
    });
    expect(mocks.quarantineHostedWakeTx).toHaveBeenCalledWith({
      fetchProof: "proof_24",
      quarantineCode: "invalid-dispatch-payload",
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
      wakeId: "wake_24",
      wakeSeq: 24n,
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

  it("validates fetched wake proof currency when status includes the wake proof triple", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_old",
      fetchProof: "proof_24",
      wakeEventId: "evt_old",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
    mocks.readHostedWakeLifecycle.mockResolvedValue({
      eventId: "evt_old",
      replacedByEventId: "evt_new",
      state: "replaced",
    });
    mocks.validateHostedWakeFetchProofCurrent.mockResolvedValue({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      fetchProofCurrent: false,
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
      fetchProofCurrent: false,
      pendingWakeCount: 1,
      replacedByEventId: "evt_new",
      wakeState: "replaced",
    });
    expect(mocks.validateHostedWakeFetchProofCurrent).toHaveBeenCalledWith({
      fetchProof: "proof_24",
      prisma: expect.anything(),
      userId: "member_123",
      wakeEventId: "evt_old",
      wakeId: "wake_24",
      wakeSeq: 24n,
    });
    expect(mocks.readHostedExecutionCursor).not.toHaveBeenCalled();
  });

  it("rejects partial fetched wake proof input on hosted wake status requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      fetchProof: "proof_24",
      wakeId: "wake_24",
    });

    const { POST } = await import("../app/api/internal/hosted-wake/status/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.validateHostedWakeFetchProofCurrent).not.toHaveBeenCalled();
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
    expect(mocks.nudgeHostedWakeUserBestEffort).toHaveBeenCalledWith({
      context: "hosted-wake.repair",
      userId: "member_123",
    });
  });
});
