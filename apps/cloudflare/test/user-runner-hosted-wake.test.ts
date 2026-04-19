import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedWakeCommitRequest,
  HostedWakeFinalizeRequest,
  HostedExecutionCursorState,
  HostedFetchedWakeRecord,
} from "@murphai/hosted-execution/contracts";

import { createHostedExecutionVercelOidcValidationEnvironment } from "../src/auth-adapter.ts";
import type { HostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { createHostedUserKeyStore } from "../src/user-key-store.js";
import * as webControlPlane from "../src/web-control-plane.ts";
import {
  TEST_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_RECOVERY_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK as TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
  TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  encryptTestHostedWakePayload,
  issueTestHostedWakeFetchProof,
} from "./hosted-execution-fixtures.js";
import { createTestSqlStorage } from "./sql-storage.js";

const describe = baseDescribe.sequential;
const bucket = createBucket();
const storage = createStorage();
const TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES = Uint8Array.from({ length: 32 }, () => 5);
const TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION = "v1";
type HostedWakeSnapshotRef = HostedExecutionCursorState["snapshotRef"];
const environment: HostedExecutionEnvironment = {
  allowedRunnerSecretKeys: null,
  automationRecipientKeyId: TEST_AUTOMATION_RECIPIENT_KEY_ID,
  automationRecipientPrivateKey: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  automationRecipientPrivateKeysById: {
    [TEST_AUTOMATION_RECIPIENT_KEY_ID]: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  },
  automationRecipientPublicKey: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  maxEventAttempts: 3,
  hostedWakeEncryption: {
    key: TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
    keyVersion: TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
    keysByVersion: {
      [TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION]: TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
    },
  },
  platformEnvelopeKey: Uint8Array.from({ length: 32 }, () => 7),
  platformEnvelopeKeyId: "v1",
  platformEnvelopeKeysById: {
    v1: Uint8Array.from({ length: 32 }, () => 7),
  },
  recoveryRecipientKeyId: TEST_RECOVERY_RECIPIENT_KEY_ID,
  recoveryRecipientPublicKey: TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
  retryDelayMs: 10_000,
  runnerReadyTimeoutMs: 20_000,
  runnerTimeoutMs: 60_000,
  hostedWebBaseUrl: "https://web.example.test/",
  teeAutomationRecipientKeyId: TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
  teeAutomationRecipientPublicKey: TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  vercelOidcValidation: createHostedExecutionVercelOidcValidationEnvironment({
    environment: "production",
    projectName: "murph-web",
    teamSlug: "murph-team",
  }),
  webCallbackSigning: {
    keyId: "v1",
    privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  },
};

describe("HostedUserRunner hosted wake drain", () => {
  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("advances past quarantined hosted wake rows so later wakes still run", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "3",
      version: "cursor_v1",
    });
    const cursorAfterQuarantine = createCursorState({
      committedSeq: "0",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:00.500Z",
      version: "cursor_v2",
    });
    const cursorAfterFirstCommit = createCursorState({
      committedSeq: "1",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:01.000Z",
      version: "cursor_v3",
    });
    const finalCursor = createCursorState({
      committedSeq: "2",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:02.000Z",
      version: "cursor_v4",
    });
    const invalidWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: {
        invalid: true,
      },
      seq: "1",
    });
    const staleFollowingWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_after_quarantine"),
      seq: "2",
    });
    const quarantinedWake = createHostedWakeRecord({
      cursor: cursorAfterQuarantine,
      quarantineCode: "invalid-wake-payload",
      quarantinedAt: "2026-03-26T12:00:00.500Z",
      seq: "1",
    });
    const followingWake = createHostedWakeRecord({
      cursor: cursorAfterFirstCommit,
      payload: createWake("evt_after_quarantine"),
      seq: "2",
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      const path = new URL(request.url).pathname;
      if (path === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      return createCompletedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const materializeHostedDueWakesInWeb = vi.spyOn(webControlPlane, "materializeHostedDueWakesInWeb");
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [
          invalidWake,
          staleFollowingWake,
        ],
      })
      .mockResolvedValueOnce({
        cursor: cursorAfterQuarantine,
        wakes: [
          quarantinedWake,
          staleFollowingWake,
        ],
      })
      .mockResolvedValueOnce({
        cursor: cursorAfterFirstCommit,
        wakes: [followingWake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const quarantineHostedWakeInWeb = vi.spyOn(webControlPlane, "quarantineHostedWakeInWeb");
    quarantineHostedWakeInWeb.mockResolvedValue({
      quarantined: true,
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: cursorAfterFirstCommit,
    }).mockResolvedValueOnce({
      committed: true,
      cursor: finalCursor,
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: finalCursor,
      pendingWakeCount: 0,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(quarantineHostedWakeInWeb).toHaveBeenCalledWith(expect.objectContaining({
      fetchProof: invalidWake.fetchProof,
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_1",
      wakeSeq: "1",
    }));
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        quarantineCode?: string;
        wakeId?: string;
        wakeKind?: string;
        wakePayloadSchema?: string;
        wakeSeq?: string;
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("invalid wake payload")
      && record.details?.quarantineCode === "invalid-wake-payload"
      && record.details?.wakeId === invalidWake.id
      && record.details?.wakeSeq === "1")).toBe(true);
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["1", "2"]);
    expect(recordHostedWakeTerminalInWeb.mock.calls.map(([input]) => input.body)).toEqual([
      {
        fetchProof: quarantinedWake.fetchProof,
        state: "quarantined",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      {
        fetchProof: followingWake.fetchProof,
        state: "completed",
        wakeId: "wake_2",
        wakeSeq: "2",
      },
    ]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_quarantine"]);
  });

  it("advances past already-quarantined wakes before dispatching later rows", async () => {
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "3",
      version: "cursor_v1",
    });
    const cursorAfterFirstCommit = createCursorState({
      committedSeq: "1",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:01.000Z",
      version: "cursor_v2",
    });
    const finalCursor = createCursorState({
      committedSeq: "2",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:02.000Z",
      version: "cursor_v3",
    });
    const quarantinedWake = createHostedWakeRecord({
      cursor: initialCursor,
      quarantineCode: "invalid-wake-payload",
      quarantinedAt: "2026-03-26T12:00:00.500Z",
      seq: "1",
    });
    const staleFollowingWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_after_quarantine"),
      seq: "2",
    });
    const followingWake = createHostedWakeRecord({
      cursor: cursorAfterFirstCommit,
      payload: createWake("evt_after_quarantine"),
      seq: "2",
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      return createCompletedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    const materializeHostedDueWakesInWeb = vi.spyOn(webControlPlane, "materializeHostedDueWakesInWeb");
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [
          quarantinedWake,
          staleFollowingWake,
        ],
      })
      .mockResolvedValueOnce({
        cursor: cursorAfterFirstCommit,
        wakes: [followingWake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: cursorAfterFirstCommit,
    }).mockResolvedValueOnce({
      committed: true,
      cursor: finalCursor,
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const quarantineHostedWakeInWeb = vi.spyOn(webControlPlane, "quarantineHostedWakeInWeb");
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: finalCursor,
      pendingWakeCount: 0,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(quarantineHostedWakeInWeb).not.toHaveBeenCalled();
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["1", "2"]);
    expect(recordHostedWakeTerminalInWeb.mock.calls.map(([input]) => input.body)).toEqual([
      {
        fetchProof: quarantinedWake.fetchProof,
        state: "quarantined",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      {
        fetchProof: followingWake.fetchProof,
        state: "completed",
        wakeId: "wake_2",
        wakeSeq: "2",
      },
    ]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_quarantine"]);
  });

  it("keeps draining past 32 sequential refetch rounds while proofs are re-fenced per commit", async () => {
    const totalWakes = 33;
    const finalSeq = String(totalWakes);
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      if (new URL(request.url).pathname === "/api/internal/hosted-wake/status") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq,
            nextSeq: String(totalWakes + 1),
            snapshotRef: null,
            updatedAt: `2026-03-26T12:01:${committedSeq.padStart(2, "0")}.000Z`,
            userId: "member_123",
            version: `${BigInt(committedSeq) + 1n}`,
          },
          pendingWakeCount: Math.max(0, totalWakes - Number(committedSeq)),
        });
      }
      return createCompletedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    let committedSeq = "0";
    fetchHostedWakeBatchFromWeb.mockImplementation(async () => {
      const nextSeq = BigInt(committedSeq) + 1n;
      const cursor = createCursorState({
        committedSeq,
        nextSeq: String(totalWakes + 1),
        updatedAt: `2026-03-26T12:00:${committedSeq.padStart(2, "0")}.000Z`,
        version: `cursor_v${nextSeq.toString()}`,
      });

      if (nextSeq > BigInt(totalWakes)) {
        return {
          cursor,
          wakes: [],
        };
      }

      return {
        cursor,
        wakes: [
          createHostedWakeRecord({
            cursor,
            payload: createWake(`evt_${nextSeq.toString()}`),
            seq: nextSeq.toString(),
          }),
        ],
      };
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementation(async ({ body }) => {
      committedSeq = body.committedSeq;
      return {
        committed: true,
        cursor: createCursorState({
          committedSeq: body.committedSeq,
          nextSeq: String(totalWakes + 1),
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: `2026-03-26T12:01:${body.committedSeq.padStart(2, "0")}.000Z`,
          version: `cursor_v${(BigInt(body.committedSeq) + 1n).toString()}`,
        }),
        finalizeToken: `finalize_token_${body.committedSeq}`,
      };
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockImplementation(async ({ body }) => ({
      cursor: createCursorState({
        committedSeq,
        nextSeq: String(totalWakes + 1),
        snapshotRef: readSnapshotRef(body.snapshotRef),
        updatedAt: `2026-03-26T12:02:${committedSeq.padStart(2, "0")}.000Z`,
        version: `cursor_v${(BigInt(committedSeq) + 2n).toString()}`,
      }),
      finalized: true,
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    const result = await runner.wakeHostedWakes();

    expect(result.committedSeq).toBe(finalSeq);
    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(totalWakes);
    expect(fetchHostedWakeBatchFromWeb).toHaveBeenCalledTimes(totalWakes + 1);
    expect(readDispatchedEventIds(fetchMock)).toHaveLength(totalWakes);
  });

  it("skips local post-commit cleanup after losing the cursor compare-and-swap race", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      const path = new URL(request.url).pathname;
      if (path === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      return createCommittedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_stale_commit"),
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: false,
      cursor: createCursorState({
        committedSeq: "0",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "0",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 1,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");
    const stateStore = Reflect.get(runner, "stateStore");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readActiveRunLease = Reflect.get(stateStore, "readActiveRunLease");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readActiveRunLease !== "function" || typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store lease and pending commit helpers.");
    }

    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["1"]);
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_stale_commit"]);
    expect(cleanupWakeAfterCursorCommit).not.toHaveBeenCalled();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
    await expect(readActiveRunLease.call(stateStore)).resolves.toBeNull();
  });

  it("clears a stale pending commit and refetches when terminal receipt recording loses the fetch fence", async () => {
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      version: "cursor_v1",
    });
    const rewrittenCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      updatedAt: "2026-03-26T12:00:02.000Z",
      version: "cursor_v2",
    });
    const finalCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const staleWake = createHostedWakeRecord({
      cursor: initialCursor,
      occurredAt: "2026-03-26T12:00:00.000Z",
      payload: createWake("evt_stale_terminal"),
      seq: "1",
      wakeEventId: "evt_stale_terminal",
    });
    const rewrittenWake = createHostedWakeRecord({
      cursor: rewrittenCursor,
      occurredAt: "2026-03-26T12:01:00.000Z",
      payload: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_fresh_terminal",
        occurredAt: "2026-03-26T12:01:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      seq: "1",
      wakeEventId: "evt_fresh_terminal",
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      return createCommittedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [staleWake],
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        wakes: [rewrittenWake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementationOnce(async ({ body }) => ({
      committed: true,
      cursor: createCursorState({
        committedSeq: body.committedSeq,
        nextSeq: "2",
        snapshotRef: readSnapshotRef(body.snapshotRef),
        updatedAt: "2026-03-26T12:00:03.000Z",
        version: "cursor_v3",
      }),
      finalizeToken: "finalize_token_stale_terminal",
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb
      .mockRejectedValueOnce(new webControlPlane.HostedWakeTerminalStaleFetchProofError())
      .mockResolvedValueOnce({
        recorded: true,
      });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        fetchProofCurrent: true,
        pendingWakeCount: 1,
        wakeState: "queued",
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        pendingWakeCount: 1,
        replacedByEventId: "evt_fresh_terminal",
        wakeState: "queued",
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        fetchProofCurrent: true,
        pendingWakeCount: 1,
        wakeState: "queued",
      });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readActiveRunLease = Reflect.get(stateStore, "readActiveRunLease");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readActiveRunLease !== "function" || typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store lease and pending commit helpers.");
    }

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledTimes(2);
    expect(recordHostedWakeTerminalInWeb.mock.calls.map(([input]) => input.body)).toEqual([
      {
        fetchProof: staleWake.fetchProof,
        state: "completed",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      {
        fetchProof: rewrittenWake.fetchProof,
        state: "completed",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
    ]);
    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_stale_terminal",
        fetchProof: staleWake.fetchProof,
        wakeEventId: "evt_stale_terminal",
        wakeId: staleWake.id,
        wakeSeq: staleWake.seq,
      },
      boundUserId: "member_123",
    });
    expect(readHostedWakeStatusFromWeb.mock.calls[1]?.[0]).toMatchObject({
      body: {
        eventId: "evt_stale_terminal",
      },
      boundUserId: "member_123",
    });
    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(commitHostedWakeCursorToWeb.mock.calls[0]?.[0].body).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v2",
    });
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_stale_terminal",
      "evt_fresh_terminal",
    ]);
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
    await expect(readActiveRunLease.call(stateStore)).resolves.toBeNull();
  });

  it("rejects a stale fetched wake before runtime invocation and refetches the replacement", async () => {
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      version: "cursor_v1",
    });
    const rewrittenCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      updatedAt: "2026-03-26T12:00:02.000Z",
      version: "cursor_v2",
    });
    const finalCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const staleWake = createHostedWakeRecord({
      cursor: initialCursor,
      occurredAt: "2026-03-26T12:00:00.000Z",
      payload: createWake("evt_stale_pre_execution"),
      seq: "1",
      wakeEventId: "evt_stale_pre_execution",
    });
    const rewrittenWake = createHostedWakeRecord({
      cursor: rewrittenCursor,
      occurredAt: "2026-03-26T12:01:00.000Z",
      payload: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_fresh_pre_execution",
        occurredAt: "2026-03-26T12:01:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      seq: "1",
      wakeEventId: "evt_fresh_pre_execution",
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      return createCommittedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [staleWake],
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        wakes: [rewrittenWake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        fetchProofCurrent: false,
        pendingWakeCount: 1,
        replacedByEventId: "evt_fresh_pre_execution",
        wakeState: "replaced",
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        fetchProofCurrent: true,
        pendingWakeCount: 1,
      })
      .mockResolvedValue({
        cursor: finalCursor,
        pendingWakeCount: 0,
      });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: finalCursor,
      finalizeToken: "finalize_token_fresh_pre_execution",
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store pending commit helper.");
    }

    await runner.wakeHostedWakes();

    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_stale_pre_execution",
        fetchProof: staleWake.fetchProof,
        wakeEventId: "evt_stale_pre_execution",
        wakeId: staleWake.id,
        wakeSeq: staleWake.seq,
      },
      boundUserId: "member_123",
    });
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledTimes(1);
    expect(recordHostedWakeTerminalInWeb.mock.calls[0]?.[0].body).toEqual({
      fetchProof: rewrittenWake.fetchProof,
      state: "completed",
      wakeId: "wake_1",
      wakeSeq: "1",
    });
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["1"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_fresh_pre_execution"]);
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("reschedules alarm-driven wake draining when terminal receipt recording fails before cursor advance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      version: "cursor_v1",
    });
    const finalCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      updatedAt: "2026-03-26T12:00:06.000Z",
      version: "cursor_v2",
    });
    const wake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_alarm_terminal_retry"),
      seq: "1",
      wakeEventId: "evt_alarm_terminal_retry",
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      if (new URL(request.url).pathname === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      return createCommittedRunnerSuccessResponse({
        init: {
          body: await request.clone().text(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [wake],
      })
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [wake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementationOnce(async ({ body }) => ({
      committed: true,
      cursor: createCursorState({
        committedSeq: body.committedSeq,
        nextSeq: "2",
        snapshotRef: readSnapshotRef(body.snapshotRef),
        updatedAt: "2026-03-26T12:00:06.000Z",
        version: "cursor_v2",
      }),
      finalizeToken: "finalize_token_alarm_terminal_retry",
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb
      .mockRejectedValueOnce(new Error("terminal callback timed out"))
      .mockResolvedValueOnce({
        recorded: true,
      });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: initialCursor,
      pendingWakeCount: 1,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const markRuntimeBootstrapped = Reflect.get(stateStore, "markRuntimeBootstrapped");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof markRuntimeBootstrapped !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error("Expected HostedUserRunner state store bootstrapped/pending commit helpers.");
    }

    await markRuntimeBootstrapped.call(stateStore);

    await runner.alarm();

    expect(storage.lastAlarm).toBe(Date.parse("2026-03-26T12:00:05.000Z"));
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(commitHostedWakeCursorToWeb).not.toHaveBeenCalled();
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_alarm_terminal_retry",
      finalizedAt: null,
    });

    vi.setSystemTime(new Date("2026-03-26T12:00:05.000Z"));
    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledTimes(2);
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalled();
    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    const runnerRequests = fetchMock.mock.calls.flatMap(([, init]) => {
      const body = typeof init?.body === "string" ? init.body : "{}";
      const request = maybeReadRunnerJobRequest(JSON.parse(body));
      return request ? [request] : [];
    });
    expect(runnerRequests).toHaveLength(2);
    expect(runnerRequests[0]?.resume).toBeUndefined();
    expect(runnerRequests[1]?.resume).not.toBeUndefined();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("commits the last completed wake snapshot instead of a later mutable bundle cache read", async () => {
    let committedSnapshotRef: HostedWakeSnapshotRef = null;
    const finalizedBundleRef = createBundleRef("final");
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "3",
      version: "cursor_v1",
    });
    const cursorAfterFirstCommit = createCursorState({
      committedSeq: "1",
      nextSeq: "3",
      snapshotRef: committedSnapshotRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v2",
    });
    const completedWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_completed_first"),
      seq: "1",
    });
    const stalePendingCommitWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_pending_commit_then_fail"),
      seq: "2",
    });
    const pendingCommitWake = createHostedWakeRecord({
      cursor: cursorAfterFirstCommit,
      payload: createWake("evt_pending_commit_then_fail"),
      seq: "2",
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [completedWake, stalePendingCommitWake],
      })
      .mockResolvedValueOnce({
        cursor: cursorAfterFirstCommit,
        wakes: [pendingCommitWake],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementationOnce(async ({ body }: {
      body: HostedWakeCommitRequest;
    }) => {
      committedSnapshotRef = readSnapshotRef(body.snapshotRef);
      return {
        committed: true,
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "3",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v2",
        }),
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "3",
        snapshotRef: committedSnapshotRef,
        updatedAt: "2026-03-26T12:00:03.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 1,
    });
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const path = new URL(requestEnvelope.url).pathname;
      let runnerRequestCount = 0;
      if (path === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      if (path === "/api/internal/hosted-wake/status") {
        return Response.json({
          cursor: createCursorState({
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: createBundleRef("final"),
            updatedAt: "2026-03-26T12:00:03.000Z",
            version: "cursor_v3",
          }),
          pendingWakeCount: 0,
        });
      }
      const request = readRunnerJobRequest(JSON.parse(await requestEnvelope.clone().text()));
      if (request.wake.eventId === "evt_completed_first") {
        return createCompletedRunnerSuccessResponse({
          init,
        });
      }

      if (request.wake.eventId === "evt_pending_commit_then_fail") {
        return new Response(JSON.stringify({
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "committed" as const,
          result: {
            bundle: Buffer.from(`vault:${request.wake.eventId}`).toString("base64"),
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "handled",
            },
          },
        }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected hosted runner wake ${request.wake.eventId}.`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    const wakeProcessor = Reflect.get(runner, "wakeProcessor");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!wakeProcessor || typeof wakeProcessor !== "object") {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store pending commit helpers.");
    }

    const originalAdvanceRunPhase = Reflect.get(wakeProcessor, "advanceRunPhase");
    if (typeof originalAdvanceRunPhase !== "function") {
      throw new Error("Expected HostedUserRunner wake processor phase helpers.");
    }

    vi.spyOn(
      wakeProcessor as unknown as {
        advanceRunPhase: (input: {
          phase: string;
          wake: {
            eventId: string;
          };
        }) => Promise<unknown>;
      },
      "advanceRunPhase",
    ).mockImplementation(async (input) => {
      if (
        input.wake.eventId === "evt_pending_commit_then_fail"
        && input.phase === "completed"
      ) {
        throw new Error("forced post-commit failure");
      }

      return originalAdvanceRunPhase.call(wakeProcessor, input);
    });

    await runner.wakeHostedWakes();

    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledTimes(1);
    expect(fetchHostedWakeBatchFromWeb).toHaveBeenCalledTimes(2);
    expect(commitHostedWakeCursorToWeb.mock.calls[0]?.[0].body).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_pending_commit_then_fail",
    });
    await expect(readPendingCommit.call(stateStore)).resolves.not.toMatchObject({
      bundleRef: committedSnapshotRef,
    });
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_completed_first",
      "evt_pending_commit_then_fail",
    ]);
  });

  it("refetches after each successful cursor advance before executing a later wake from the same fetched batch", async () => {
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "3",
      version: "cursor_v1",
    });
    const cursorAfterFirstCommit = createCursorState({
      committedSeq: "1",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v2",
    });
    const finalCursor = createCursorState({
      committedSeq: "2",
      nextSeq: "3",
      updatedAt: "2026-03-26T12:00:04.000Z",
      version: "cursor_v3",
    });
    const firstWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_refetch_first"),
      seq: "1",
    });
    const staleSecondWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_refetch_second"),
      seq: "2",
    });
    const freshSecondWake = createHostedWakeRecord({
      cursor: cursorAfterFirstCommit,
      payload: createWake("evt_refetch_second"),
      seq: "2",
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [
          firstWake,
          staleSecondWake,
        ],
      })
      .mockResolvedValueOnce({
        cursor: cursorAfterFirstCommit,
        wakes: [freshSecondWake],
      })
      .mockResolvedValueOnce({
        cursor: finalCursor,
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb
      .mockResolvedValueOnce({
        committed: true,
        cursor: cursorAfterFirstCommit,
      })
      .mockResolvedValueOnce({
        committed: true,
        cursor: finalCursor,
      });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const requestBody = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : null;
      const runnerRequest = requestBody ? maybeReadRunnerJobRequest(requestBody) : null;

      if (!runnerRequest) {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "3",
            snapshotRef: null,
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "2",
          },
          fetchProofCurrent: true,
          pendingWakeCount: 1,
          wakeState: "queued",
        });
      }

      return createCompletedRunnerSuccessResponse({
        init,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(fetchHostedWakeBatchFromWeb).toHaveBeenCalledTimes(3);
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => ({
      committedSeq: input.body.committedSeq,
      expectedVersion: input.body.expectedVersion,
    }))).toEqual([
      {
        committedSeq: "1",
        expectedVersion: "cursor_v1",
      },
      {
        committedSeq: "2",
        expectedVersion: "cursor_v2",
      },
    ]);
    const terminalFetchProofs = recordHostedWakeTerminalInWeb.mock.calls.map(
      ([input]) => input.body.fetchProof,
    );
    expect(terminalFetchProofs).toEqual([
      firstWake.fetchProof,
      freshSecondWake.fetchProof,
    ]);
    expect(terminalFetchProofs).not.toContain(staleSecondWake.fetchProof);
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_refetch_first",
      "evt_refetch_second",
    ]);
  });

  it("publishes a finalized snapshot only after the seq commit succeeds", async () => {
    const commitBodies: HostedWakeCommitRequest[] = [];
    const finalizeBodies: HostedWakeFinalizeRequest[] = [];
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_finalize_after_cas"),
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: createBundleRef("final"),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementation(async ({ body }) => {
      commitBodies.push(body);

      return {
        committed: true,
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:01.000Z",
          version: "cursor_v2",
        }),
        finalizeToken: "finalize_token_1",
      };
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockImplementation(async ({ body }) => {
      finalizeBodies.push(body);

      return {
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
        finalized: true,
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    let runnerRequestCount = 0;
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const path = new URL(requestEnvelope.url).pathname;
      if (path === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      if (path === "/api/internal/hosted-wake/status") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: createBundleRef("final"),
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "3",
          },
          pendingWakeCount: 0,
        });
      }
      if (path === "/api/internal/hosted-wake/unseen") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: createBundleRef("final"),
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "3",
          },
          wakes: [],
        });
      }
      runnerRequestCount += 1;
      if (runnerRequestCount === 1) {
        return new Response(JSON.stringify({
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "committed" as const,
          result: {
            bundle: Buffer.from("vault:committed").toString("base64"),
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "committed",
            },
          },
        }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        finalGatewayProjectionSnapshot: null,
        phase: "completed" as const,
        result: {
          bundle: Buffer.from("vault:final").toString("base64"),
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "final",
          },
        },
      }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_finalize_after_cas"]);
    expect(runnerRequestCount).toBe(2);
    const runnerRequests = fetchMock.mock.calls.flatMap(([url, init]) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const requestBody = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : null;
      const request = requestBody ? maybeReadRunnerJobRequest(requestBody) : null;

      return request ? [request] : [];
    });
    expect(runnerRequests).toHaveLength(2);
    expect(runnerRequests[1]?.resume).toEqual({
      committedResult: {
        assistantDeliveryEffects: [],
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "committed",
        },
      },
    });
    expect(commitBodies).toHaveLength(1);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(runnerRequests[1]?.currentBundleRef).toEqual(commitBodies[0]?.snapshotRef);
    expect(finalizeBodies).toHaveLength(1);
    expect(finalizeBodies[0]).toMatchObject({
      finalizeToken: "finalize_token_1",
    });
    expect(commitBodies[0]?.snapshotRef).not.toEqual(finalizeBodies[0]?.snapshotRef);
  });

  it("treats a same-seq finalized snapshot publish lost race as success when the cursor already matches", async () => {
    const commitBodies: HostedWakeCommitRequest[] = [];
    const finalizeBodies: HostedWakeFinalizeRequest[] = [];
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_finalize_after_cas_same_seq_race"),
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: null,
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementation(async ({ body }) => {
      commitBodies.push(body);

      return {
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:01.000Z",
          version: "cursor_v2",
        }),
        committed: true,
        finalizeToken: "finalize_token_same_seq",
      };
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockImplementation(async ({ body }) => {
      finalizeBodies.push(body);

      return {
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
        finalized: false,
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    let runnerRequestCount = 0;
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      if (new URL(requestEnvelope.url).pathname === "/api/internal/hosted-wake/status") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: readSnapshotRef(finalizeBodies.at(-1)?.snapshotRef),
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "3",
          },
          pendingWakeCount: 0,
        });
      }
      const request = readRunnerJobRequest(JSON.parse(await requestEnvelope.clone().text()));
      runnerRequestCount += 1;

      if (!request.resume) {
        return new Response(JSON.stringify({
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "committed" as const,
          result: {
            bundle: Buffer.from("vault:committed").toString("base64"),
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "committed",
            },
          },
        }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        finalGatewayProjectionSnapshot: null,
        phase: "completed" as const,
        result: {
          bundle: Buffer.from("vault:final").toString("base64"),
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "final",
          },
        },
      }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(runnerRequestCount).toBe(2);
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_finalize_after_cas_same_seq_race",
    ]);
    const runnerRequests = fetchMock.mock.calls.flatMap(([url, init]) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const requestBody = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : null;
      const request = requestBody ? maybeReadRunnerJobRequest(requestBody) : null;

      return request ? [request] : [];
    });
    expect(runnerRequests).toHaveLength(2);
    expect(runnerRequests[1]?.resume).toEqual({
      committedResult: {
        assistantDeliveryEffects: [],
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "committed",
        },
      },
    });
    expect(commitBodies).toHaveLength(1);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(finalizeBodies).toHaveLength(1);
    expect(finalizeBodies[0]).toMatchObject({
      finalizeToken: "finalize_token_same_seq",
    });
    expect(finalizeBodies[0]?.snapshotRef).not.toEqual(commitBodies[0]?.snapshotRef);
    expect(cleanupWakeAfterCursorCommit).toHaveBeenCalledOnce();
  });

  it("clears the finalized pending commit when a same-seq snapshot publish loses CAS to a different snapshot", async () => {
    const commitBodies: HostedWakeCommitRequest[] = [];
    const finalizeBodies: HostedWakeFinalizeRequest[] = [];
    const winnerBundleRef = createBundleRef("winner-conflict");
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb.mockResolvedValueOnce({
      cursor: createCursorState({
        committedSeq: "0",
        nextSeq: "2",
        version: "cursor_v1",
      }),
      wakes: [
        createHostedWakeRecord({
          payload: createWake("evt_finalize_after_cas_conflict"),
          seq: "1",
        }),
      ],
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementation(async ({ body }) => {
      commitBodies.push(body);

      return {
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:01.000Z",
          version: "cursor_v2",
        }),
        committed: true,
        finalizeToken: "finalize_token_conflict",
      };
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockImplementation(async ({ body }) => {
      finalizeBodies.push(body);

      return {
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: winnerBundleRef,
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
        finalized: false,
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    let runnerRequestCount = 0;
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const path = new URL(requestEnvelope.url).pathname;
      if (path === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: "1",
          wakeMaterializationHints: null,
        });
      }
      if (path === "/api/internal/hosted-wake/status") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: winnerBundleRef,
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "3",
          },
          pendingWakeCount: 0,
        });
      }
      if (path === "/api/internal/hosted-wake/unseen") {
        return Response.json({
          cursor: {
            createdAt: "2026-03-26T12:00:00.000Z",
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: winnerBundleRef,
            updatedAt: "2026-03-26T12:00:03.000Z",
            userId: "member_123",
            version: "3",
          },
          wakes: [],
        });
      }
      runnerRequestCount += 1;

      if (runnerRequestCount === 1) {
        return new Response(JSON.stringify({
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "committed" as const,
          result: {
            bundle: Buffer.from("vault:committed").toString("base64"),
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "committed",
            },
          },
        }), {
          status: 200,
        });
      }

      if (runnerRequestCount === 2) {
        return new Response(JSON.stringify({
          finalGatewayProjectionSnapshot: null,
          phase: "completed" as const,
          result: {
            bundle: Buffer.from("vault:final-conflict").toString("base64"),
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "final",
            },
          },
        }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected runner fetch ${runnerRequestCount} to ${requestEnvelope.url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");
    const stateStore = Reflect.get(runner, "stateStore");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store pending commit helpers.");
    }

    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(runnerRequestCount).toBe(2);
    expect(commitBodies).toHaveLength(1);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(finalizeBodies).toHaveLength(1);
    expect(finalizeBodies[0]).toMatchObject({
      finalizeToken: "finalize_token_conflict",
    });
    expect(finalizeBodies[0]?.snapshotRef).not.toEqual(commitBodies[0]?.snapshotRef);
    expect(cleanupWakeAfterCursorCommit).toHaveBeenCalledOnce();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("resumes and clears a finalized pending commit on a later alarm after a retryable cleanup exit", async () => {
    const stalePublishedBundleRef = createBundleRef("winner-conflict");
    const finalizedPendingBundleRef = createBundleRef("finalized-after-retry");
    const committedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: stalePublishedBundleRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: finalizedPendingBundleRef,
      updatedAt: "2026-03-26T12:00:05.000Z",
      version: "cursor_v4",
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb.mockResolvedValueOnce({
      cursor: finalizedCursor,
      wakes: [],
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockResolvedValueOnce({
      cursor: finalizedCursor,
      finalized: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValueOnce({
      cursor: committedCursor,
      pendingWakeCount: 0,
    });
    const fetchMock = vi.fn(async (url, init) => {
      const request = url instanceof Request ? url : new Request(String(url), init);
      if (new URL(request.url).pathname === "/api/internal/hosted-wake/materialize") {
        return Response.json({
          targetSeqHint: null,
          wakeMaterializationHints: null,
        });
      }

      throw new Error(`Unexpected fetch to ${request.url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const markRuntimeBootstrapped = Reflect.get(stateStore, "markRuntimeBootstrapped");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof markRuntimeBootstrapped !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store bootstrapped/pending commit helpers.",
      );
    }

    await markRuntimeBootstrapped.call(stateStore);
    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_alarm_finalize_retry"),
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: finalizedPendingBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_alarm_finalize_retry",
      finalizeToken: "finalize_token_alarm",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_alarm_finalize_retry",
        fetchProof: null,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: null,
      },
    });

    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_alarm_finalize_retry",
      finalizedAt: "2026-03-26T12:00:01.000Z",
    });

    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledOnce();
    expect(finalizeHostedWakeCursorInWeb).toHaveBeenCalledOnce();
    expect(finalizeHostedWakeCursorInWeb.mock.calls[0]?.[0].body).toMatchObject({
      finalizeToken: "finalize_token_alarm",
      snapshotRef: finalizedPendingBundleRef,
    });
    expect(commitHostedWakeCursorToWeb).not.toHaveBeenCalled();
    expect(fetchHostedWakeBatchFromWeb).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("resumes and clears a finalized pending commit during status reads after a retryable cleanup exit", async () => {
    const stalePublishedBundleRef = createBundleRef("winner-conflict-status");
    const finalizedPendingBundleRef = createBundleRef("finalized-from-status");
    const committedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: stalePublishedBundleRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: finalizedPendingBundleRef,
      updatedAt: "2026-03-26T12:00:05.000Z",
      version: "cursor_v4",
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockResolvedValueOnce({
      cursor: finalizedCursor,
      finalized: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: committedCursor,
        fetchProofCurrent: false,
        pendingWakeCount: 0,
      })
      .mockResolvedValueOnce({
        cursor: finalizedCursor,
        pendingWakeCount: 0,
      });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_status_finalize_retry"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_status_finalize_retry",
      run: {
        attempt: 1,
        runId: "run_status_finalize_retry",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: finalizedPendingBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_status_finalize_retry",
      finalizeToken: "finalize_token_status",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_status_finalize_retry",
        fetchProof: null,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: null,
      },
    });

    const status = await runner.status();

    expect(finalizeHostedWakeCursorInWeb).toHaveBeenCalledOnce();
    expect(finalizeHostedWakeCursorInWeb.mock.calls[0]?.[0].body).toMatchObject({
      finalizeToken: "finalize_token_status",
      snapshotRef: finalizedPendingBundleRef,
    });
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledTimes(2);
    expect(status.bundleRef).toEqual(finalizedPendingBundleRef);
    expect(status.inFlight).toBe(false);
    expect(status.lastError).toBeNull();
    expect(status.pendingWakeCount).toBe(0);
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("logs pending-commit status fallback details when fenced status reads fail", async () => {
    const finalizedPendingBundleRef = createBundleRef("finalized-from-status-fallback");
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockRejectedValueOnce(new Error("status unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    if (typeof beginWakeRun !== "function" || typeof writePendingCommit !== "function") {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_status_finalize_fallback"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_status_finalize_fallback",
      run: {
        attempt: 1,
        runId: "run_status_finalize_fallback",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: finalizedPendingBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_status_finalize_fallback",
      finalizeToken: "finalize_token_status_fallback",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_status_finalize_fallback",
        fetchProof: null,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: null,
      },
    });

    const status = await runner.status();

    expect(status.lastEventId).toBe("evt_status_finalize_fallback");
    expect(status.pendingWakeCount).toBe(0);
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        fallbackStatus?: string;
        pendingCommitEventId?: string;
        pendingCommitFinalizedAt?: string | null;
        pendingCommitUserId?: string;
        pendingCommitWakeSeq?: string;
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("fenced pending commit cleanup")
      && record.details?.fallbackStatus === "current-runner-status"
      && record.details?.pendingCommitEventId === "evt_status_finalize_fallback"
      && record.details?.pendingCommitUserId === "member_123"
      && record.details?.pendingCommitWakeSeq === "1")).toBe(true);
  });

  it("publishes assistant schedule updates during status recovery even when the finalized snapshot already matches", async () => {
    const finalizedPendingBundleRef = createBundleRef("finalized-from-status-schedule-only");
    const committedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: finalizedPendingBundleRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: finalizedPendingBundleRef,
      updatedAt: "2026-03-26T12:00:05.000Z",
      version: "cursor_v4",
    });
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockResolvedValueOnce({
      cursor: finalizedCursor,
      finalized: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: committedCursor,
        pendingWakeCount: 0,
      })
      .mockResolvedValueOnce({
        cursor: finalizedCursor,
        pendingWakeCount: 0,
      });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_status_finalize_schedule_only"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_status_finalize_schedule_only",
      run: {
        attempt: 1,
        runId: "run_status_finalize_schedule_only",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: finalizedPendingBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_status_finalize_schedule_only",
      finalizeToken: "finalize_token_status_schedule_only",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
        wakeMaterializationHints: {
          assistantWakeAt: "2026-03-26T12:30:00.000Z",
        },
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_status_finalize_schedule_only",
        fetchProof: "fetch_proof_status_finalize_schedule_only",
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: "wake_1",
      },
    });

    const status = await runner.status();

    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_status_finalize_schedule_only",
        fetchProof: "fetch_proof_status_finalize_schedule_only",
        wakeEventId: "evt_status_finalize_schedule_only",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      boundUserId: "member_123",
    });
    expect(finalizeHostedWakeCursorInWeb).toHaveBeenCalledOnce();
    expect(finalizeHostedWakeCursorInWeb.mock.calls[0]?.[0].body).toMatchObject({
      assistantNextWakeAt: "2026-03-26T12:30:00.000Z",
      finalizeToken: "finalize_token_status_schedule_only",
      snapshotRef: finalizedPendingBundleRef,
    });
    expect(status.bundleRef).toEqual(finalizedPendingBundleRef);
    expect(status.inFlight).toBe(false);
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
  });

  it("clears a replaced pending commit during status recovery before terminal cleanup", async () => {
    const rewrittenBundleRef = createBundleRef("replaced-before-terminal-status");
    const rewrittenCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      snapshotRef: rewrittenBundleRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v2",
    });
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const syncNextWake = Reflect.get(stateStore, "syncNextWake");
    const readActiveRunLease = Reflect.get(stateStore, "readActiveRunLease");
    const readBundleMetaState = Reflect.get(stateStore, "readBundleMetaState");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    const readWakeMaterializationHints = Reflect.get(stateStore, "readWakeMaterializationHints");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof syncNextWake !== "function"
      || typeof readActiveRunLease !== "function"
      || typeof readBundleMetaState !== "function"
      || typeof readPendingCommit !== "function"
      || typeof readWakeMaterializationHints !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner stale cleanup helpers to be available.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_status_stale_pending_a"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_status_stale_pending_a",
      run: {
        attempt: 1,
        runId: "run_status_stale_pending_a",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await syncNextWake.call(stateStore, {
      preferredWakeAt: "2026-03-26T12:45:00.000Z",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-03-26T12:45:00.000Z",
      },
    });
    await storage.state.storage.setAlarm(new Date("2026-03-26T12:45:00.000Z"));
    await expect(storage.state.storage.getAlarm()).resolves.toBe(
      Date.parse("2026-03-26T12:45:00.000Z"),
    );
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: createBundleRef("stale-before-terminal-status"),
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_status_stale_pending_a",
      finalizeToken: null,
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        nextWakeAt: "2026-03-26T12:45:00.000Z",
        summary: "handled",
        wakeMaterializationHints: {
          assistantWakeAt: "2026-03-26T12:45:00.000Z",
        },
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_status_stale_pending_a",
        fetchProof: null,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: null,
      },
    });

    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        pendingWakeCount: 1,
        replacedByEventId: "evt_status_stale_pending_b",
        wakeState: "replaced",
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        pendingWakeCount: 1,
      });

    const status = await runner.status();

    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_status_stale_pending_a",
      },
      boundUserId: "member_123",
    });
    expect(status.bundleRef).toEqual(rewrittenBundleRef);
    expect(status.inFlight).toBe(false);
    expect(status.nextWakeAt).toBeNull();
    await expect(storage.state.storage.getAlarm()).resolves.toBeNull();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
    await expect(readActiveRunLease.call(stateStore)).resolves.toBeNull();
    await expect(readWakeMaterializationHints.call(stateStore)).resolves.toBeNull();
    await expect(readBundleMetaState.call(stateStore)).resolves.toMatchObject({
      bundleRef: rewrittenBundleRef,
    });
  });

  it("keeps a current pending commit when proof-aware status recovery falls back to an unchanged cursor", async () => {
    const currentCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      snapshotRef: createBundleRef("current-pending-status"),
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v1",
    });
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readActiveRunLease = Reflect.get(stateStore, "readActiveRunLease");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readActiveRunLease !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_status_pending_current"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_status_pending_current",
      run: {
        attempt: 1,
        runId: "run_status_pending_current",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: createBundleRef("current-pending-bundle"),
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_status_pending_current",
      finalizeToken: null,
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_status_pending_current",
        fetchProof: "fetch_proof_current_pending_commit",
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: "wake_1",
      },
    });

    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockRejectedValueOnce(new Error("proof-aware status temporarily unavailable"))
      .mockResolvedValueOnce({
        cursor: currentCursor,
        pendingWakeCount: 1,
        wakeState: "queued",
      })
      .mockResolvedValueOnce({
        cursor: currentCursor,
        pendingWakeCount: 1,
      });

    const status = await runner.status();

    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_status_pending_current",
        fetchProof: "fetch_proof_current_pending_commit",
        wakeEventId: "evt_status_pending_current",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      boundUserId: "member_123",
    });
    expect(readHostedWakeStatusFromWeb.mock.calls[1]?.[0]).toMatchObject({
      body: {
        eventId: "evt_status_pending_current",
      },
      boundUserId: "member_123",
    });
    expect(status.inFlight).toBe(true);
    expect(status.pendingWakeCount).toBe(1);
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_status_pending_current",
    });
    await expect(readActiveRunLease.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_status_pending_current",
    });
  });

  it("defers a later wake when execution-start fallback confirms another pending commit is still current", async () => {
    const currentCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      snapshotRef: createBundleRef("current-pending-execution"),
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v1",
    });
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const replacementWake = createHostedWakeRecord({
      cursor: currentCursor,
      payload: createWake("evt_execution_pending_replacement"),
      seq: "1",
      wakeEventId: "evt_execution_pending_replacement",
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: currentCursor,
        wakes: [replacementWake],
      })
      .mockResolvedValueOnce({
        cursor: currentCursor,
        wakes: [],
      });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockRejectedValueOnce(new Error("proof-aware status temporarily unavailable"))
      .mockResolvedValueOnce({
        cursor: currentCursor,
        pendingWakeCount: 1,
        wakeState: "queued",
      })
      .mockResolvedValueOnce({
        cursor: currentCursor,
        fetchProofCurrent: true,
        pendingWakeCount: 1,
        wakeState: "queued",
      })
      .mockRejectedValueOnce(new Error("proof-aware status temporarily unavailable"))
      .mockResolvedValueOnce({
        cursor: currentCursor,
        pendingWakeCount: 1,
        wakeState: "queued",
      });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_execution_pending_current"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_execution_pending_current",
      run: {
        attempt: 1,
        runId: "run_execution_pending_current",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: createBundleRef("current-pending-execution-bundle"),
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_execution_pending_current",
      finalizeToken: null,
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_execution_pending_current",
        fetchProof: "fetch_proof_execution_pending_current",
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: "wake_1",
      },
    });

    await expect(runner.wakeHostedWakes()).resolves.toMatchObject({
      committedSeq: "0",
      requestedTargetSeq: "1",
      targetReached: false,
    });

    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_execution_pending_current",
        fetchProof: "fetch_proof_execution_pending_current",
        wakeEventId: "evt_execution_pending_current",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      boundUserId: "member_123",
    });
    expect(readHostedWakeStatusFromWeb.mock.calls[3]?.[0]).toMatchObject({
      body: {
        eventId: "evt_execution_pending_current",
        fetchProof: "fetch_proof_execution_pending_current",
        wakeEventId: "evt_execution_pending_current",
        wakeId: "wake_1",
        wakeSeq: "1",
      },
      boundUserId: "member_123",
    });
    expect(readDispatchedEventIds(fetchMock)).toEqual([]);
    expect(recordHostedWakeTerminalInWeb).not.toHaveBeenCalled();
    expect(commitHostedWakeCursorToWeb).not.toHaveBeenCalled();
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_execution_pending_current",
    });
  });

  it("commits a direct final runtime snapshot once and skips post-cursor finalize", async () => {
    const finalizedBundleRef = createBundleRef("final");
    const fetchMock = vi.fn(async (_url, init) => createCompletedRunnerSuccessResponse({
      init,
      omitPhase: true,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_direct_final"),
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: finalizedBundleRef,
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementationOnce(async ({ body }) => ({
      committed: true,
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: readSnapshotRef(body.snapshotRef),
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: finalizedBundleRef,
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 0,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(commitHostedWakeCursorToWeb.mock.calls[0]?.[0].body).toMatchObject({
      committedSeq: "1",
      snapshotRef: {
        key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
      },
    });
    expect(readDispatchEventIdsFromSpy(cleanupWakeAfterCursorCommit)).toEqual([
      "evt_direct_final",
    ]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_direct_final"]);
  });

  it("commits the finalized pending bundle once and keeps cleanup local-only afterward", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");
    const stateStore = Reflect.get(runner, "stateStore");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store pending commit helpers.");
    }
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_commit_finalized_bundle"),
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementationOnce(async ({ body }) => ({
      committed: true,
      cursor: createCursorState({
        committedSeq: body.committedSeq,
        nextSeq: "2",
        snapshotRef: readSnapshotRef(body.snapshotRef),
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v3",
      }),
      finalizeToken: "finalize_token_cleanup_local",
    }));
    const finalizeHostedWakeCursorInWeb = vi.spyOn(webControlPlane, "finalizeHostedWakeCursorInWeb");
    finalizeHostedWakeCursorInWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v4",
      }),
      finalized: true,
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 0,
    });
    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(commitHostedWakeCursorToWeb.mock.calls[0]?.[0].body).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
      snapshotRef: null,
    });
    expect(cleanupWakeAfterCursorCommit).toHaveBeenCalledOnce();
    expect(await readPendingCommit.call(stateStore)).toBeNull();
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_commit_finalized_bundle",
    ]);
  });

  it("drops stale pending cleanup once the web cursor has advanced past that wake seq", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");
    const stateStore = Reflect.get(runner, "stateStore");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    const readBundleMetaState = Reflect.get(stateStore, "readBundleMetaState");

    if (
      typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
      || typeof readBundleMetaState !== "function"
    ) {
      throw new Error("Expected HostedUserRunner state store pending commit helpers.");
    }

    const staleBundleRef = {
      hash: "stale-hash",
      key: "bundles/vault/stale.bundle.json",
      size: 128,
      updatedAt: "2026-03-26T12:00:01.000Z",
    };
    const newerBundleRef = {
      hash: "newer-hash",
      key: "bundles/vault/newer.bundle.json",
      size: 256,
      updatedAt: "2026-03-26T12:00:02.000Z",
    };
    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_stale_cleanup_snapshot"),
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: staleBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_stale_cleanup_snapshot",
      finalizeToken: null,
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_stale_cleanup_snapshot",
        fetchProof: null,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: null,
      },
    });

    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");

    const cursor = await wakeProcessor.cleanupWakeAfterCursorCommit({
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        snapshotRef: newerBundleRef,
        updatedAt: "2026-03-26T12:00:02.500Z",
        version: "cursor_v4",
      }),
      wake: null,
    });

    expect(commitHostedWakeCursorToWeb).not.toHaveBeenCalled();
    expect(cursor).toMatchObject({
      committedSeq: "2",
      snapshotRef: newerBundleRef,
      version: "cursor_v4",
    });
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
    await expect(readBundleMetaState.call(stateStore)).resolves.toMatchObject({
      bundleRef: newerBundleRef,
    });
  });

  it("clears a replaced stale pending commit before running the replacement wake", async () => {
    const stalePendingCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      snapshotRef: createBundleRef("replacement-stale-cursor"),
      updatedAt: "2026-03-26T12:00:00.000Z",
      version: "cursor_v1",
    });
    const rewrittenCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      snapshotRef: null,
      updatedAt: "2026-03-26T12:00:02.000Z",
      version: "cursor_v2",
    });
    const materializeHostedDueWakesInWeb = vi.spyOn(
      webControlPlane,
      "materializeHostedDueWakesInWeb",
    );
    materializeHostedDueWakesInWeb.mockResolvedValue({
      targetSeqHint: "1",
      wakeMaterializationHints: null,
    });
    const stalePendingWake = createHostedWakeRecord({
      cursor: stalePendingCursor,
      payload: createWake("evt_replacement_pending_a"),
      seq: "1",
      wakeEventId: "evt_replacement_pending_a",
    });
    const replacementWake = createHostedWakeRecord({
      cursor: rewrittenCursor,
      payload: createWake("evt_replacement_pending_b"),
      seq: "1",
      wakeEventId: "evt_replacement_pending_b",
    });
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb.mockResolvedValueOnce({
      cursor: rewrittenCursor,
      wakes: [replacementWake],
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValueOnce({
      recorded: true,
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-03-26T12:00:03.000Z",
        version: "cursor_v3",
      }),
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        fetchProofCurrent: false,
        pendingWakeCount: 1,
        replacedByEventId: "evt_replacement_pending_b",
        wakeState: "replaced",
      })
      .mockResolvedValueOnce({
        cursor: rewrittenCursor,
        fetchProofCurrent: true,
        pendingWakeCount: 1,
        wakeState: "queued",
      });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
    await seedManagedUserCryptoForTest(runner, "member_123");
    const stateStore = Reflect.get(runner, "stateStore");

    if (!stateStore || typeof stateStore !== "object") {
      throw new Error("Expected HostedUserRunner state store test internals to be available.");
    }

    const beginWakeRun = Reflect.get(stateStore, "beginWakeRun");
    const writePendingCommit = Reflect.get(stateStore, "writePendingCommit");
    const readPendingCommit = Reflect.get(stateStore, "readPendingCommit");
    if (
      typeof beginWakeRun !== "function"
      || typeof writePendingCommit !== "function"
      || typeof readPendingCommit !== "function"
    ) {
      throw new Error(
        "Expected HostedUserRunner state store wake-run and pending commit helpers.",
      );
    }

    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: createWake("evt_replacement_pending_a"),
    });
    await beginWakeRun.call(stateStore, {
      eventId: "evt_replacement_pending_a",
      run: {
        attempt: 1,
        runId: "run_replacement_pending_a",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      userId: "member_123",
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: createBundleRef("replacement-stale-bundle"),
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_replacement_pending_a",
      finalizeToken: null,
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_replacement_pending_a",
        fetchProof: stalePendingWake.fetchProof,
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
        wakeId: stalePendingWake.id,
      },
    });

    await runner.wakeHostedWakes();

    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledTimes(2);
    expect(readHostedWakeStatusFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventId: "evt_replacement_pending_a",
        fetchProof: stalePendingWake.fetchProof,
        wakeEventId: "evt_replacement_pending_a",
        wakeId: stalePendingWake.id,
        wakeSeq: "1",
      },
      boundUserId: "member_123",
    });
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_replacement_pending_b",
    ]);
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_replacement_pending_b",
      wake: expect.objectContaining({
        eventId: "evt_replacement_pending_b",
        seq: "1",
      }),
    });
  });

  it("cleans up every committed wake after the cursor advances", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    const wakeProcessor = Reflect.get(runner, "wakeProcessor");

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("cleanupWakeAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    const cleanupWakeAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupWakeAfterCursorCommit",
    );
    const cleanupCommittedHostedWakesLocally = Reflect.get(
      runner,
      "cleanupCommittedHostedWakesLocally",
    );

    if (typeof cleanupCommittedHostedWakesLocally !== "function") {
      throw new Error("Expected HostedUserRunner cleanupCommittedHostedWakesLocally test helper.");
    }

    await cleanupCommittedHostedWakesLocally.call(runner, {
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        version: "1",
      }),
      wake: createWake("evt_batch_first"),
    });
    await cleanupCommittedHostedWakesLocally.call(runner, {
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        version: "2",
      }),
      wake: createWake("evt_batch_second"),
    });

    expect(readDispatchEventIdsFromSpy(cleanupWakeAfterCursorCommit)).toEqual([
      "evt_batch_first",
      "evt_batch_second",
    ]);
  });

  it("reconstructs direct message wake payloads into hosted runner dispatches", async () => {
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            kind: "conversation.message",
            payload: buildHostedExecutionLinqConversationMessageWake({
              eventId: "evt_linq_message",
              linqMessage: {
                chatId: "chat_123",
                from: "+15555550123",
                isFromMe: false,
                messageId: "msg_123",
                parts: [
                  {
                    type: "text",
                    value: "hello",
                  },
                ],
              },
              phoneLookupKey: "lookup_123",
              occurredAt: "2026-03-26T12:00:00.000Z",
              userId: "member_123",
            }),
            payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 0,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_linq_message"]);
  });

  it("reconstructs inline system wake payloads into hosted runner dispatches", async () => {
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "2",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payload: createWake("evt_inline_system"),
            payloadField: "hosted-wake-inline-payload",
            seq: "1",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      pendingWakeCount: 0,
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_inline_system"]);
  });

  it("returns targetReached false when the web cursor stays behind the requested seq", async () => {
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb.mockResolvedValueOnce({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "3",
        version: "cursor_v1",
      }),
      wakes: [],
    });

    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");

    await expect(
      runner.wakeHostedWakes({
        targetSeqHint: "2",
      }),
    ).resolves.toEqual({
      committedSeq: "1",
      requestedTargetSeq: "2",
      targetReached: false,
    });
  });
});

function createWake(eventId: string) {
  return buildHostedExecutionAssistantCronTickWake({
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
    reason: "manual",
    userId: "member_123",
  });
}

function createCursorState(overrides: Partial<{
  committedSeq: string;
  nextSeq: string;
  snapshotRef: HostedWakeSnapshotRef;
  updatedAt: string;
  version: string;
}> = {}): HostedExecutionCursorState {
  return {
    committedSeq: overrides.committedSeq ?? "0",
    createdAt: "2026-03-26T12:00:00.000Z",
    nextSeq: overrides.nextSeq ?? "1",
    snapshotRef: overrides.snapshotRef ?? null,
    updatedAt: overrides.updatedAt ?? "2026-03-26T12:00:00.000Z",
    userId: "member_123",
    version: overrides.version ?? "cursor_v1",
  };
}

function readSnapshotRef(snapshotRef: HostedWakeCommitRequest["snapshotRef"] | undefined): HostedWakeSnapshotRef {
  return snapshotRef ?? null;
}

function createBundleRef(id: string): NonNullable<HostedWakeSnapshotRef> {
  return {
    hash: `hash-${id}`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-03-26T12:00:02.000Z",
  };
}

function createHostedWakeRecord(input: {
  cursor?: Pick<HostedExecutionCursorState, "committedSeq" | "version">;
  kind?: HostedFetchedWakeRecord["kind"];
  occurredAt?: string;
  payloadField?: "hosted-wake-inline-payload" | "hosted-wake-ref-payload";
  payload?: unknown;
  payloadSchema?: HostedFetchedWakeRecord["payloadSchema"];
  quarantineCode?: string | null;
  quarantinedAt?: string | null;
  seq: string;
  wakeEventId?: string;
}): HostedFetchedWakeRecord {
  const wakeEventId = resolveTestWakeEventId(input);
  const payloadTransport = input.payload === undefined
    ? {}
    : encryptTestHostedWakePayload({
      field: input.payloadField ?? (
        input.kind === "conversation.message"
          ? "hosted-wake-inline-payload"
          : "hosted-wake-ref-payload"
      ),
      userId: "member_123",
      value: input.payload,
    });
  const base = {
    behavior: "ordered" as const,
    fetchProof: issueTestHostedWakeFetchProof({
      cursor: input.cursor ?? createCursorState(),
      wake: {
        eventId: wakeEventId,
        id: `wake_${input.seq}`,
        seq: input.seq,
        userId: "member_123",
      },
    }),
    createdAt: "2026-03-26T12:00:00.000Z",
    id: `wake_${input.seq}`,
    occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
    ...payloadTransport,
    ...(input.quarantineCode === undefined ? {} : { quarantineCode: input.quarantineCode }),
    ...(input.quarantinedAt === undefined ? {} : { quarantinedAt: input.quarantinedAt }),
    seq: input.seq,
    updatedAt: "2026-03-26T12:00:00.000Z",
    userId: "member_123",
  };

  if (input.kind === "conversation.message") {
    const payloadSchema = input.payloadSchema === HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA
      ? input.payloadSchema
      : HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA;
    return {
      ...base,
      kind: input.kind,
      payloadSchema,
    };
  }

  const payloadSchema = input.payloadSchema === HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA
    ? input.payloadSchema
    : HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA;
  return {
    ...base,
    kind: input.kind ?? "assistant.cron.tick",
    payloadSchema,
  };
}

function resolveTestWakeEventId(input: {
  payload?: unknown;
  seq: string;
  wakeEventId?: string;
}): string {
  if (input.wakeEventId) {
    return input.wakeEventId;
  }

  if (
    input.payload
    && typeof input.payload === "object"
    && "eventId" in input.payload
    && typeof input.payload.eventId === "string"
  ) {
    return input.payload.eventId;
  }

  return `evt_${input.seq}`;
}

async function createCommittedRunnerSuccessResponse(input: {
  init?: RequestInit;
}): Promise<Response> {
  const requestBody = parseJsonBody(input.init?.body);
  if (requestBody === null) {
    return Response.json({ ok: true });
  }
  const request = maybeReadRunnerJobRequest(requestBody);

  if (!request) {
    const commitRequest = requestBody as {
      committedSeq?: unknown;
      expectedVersion?: unknown;
    };

    if (
      typeof commitRequest.committedSeq === "string"
      && typeof commitRequest.expectedVersion === "string"
    ) {
      return Response.json({
        committed: true,
        cursor: createCursorState({
          committedSeq: commitRequest.committedSeq,
          nextSeq: commitRequest.committedSeq,
          version: "1",
        }),
      });
    }

    return Response.json({ ok: true });
  }

  return new Response(JSON.stringify(
    request.resume
      ? {
        finalGatewayProjectionSnapshot: null,
        phase: "completed" as const,
        result: {
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "handled",
          },
        },
      }
      : {
        committedAssistantDeliveryEffects: [],
        committedGatewayProjectionSnapshot: null,
        phase: "committed" as const,
        result: {
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "handled",
          },
        },
      },
  ), {
    status: 200,
  });
}

async function createCompletedRunnerSuccessResponse(input: {
  init?: RequestInit;
  omitPhase?: boolean;
}): Promise<Response> {
  const requestBody = parseJsonBody(input.init?.body);
  if (requestBody === null) {
    return Response.json({ ok: true });
  }
  const request = readRunnerJobRequest(requestBody);

  return new Response(JSON.stringify({
    ...(input.omitPhase ? {} : { phase: "completed" as const }),
    finalGatewayProjectionSnapshot: null,
    result: {
      bundle: Buffer.from(`vault:${request.wake.eventId}`).toString("base64"),
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
    },
  }), {
    status: 200,
  });
}

function readDispatchedEventIds(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.flatMap(([, init]) => {
    const requestBody = parseJsonBody(init?.body);
    const request = requestBody ? maybeReadRunnerJobRequest(requestBody) : null;

    return !request || request.resume ? [] : [request.wake.eventId];
  });
}

function parseJsonBody(body: RequestInit["body"] | null | undefined): unknown | null {
  if (typeof body !== "string" || body.length === 0) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function readDispatchEventIdsFromSpy(
  spy: ReturnType<typeof vi.spyOn>,
): string[] {
  return spy.mock.calls.flatMap((call: unknown[]) => {
    const input = call[0];

    if (
      !input
      || typeof input !== "object"
    ) {
      return [];
    }

    if (
      "wake" in input
      && input.wake
      && typeof input.wake === "object"
      && "eventId" in input.wake
      && typeof input.wake.eventId === "string"
    ) {
      return [input.wake.eventId];
    }

    return [];
  });
}

function maybeReadRunnerJobRequest(value: unknown): ReturnType<typeof readRunnerJobRequest> | null {
  try {
    return readRunnerJobRequest(value);
  } catch {
    return null;
  }
}

function readRunnerJobRequest(value: unknown): {
  currentBundleRef?: unknown;
  wake: {
    userId: string;
    eventId: string;
  };
  resume?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected hosted runner request payload to be an object.");
  }

  const record = value as {
    job?: {
      request?: unknown;
    };
  };
  const request = typeof record.job === "object" && record.job && "request" in record.job
    ? record.job.request
    : value;

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Expected hosted runner job request payload to be an object.");
  }

  const requestRecord = request as {
    resume?: unknown;
    wake?: {
      eventId?: string;
      userId?: string;
    };
  };
  const wake = requestRecord.wake ?? null;

  if (!wake?.eventId || !wake.userId) {
    throw new TypeError("Expected hosted runner job request to carry a wake.");
  }

  return {
    currentBundleRef: "currentBundleRef" in requestRecord
      ? requestRecord.currentBundleRef
      : undefined,
    resume: requestRecord.resume,
    wake: {
      eventId: wake.eventId,
      userId: wake.userId,
    },
  };
}

function createBucket() {
  const values = new Map<string, string>();

  return {
    api: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            const bytes = new TextEncoder().encode(value);
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
          },
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
    clear() {
      values.clear();
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();
  const runnerContainerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      return globalThis.fetch("https://runner-container.internal/internal/run", {
        body: await request.clone().text(),
        headers: {
          authorization: request.headers.get("authorization") ?? "",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
    }

    if (url.pathname === "/internal/destroy") {
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  });
  const runnerContainerNamespace = {
    getByName() {
      return {
        async destroyInstance() {
          await runnerContainerFetch(new Request("https://runner.internal/internal/destroy", {
            headers: {
              authorization: "Bearer runner-token",
            },
            method: "POST",
          }));
        },
        async invoke(payload: Record<string, unknown>) {
          const response = await runnerContainerFetch(new Request("https://runner.internal/internal/invoke", {
            body: JSON.stringify(payload),
            headers: {
              authorization: "Bearer runner-token",
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }));

          if (!response.ok) {
            throw new Error(`Runner container returned HTTP ${response.status}.`);
          }

          return await response.json();
        },
      };
    },
  };

  const state = {
    runnerContainerNamespace,
    storage: {
      async deleteAlarm(): Promise<void> {
        storage.lastAlarm = null;
      },
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async getAlarm(): Promise<number | null> {
        return storage.lastAlarm;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async setAlarm(value: number | Date): Promise<void> {
        storage.lastAlarm = value instanceof Date ? value.getTime() : value;
      },
      sql,
    },
  };
  const storage = {
    clear() {
      values.clear();
      storage.lastAlarm = null;
      sql.reset();
      runnerContainerFetch.mockClear();
    },
    lastAlarm: null as number | null,
    state,
  };

  return storage;
}

async function seedManagedUserCryptoForTest(
  runner: HostedUserRunner,
  userId: string,
  envOverride: HostedExecutionEnvironment = environment,
): Promise<void> {
  await runner.bootstrapUser(userId);
  await resolveHostedUserCryptoContextForTest({
    bucket,
    environment: envOverride,
    userId,
  });
}

async function resolveHostedUserCryptoContextForTest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  userId: string;
}) {
  const store = createHostedUserKeyStore({
    automationRecipientKeyId: input.environment.automationRecipientKeyId,
    automationRecipientPrivateKey: input.environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: input.environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: input.environment.automationRecipientPublicKey,
    bucket: input.bucket.api,
    envelopeEncryptionKey: input.environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: input.environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: input.environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: input.environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: input.environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: input.environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: input.environment.teeAutomationRecipientPublicKey,
  });
  await store.provisionManagedUserCryptoAtActivation(input.userId);
  return store.requireUserCryptoContext(input.userId);
}
