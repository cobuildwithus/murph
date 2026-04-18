import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import type { HostedWakeRecord } from "@murphai/hosted-execution/contracts";

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
} from "./hosted-execution-fixtures.js";
import { createTestSqlStorage } from "./sql-storage.js";

const describe = baseDescribe.sequential;
const bucket = createBucket();
const storage = createStorage();
const environment: HostedExecutionEnvironment = {
  allowedRunnerSecretKeys: null,
  automationRecipientKeyId: TEST_AUTOMATION_RECIPIENT_KEY_ID,
  automationRecipientPrivateKey: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  automationRecipientPrivateKeysById: {
    [TEST_AUTOMATION_RECIPIENT_KEY_ID]: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  },
  automationRecipientPublicKey: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  maxEventAttempts: 3,
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
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "3",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            payloadJson: {
              invalid: true,
            },
            seq: "1",
          }),
          createHostedWakeRecord({
            payloadJson: createWake("evt_after_poison"),
            seq: "2",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "2",
          nextSeq: "3",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v3",
        }),
        wakes: [],
      });
    const quarantineHostedWakeInWeb = vi.spyOn(webControlPlane, "quarantineHostedWakeInWeb");
    quarantineHostedWakeInWeb.mockResolvedValue({
      quarantined: true,
    });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v3",
      }),
    });
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v3",
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

    expect(quarantineHostedWakeInWeb).toHaveBeenCalledWith(expect.objectContaining({
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_1",
    }));
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["2"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_poison"]);
  });

  it("advances past already-quarantined wakes before dispatching later rows", async () => {
    const fetchMock = vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchHostedWakeBatchFromWeb = vi.spyOn(webControlPlane, "fetchHostedWakeBatchFromWeb");
    fetchHostedWakeBatchFromWeb
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "0",
          nextSeq: "3",
          version: "cursor_v1",
        }),
        wakes: [
          createHostedWakeRecord({
            quarantineCode: "invalid-wake-payload",
            quarantinedAt: "2026-03-26T12:00:00.500Z",
            seq: "1",
          }),
          createHostedWakeRecord({
            payloadJson: createWake("evt_after_quarantine"),
            seq: "2",
          }),
        ],
      })
      .mockResolvedValueOnce({
        cursor: createCursorState({
          committedSeq: "2",
          nextSeq: "3",
          updatedAt: "2026-03-26T12:00:02.000Z",
          version: "cursor_v2",
        }),
        wakes: [],
      });
    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
    });
    const quarantineHostedWakeInWeb = vi.spyOn(webControlPlane, "quarantineHostedWakeInWeb");
    const readHostedWakeStatusFromWeb = vi.spyOn(webControlPlane, "readHostedWakeStatusFromWeb");
    readHostedWakeStatusFromWeb.mockResolvedValue({
      cursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
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

    expect(quarantineHostedWakeInWeb).not.toHaveBeenCalled();
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["2"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_quarantine"]);
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
            payloadJson: createWake("evt_stale_commit"),
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

    if (
      !wakeProcessor
      || typeof wakeProcessor !== "object"
      || !("finalizeNativeWakeDispatchAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    const finalizeNativeWakeDispatchAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "finalizeNativeWakeDispatchAfterCursorCommit",
    );

    await runner.wakeHostedWakes();

    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["1"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_stale_commit"]);
    expect(finalizeNativeWakeDispatchAfterCursorCommit).not.toHaveBeenCalled();
  });

  it("finalizes every committed wake before local cleanup after the cursor advances", async () => {
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
      || !("finalizeNativeWakeDispatchAfterCursorCommit" in wakeProcessor)
      || !("cleanupNativeWakeDispatchAfterCursorCommit" in wakeProcessor)
    ) {
      throw new Error("Expected HostedUserRunner wake processor test internals to be available.");
    }

    const finalizeNativeWakeDispatchAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "finalizeNativeWakeDispatchAfterCursorCommit",
    );
    const cleanupNativeWakeDispatchAfterCursorCommit = vi.spyOn(
      wakeProcessor,
      "cleanupNativeWakeDispatchAfterCursorCommit",
    );
    finalizeNativeWakeDispatchAfterCursorCommit.mockResolvedValue({
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_batch_second",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
    });

    const finalizeCommittedHostedWakesLocally = Reflect.get(runner, "finalizeCommittedHostedWakesLocally");

    if (typeof finalizeCommittedHostedWakesLocally !== "function") {
      throw new Error("Expected HostedUserRunner finalizeCommittedHostedWakesLocally test helper.");
    }

    await finalizeCommittedHostedWakesLocally.call(runner, {
      committedCursor: createCursorState({
        committedSeq: "2",
        nextSeq: "3",
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v2",
      }),
      wakes: [
        {
          wake: createWake("evt_batch_first"),
          seq: 1n,
          state: "completed",
        },
        {
          wake: createWake("evt_batch_second"),
          seq: 2n,
          state: "completed",
        },
      ],
    });

    expect(readDispatchEventIdsFromSpy(finalizeNativeWakeDispatchAfterCursorCommit)).toEqual([
      "evt_batch_first",
      "evt_batch_second",
    ]);
    expect(readDispatchEventIdsFromSpy(cleanupNativeWakeDispatchAfterCursorCommit)).toEqual([
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
            payloadJson: {
              eventId: "evt_linq_message",
              ...buildHostedExecutionLinqConversationMessageWake({
                eventId: "evt_linq_message",
                linqEvent: {
                  id: "msg_123",
                  parts: [
                    {
                      type: "text",
                      value: "hello",
                    },
                  ],
                },
                linqMessageId: "msg_123",
                phoneLookupKey: "lookup_123",
                occurredAt: "2026-03-26T12:00:00.000Z",
                userId: "member_123",
              }).message,
            },
            payloadSchema: HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
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

    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_linq_message"]);
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
  updatedAt: string;
  version: string;
}> = {}) {
  return {
    committedSeq: overrides.committedSeq ?? "0",
    createdAt: "2026-03-26T12:00:00.000Z",
    nextSeq: overrides.nextSeq ?? "1",
    snapshotRef: null,
    updatedAt: overrides.updatedAt ?? "2026-03-26T12:00:00.000Z",
    userId: "member_123",
    version: overrides.version ?? "cursor_v1",
  };
}

function createHostedWakeRecord(input: {
  kind?: HostedWakeRecord["kind"];
  occurredAt?: string;
  payloadJson?: unknown;
  payloadSchema?: HostedWakeRecord["payloadSchema"];
  quarantineCode?: string | null;
  quarantinedAt?: string | null;
  seq: string;
}): HostedWakeRecord {
  const base = {
    behavior: "ordered" as const,
    createdAt: "2026-03-26T12:00:00.000Z",
    id: `wake_${input.seq}`,
    occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
    ...(input.payloadJson === undefined ? {} : { payloadJson: input.payloadJson }),
    ...(input.quarantineCode === undefined ? {} : { quarantineCode: input.quarantineCode }),
    ...(input.quarantinedAt === undefined ? {} : { quarantinedAt: input.quarantinedAt }),
    seq: input.seq,
    updatedAt: "2026-03-26T12:00:00.000Z",
    userId: "member_123",
  };

  if (input.kind === "conversation.message") {
    const payloadSchema = input.payloadSchema === HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA
      ? input.payloadSchema
      : HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA;
    return {
      ...base,
      kind: input.kind,
      payloadSchema,
    };
  }

  const payloadSchema = input.payloadSchema === HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA
    ? input.payloadSchema
    : HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA;
  return {
    ...base,
    kind: input.kind ?? "assistant.cron.tick",
    payloadSchema,
  };
}

async function createCommittedRunnerSuccessResponse(input: {
  init?: RequestInit;
}): Promise<Response> {
  const requestBody = JSON.parse(String(input.init?.body));

  return new Response(JSON.stringify(
    readRunnerJobRequest(requestBody).resume
      ? {
        finalGatewayProjectionSnapshot: null,
        phase: "completed" as const,
        result: {
          bundle: null,
          result: {
            ok: true,
            output: "handled",
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
            ok: true,
            output: "handled",
          },
        },
      },
  ), {
    status: 200,
  });
}

function readDispatchedEventIds(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.flatMap(([, init]) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const request = readRunnerJobRequest(JSON.parse(body));

    return request.resume ? [] : [request.wake.eventId];
  });
}

function readDispatchEventIdsFromSpy(
  spy: ReturnType<typeof vi.spyOn>,
): string[] {
  return spy.mock.calls.map((call: unknown[]) => {
    const input = call[0];

    if (
      !input
      || typeof input !== "object"
    ) {
      throw new TypeError("Expected a wake payload with an eventId.");
    }

    if (
      "wake" in input
      && input.wake
      && typeof input.wake === "object"
      && "eventId" in input.wake
      && typeof input.wake.eventId === "string"
    ) {
      return input.wake.eventId;
    }

    throw new TypeError("Expected a wake payload with an eventId.");
  });
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
      return globalThis.fetch("https://runner-container.internal/__internal/run", {
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

  return {
    clear() {
      values.clear();
      sql.reset();
      runnerContainerFetch.mockClear();
    },
    state: {
      runnerContainerNamespace,
      storage: {
        async deleteAlarm(): Promise<void> {},
        async get<T>(key: string): Promise<T | undefined> {
          return values.get(key) as T | undefined;
        },
        async getAlarm(): Promise<number | null> {
          return null;
        },
        async put<T>(key: string, value: T): Promise<void> {
          values.set(key, value);
        },
        async setAlarm(_value: number | Date): Promise<void> {},
        sql,
      },
    },
  };
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
