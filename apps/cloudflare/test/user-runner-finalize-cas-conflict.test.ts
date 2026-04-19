import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
} from "@murphai/hosted-execution";

import { createHostedExecutionVercelOidcValidationEnvironment } from "../src/auth-adapter.ts";
import type { HostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import * as webControlPlane from "../src/web-control-plane.ts";
import {
  TEST_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
  TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_RECOVERY_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK as TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
  TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  encryptTestHostedWakePayload,
} from "./hosted-execution-fixtures.js";
import { createTestSqlStorage } from "./sql-storage.js";

const describe = baseDescribe.sequential;
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
  hostedWakeEncryption: {
    key: Uint8Array.from(TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES),
    keyVersion: TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
    keysByVersion: {
      [TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION]: Uint8Array.from(TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES),
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

describe("HostedUserRunner finalize cleanup CAS conflicts", () => {
  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps a finalized DO-local pending commit when a duplicate finalize already won the snapshot-only CAS", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      createBucket().api,
      {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
    );
    await runner.bootstrapUser("member_123");
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

    if (typeof writePendingCommit !== "function" || typeof readPendingCommit !== "function") {
      throw new Error("Expected HostedUserRunner state store pending commit helpers.");
    }

    const finalBundleRef = {
      hash: "final-duplicate-hash",
      key: "bundles/vault/final-duplicate.bundle.json",
      size: 144,
      updatedAt: "2026-03-26T12:00:01.000Z",
    };
    const committedBundleRef = {
      hash: "committed-duplicate-hash",
      key: "bundles/vault/committed-duplicate.bundle.json",
      size: 96,
      updatedAt: "2026-03-26T12:00:00.500Z",
    };
    const duplicateFinalizeWake = createWake("evt_cleanup_duplicate_snapshot");
    const { payloadCiphertext } = encryptTestHostedWakePayload({
      userId: "member_123",
      value: duplicateFinalizeWake,
    });
    await writePendingCommit.call(stateStore, {
      assistantDeliveryEffects: [],
      bundleRef: finalBundleRef,
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: "evt_cleanup_duplicate_snapshot",
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "handled",
      },
      schemaVersion: 1,
      userId: "member_123",
      wake: {
        eventId: "evt_cleanup_duplicate_snapshot",
        kind: "assistant.cron.tick",
        occurredAt: "2026-03-26T12:00:00.000Z",
        payloadCiphertext,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "1",
        userId: "member_123",
      },
    });

    const commitHostedWakeCursorToWeb = vi.spyOn(webControlPlane, "commitHostedWakeCursorToWeb");
    commitHostedWakeCursorToWeb.mockResolvedValueOnce({
      committed: false,
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: finalBundleRef,
        updatedAt: "2026-03-26T12:00:02.000Z",
        version: "cursor_v3",
      }),
    });

    const conflictedCursor = await wakeProcessor.cleanupWakeAfterCursorCommit({
      cursor: createCursorState({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: committedBundleRef,
        updatedAt: "2026-03-26T12:00:01.500Z",
        version: "cursor_v2",
      }),
      wake: duplicateFinalizeWake,
    });

    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    expect(commitHostedWakeCursorToWeb.mock.calls[0]?.[0].body).toEqual({
      committedSeq: "1",
      expectedVersion: "cursor_v2",
      snapshotRef: finalBundleRef,
    });
    expect(conflictedCursor).toMatchObject({
      committedSeq: "1",
      snapshotRef: finalBundleRef,
      version: "cursor_v3",
    });
    await expect(readPendingCommit.call(stateStore)).resolves.toMatchObject({
      eventId: "evt_cleanup_duplicate_snapshot",
      finalizedAt: "2026-03-26T12:00:01.000Z",
    });

    const reconciledCursor = await wakeProcessor.cleanupWakeAfterCursorCommit({
      cursor: conflictedCursor,
      wake: duplicateFinalizeWake,
    });

    expect(reconciledCursor).toMatchObject({
      committedSeq: "1",
      snapshotRef: finalBundleRef,
      version: "cursor_v3",
    });
    expect(commitHostedWakeCursorToWeb).toHaveBeenCalledTimes(1);
    await expect(readPendingCommit.call(stateStore)).resolves.toBeNull();
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
  snapshotRef: unknown;
  updatedAt: string;
  version: string;
}> = {}) {
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
