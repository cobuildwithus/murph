import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHostedExecutionVercelOidcValidationEnvironment } from "../src/auth-adapter.ts";
import type { HostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { RunnerPendingCommitCorruptionError } from "../src/user-runner/runner-state-store.js";
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

const TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES = Uint8Array.from({ length: 32 }, () => 5);
const TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION = "v1";

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

describe("HostedUserRunner pending commit corruption fencing", () => {
  const bucket = createBucket();
  const storage = createStorage();

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
  });

  it("refuses wake draining when pending_commit_json is corrupted", async () => {
    const fetchMock = vi.fn();
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
    storage.state.storage.sql.exec(
      "UPDATE runner_meta SET pending_commit_json = ? WHERE singleton = 1",
      "{",
    );

    await expect(runner.wakeHostedWakes()).rejects.toThrow(
      RunnerPendingCommitCorruptionError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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

  return {
    clear() {
      values.clear();
      sql.reset();
    },
    state: {
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
