import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.js";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";

const REMOVED_BUNDLE_KEY_ALIAS = ["HB", "HOSTED", "BUNDLE", "KEY"].join("_");

describe("readHostedExecutionEnvironment", () => {
  it("reads required values and defaults", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
    }));

    expect(environment.bundleEncryptionKey).toHaveLength(32);
    expect(environment.bundleEncryptionKeysById).toEqual({
      v1: environment.bundleEncryptionKey,
    });
    expect(environment.bundleEncryptionKeyId).toBe("v1");
    expect(environment.controlSigningSecret).toBe("dispatch-secret");
    expect(environment.defaultAlarmDelayMs).toBe(15 * 60 * 1000);
    expect(environment.maxEventAttempts).toBe(3);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerTimeoutMs).toBe(60_000);
  });

  it("prefers a dedicated control signing secret when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_CONTROL_SIGNING_SECRET: "control-secret",
    }));

    expect(environment.controlSigningSecret).toBe("control-secret");
    expect(environment.dispatchSigningSecret).toBe("dispatch-secret");
  });

  it("reads the runner timeout when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "15000",
    }));

    expect(environment.runnerTimeoutMs).toBe(15_000);
  });

  it("reads optional user env allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY,TELEGRAM_BOT_TOKEN",
    }));

    expect(environment.allowedUserEnvKeys).toBe("OPENAI_API_KEY,TELEGRAM_BOT_TOKEN");
  });

  it("reads optional bundle decryption keyrings", () => {
    const previousKey = Buffer.alloc(32, 8).toString("base64");
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON: JSON.stringify({
        legacy: previousKey,
      }),
    }));

    expect(Object.keys(environment.bundleEncryptionKeysById).sort()).toEqual(["legacy", "v1"]);
    expect(environment.bundleEncryptionKeysById.legacy).toEqual(Uint8Array.from(Buffer.alloc(32, 8)));
    expect(environment.bundleEncryptionKeysById.v1).toEqual(Uint8Array.from(Buffer.alloc(32, 9)));
  });

  it("rejects malformed bundle keyrings", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON: "[1,2,3]",
      })),
    ).toThrow(/must be a JSON object/u);
  });

  it("rejects bundle keyrings that conflict with the active key id", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON: JSON.stringify({
          v1: Buffer.alloc(32, 7).toString("base64"),
        }),
      })),
    ).toThrow(/must match the current bundle encryption key/u);
  });

  it("does not accept the removed bundle-key alias", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        [REMOVED_BUNDLE_KEY_ALIAS]: Buffer.alloc(32, 9).toString("base64"),
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: undefined,
      } as Record<string, string | undefined>)),
    ).toThrow(/HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY/u);
  });

  it("does not accept the removed Cloudflare signing-secret alias", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
        HOSTED_EXECUTION_SIGNING_SECRET: undefined,
      } as Record<string, string | undefined>)),
    ).toThrow(/HOSTED_EXECUTION_SIGNING_SECRET/u);
  });
});
