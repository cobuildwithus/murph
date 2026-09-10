import { describe, expect, it, vi } from "vitest";

import {
  decodeHostedRunnerSecretsPayload,
} from "../src/runner-secrets.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { writeEncryptedR2Payload } from "../src/crypto.js";
import { hostedRunnerSecretsObjectKey } from "../src/storage-paths.js";
import { RunnerSecretsService } from "../src/user-runner/runner-secrets.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

const HOSTED_RUNNER_SECRETS_SCHEMA = "murph.hosted-runner-secrets.v1";

describe("hosted runner secrets reads", () => {
  it.each([
    undefined,
    "",
    " , \n , ",
    "OPENAI_API_KEY, NODE_OPTIONS, HOSTED_EXECUTION_CONTROL_TOKEN",
  ])("skips unavailable storage when no permitted keys are configured: %s", async (allowedKeys) => {
    const bucket = new MemoryEncryptedR2Bucket();
    const get = vi.spyOn(bucket, "get").mockRejectedValue(new Error("Storage unavailable"));

    await expect(createRunnerSecretsService(bucket, allowedKeys).readRunnerSecrets("member_test"))
      .resolves.toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it("ignores a corrupt stored object when the capability is disabled", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    await bucket.put(await hostedRunnerSecretsObjectKey({ userId: "member_test" }), "corrupt envelope");
    const get = vi.spyOn(bucket, "get");

    await expect(createRunnerSecretsService(bucket).readRunnerSecrets("member_test"))
      .resolves.toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it("reads and decrypts configured custom secrets with the existing allowlist normalization", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    await writeRunnerSecrets(bucket, { CUSTOM_API_KEY: "custom-secret" });
    const get = vi.spyOn(bucket, "get");

    await expect(createRunnerSecretsService(bucket, " custom_api_key, OPENAI_API_KEY ")
      .readRunnerSecrets("member_test")).resolves.toEqual({ CUSTOM_API_KEY: "custom-secret" });
    expect(get).toHaveBeenCalledOnce();
  });

  it("still rejects forbidden stored keys when custom secrets are enabled", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    await writeRunnerSecrets(bucket, { OPENAI_API_KEY: "forbidden-secret" });
    const get = vi.spyOn(bucket, "get");

    await expect(createRunnerSecretsService(bucket, "CUSTOM_API_KEY")
      .readRunnerSecrets("member_test")).rejects.toThrow("Hosted runner secret key is not allowed: OPENAI_API_KEY");
    expect(get).toHaveBeenCalledOnce();
  });

  it("still fails when storage is unavailable for configured custom secrets", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const get = vi.spyOn(bucket, "get").mockRejectedValue(new Error("Storage unavailable"));

    await expect(createRunnerSecretsService(bucket, "CUSTOM_API_KEY")
      .readRunnerSecrets("member_test")).rejects.toThrow("Storage unavailable");
    expect(get).toHaveBeenCalledOnce();
  });
});

describe("hosted runner secrets payload decoding", () => {
  it("returns an empty record when no payload is stored", () => {
    expect(decodeHostedRunnerSecretsPayload(null)).toEqual({});
  });

  it("decodes explicitly allowlisted custom secrets from the stored payload", () => {
    const payload = encodeRunnerSecretsPayload({
      CUSTOM_API_KEY: "custom-secret",
    });

    expect(decodeHostedRunnerSecretsPayload(payload, {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
    })).toEqual({
      CUSTOM_API_KEY: "custom-secret",
    });
  });

  it("drops blank values during normalization", () => {
    const payload = encodeRunnerSecretsPayload({
      CUSTOM_API_KEY: "  ",
    });

    expect(decodeHostedRunnerSecretsPayload(payload, {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
    })).toEqual({});
  });

  it("accepts extension-only keys only when the same allowlist source is provided on read", () => {
    const payload = encodeRunnerSecretsPayload({
      CUSTOM_API_KEY: "custom-secret",
    });

    expect(decodeHostedRunnerSecretsPayload(payload, {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
    })).toEqual({
      CUSTOM_API_KEY: "custom-secret",
    });
  });

  it("rejects removed or disallowed keys even if they are present in stored payloads", () => {
    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      OPENAI_API_KEY: "openai-user-secret",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
    })).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      UNLISTED_PROVIDER_API_KEY: "provider-secret",
    }))).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      NODE_OPTIONS: "--require /tmp/evil-loader.js",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "NODE_OPTIONS",
    })).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      CODEX_HOME: "/tmp/member-codex-home",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CODEX_HOME",
    })).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      NODE_EXTRA_CA_CERTS: "/tmp/custom-ca.pem",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "NODE_EXTRA_CA_CERTS",
    })).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      NPM_CONFIG_USERCONFIG: "/tmp/npmrc",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "NPM_CONFIG_USERCONFIG",
    })).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      TMPDIR: "/tmp/tenant-controlled",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "TMPDIR",
    })).toThrow(/not allowed/u);
  });

  it("rejects legacy schemas", () => {
    const payload = encodeRunnerSecretsPayload(
      {
        VENICE_API_KEY: "venice-user",
      },
      "healthybob.hosted-user-env.v1",
    );

    expect(() => decodeHostedRunnerSecretsPayload(payload)).toThrow("Hosted runner secrets config is invalid.");
  });

  it("rejects invalid secret value types", () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      env: {
        OPENAI_API_KEY: 123,
      },
      schema: HOSTED_RUNNER_SECRETS_SCHEMA,
      updatedAt: "2026-03-26T12:00:00.000Z",
    }));

    expect(() => decodeHostedRunnerSecretsPayload(payload)).toThrow(
      "Hosted runner secret value for OPENAI_API_KEY must be a string.",
    );
  });
});

function createRunnerSecretsService(
  bucket: MemoryEncryptedR2Bucket,
  allowedKeys?: string,
): RunnerSecretsService {
  return new RunnerSecretsService(
    bucket,
    createTestRootKey(),
    "test-root",
    { "test-root": createTestRootKey() },
    async () => null,
    { HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: allowedKeys },
  );
}

async function writeRunnerSecrets(
  bucket: MemoryEncryptedR2Bucket,
  env: Record<string, string>,
): Promise<void> {
  const userId = "member_test";
  const key = await hostedRunnerSecretsObjectKey({ userId });
  await writeEncryptedR2Payload({
    aad: buildHostedStorageAad({ key, purpose: "runner-secrets", userId }),
    bucket,
    cryptoKey: createTestRootKey(),
    key,
    keyId: "test-root",
    plaintext: encodeRunnerSecretsPayload(env),
    scope: "runner-secrets",
  });
}

function encodeRunnerSecretsPayload(
  env: Record<string, string>,
  schema = HOSTED_RUNNER_SECRETS_SCHEMA,
): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({
    env,
    schema,
    updatedAt: "2026-03-26T12:00:00.000Z",
  }, null, 2)}\n`);
}
