import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedWakeCommitRequest,
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

  it("advances past poisoned hosted wake rows so later wakes still run", async () => {
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
    const poisonedWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: {
        invalid: true,
      },
      seq: "1",
    });
    const staleFollowingWake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_after_poison"),
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
      payload: createWake("evt_after_poison"),
      seq: "2",
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
          poisonedWake,
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
      fetchProof: poisonedWake.fetchProof,
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_1",
      wakeSeq: "1",
    }));
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
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_poison"]);
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
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
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
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
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
      };
    });
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
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
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb
      .mockRejectedValueOnce(new webControlPlane.HostedWakeTerminalStaleFetchProofError())
      .mockResolvedValueOnce({
        recorded: true,
      });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValueOnce({
      cursor: rewrittenCursor,
      pendingWakeCount: 1,
      replacedByEventId: "evt_fresh_terminal",
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
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        eventId: "evt_stale_terminal",
      },
      boundUserId: "member_123",
    }));
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
      payload: createWake("evt_fresh_terminal"),
      seq: "1",
      wakeEventId: "evt_fresh_terminal",
    });
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
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
    readHostedWakeStatusFromWeb.mockResolvedValueOnce({
      cursor: rewrittenCursor,
      pendingWakeCount: 1,
      replacedByEventId: "evt_fresh_terminal",
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
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        eventId: "evt_stale_terminal",
      },
      boundUserId: "member_123",
    }));
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
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
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
    }));
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb
      .mockRejectedValueOnce(new Error("terminal callback timed out"))
      .mockResolvedValueOnce({
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
    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).resume)
      .toBeUndefined();
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).resume)
      .not.toBeUndefined();
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
    const fetchMock = vi.fn(async (_url, init) => {
      const request = readRunnerJobRequest(JSON.parse(String(init?.body)));
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

      if (commitBodies.length === 1) {
        return {
          committed: true,
          cursor: createCursorState({
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: readSnapshotRef(body.snapshotRef),
            updatedAt: "2026-03-26T12:00:01.000Z",
            version: "cursor_v2",
          }),
        };
      }

      return {
        committed: true,
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const fetchMock = vi.fn(async (url, init) => {
      const requestEnvelope = url instanceof Request ? url : new Request(String(url), init);
      const request = readRunnerJobRequest(JSON.parse(await requestEnvelope.clone().text()));

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

    await runner.wakeHostedWakes();

    expect(recordHostedWakeTerminalInWeb).toHaveBeenCalledOnce();
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_finalize_after_cas"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).resume).toEqual({
      committedResult: {
        assistantDeliveryEffects: [],
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "committed",
        },
      },
    });
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(commitBodies[1]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v2",
    });
    expect(commitBodies[0]?.snapshotRef).not.toEqual(commitBodies[1]?.snapshotRef);
  });

  it("treats a same-seq finalized snapshot publish lost race as success when the cursor already matches", async () => {
    const commitBodies: HostedWakeCommitRequest[] = [];
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

      if (commitBodies.length === 1) {
        return {
          committed: true,
          cursor: createCursorState({
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: readSnapshotRef(body.snapshotRef),
            updatedAt: "2026-03-26T12:00:01.000Z",
            version: "cursor_v2",
          }),
        };
      }

      return {
        committed: false,
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: readSnapshotRef(body.snapshotRef),
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const fetchMock = vi.fn(async (_url, init) => {
      const request = readRunnerJobRequest(JSON.parse(String(init?.body)));

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readDispatchedEventIds(fetchMock)).toEqual([
      "evt_finalize_after_cas_same_seq_race",
    ]);
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).resume).toEqual({
      committedResult: {
        assistantDeliveryEffects: [],
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "committed",
        },
      },
    });
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(commitBodies[1]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v2",
    });
    expect(commitBodies[1]?.snapshotRef).not.toEqual(commitBodies[0]?.snapshotRef);
    expect(cleanupWakeAfterCursorCommit).toHaveBeenCalledOnce();
  });

  it("keeps the finalized pending commit when a same-seq snapshot publish loses CAS to a different snapshot", async () => {
    const commitBodies: HostedWakeCommitRequest[] = [];
    const winnerBundleRef = createBundleRef("winner-conflict");
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

      if (commitBodies.length === 1) {
        return {
          committed: true,
          cursor: createCursorState({
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: readSnapshotRef(body.snapshotRef),
            updatedAt: "2026-03-26T12:00:01.000Z",
            version: "cursor_v2",
          }),
        };
      }

      return {
        committed: false,
        cursor: createCursorState({
          committedSeq: "1",
          nextSeq: "2",
          snapshotRef: winnerBundleRef,
          updatedAt: "2026-03-26T12:00:03.000Z",
          version: "cursor_v3",
        }),
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const fetchMock = vi.fn(async (_url, init) => {
      const request = readRunnerJobRequest(JSON.parse(String(init?.body)));

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[0]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v1",
    });
    expect(commitBodies[1]).toMatchObject({
      committedSeq: "1",
      expectedVersion: "cursor_v2",
    });
    expect(commitBodies[1]?.snapshotRef).not.toEqual(commitBodies[0]?.snapshotRef);
    expect(cleanupWakeAfterCursorCommit).not.toHaveBeenCalled();
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_finalize_after_cas_conflict",
      finalizedAt: expect.any(String),
    });
  });

  it("reschedules alarm-driven cleanup when finalized snapshot publish loses CAS and leaves a pending commit behind", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const winnerBundleRef = createBundleRef("winner-conflict");
    const commitBodies: HostedWakeCommitRequest[] = [];
    const initialCursor = createCursorState({
      committedSeq: "0",
      nextSeq: "2",
      version: "cursor_v1",
    });
    const winnerCursor = createCursorState({
      committedSeq: "1",
      nextSeq: "2",
      snapshotRef: winnerBundleRef,
      updatedAt: "2026-03-26T12:00:03.000Z",
      version: "cursor_v3",
    });
    const wake = createHostedWakeRecord({
      cursor: initialCursor,
      payload: createWake("evt_alarm_finalize_retry"),
      seq: "1",
      wakeEventId: "evt_alarm_finalize_retry",
    });
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: initialCursor,
        wakes: [wake],
      })
      .mockResolvedValueOnce({
        cursor: winnerCursor,
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockImplementation(async ({ body }) => {
      commitBodies.push(body);

      if (commitBodies.length === 1) {
        return {
          committed: true,
          cursor: createCursorState({
            committedSeq: "1",
            nextSeq: "2",
            snapshotRef: readSnapshotRef(body.snapshotRef),
            updatedAt: "2026-03-26T12:00:01.000Z",
            version: "cursor_v2",
          }),
        };
      }

      return {
        committed: false,
        cursor: winnerCursor,
      };
    });
    const recordHostedWakeTerminalInWeb = vi.spyOn(webControlPlane, "recordHostedWakeTerminalInWeb");
    recordHostedWakeTerminalInWeb.mockResolvedValue({
      recorded: true,
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValueOnce({
      cursor: winnerCursor,
      pendingWakeCount: 0,
    });
    const fetchMock = vi.fn(async (_url, init) => {
      const request = readRunnerJobRequest(JSON.parse(String(init?.body)));

      if (!request.resume) {
        return new Response(JSON.stringify({
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "committed" as const,
          result: {
            bundle: Buffer.from("vault:committed-alarm").toString("base64"),
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
          bundle: Buffer.from("vault:final-alarm").toString("base64"),
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
    expect(commitBodies).toHaveLength(2);
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_alarm_finalize_retry",
      finalizedAt: expect.any(String),
    });

    vi.setSystemTime(new Date("2026-03-26T12:00:05.000Z"));
    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
    expect(readHostedWakeStatusFromWeb).toHaveBeenCalledOnce();
    expect(fetchHostedWakeBatchFromWeb).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).resume)
      .toBeUndefined();
    expect(readRunnerJobRequest(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).resume)
      .not.toBeUndefined();
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
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
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
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
  const requestBody = JSON.parse(String(input.init?.body));
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
  const requestBody = JSON.parse(String(input.init?.body));
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
    const body = typeof init?.body === "string" ? init.body : "";
    const request = maybeReadRunnerJobRequest(JSON.parse(body));

    return !request || request.resume ? [] : [request.wake.eventId];
  });
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
