import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

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
            payloadJson: createDispatch("evt_after_poison"),
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
      quarantineCode: "invalid-dispatch-payload",
      wakeId: "wake_1",
    }));
    expect(commitHostedWakeCursorToWeb.mock.calls.map(([input]) => input.body.committedSeq)).toEqual(["2"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_after_poison"]);
  });
});

function createDispatch(eventId: string) {
  return {
    event: {
      kind: "assistant.cron.tick" as const,
      reason: "manual" as const,
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
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
  payloadJson: unknown;
  seq: string;
}) {
  return {
    behavior: "ordered" as const,
    createdAt: "2026-03-26T12:00:00.000Z",
    id: `wake_${input.seq}`,
    kind: "assistant.cron.tick",
    occurredAt: "2026-03-26T12:00:00.000Z",
    payloadJson: input.payloadJson,
    payloadSchema: "murph.hosted-dispatch-payload.v1",
    seq: input.seq,
    updatedAt: "2026-03-26T12:00:00.000Z",
    userId: "member_123",
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

    return request.resume ? [] : [request.dispatch.eventId];
  });
}

function readRunnerJobRequest(value: unknown): {
  dispatch: {
    event: {
      userId: string;
    };
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

  return request as {
    dispatch: {
      event: {
        userId: string;
      };
      eventId: string;
    };
    resume?: unknown;
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
