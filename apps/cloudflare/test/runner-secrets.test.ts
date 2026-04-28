import { describe, expect, it } from "vitest";

import {
  decodeHostedRunnerSecretsPayload,
} from "../src/runner-secrets.js";

const HOSTED_RUNNER_SECRETS_SCHEMA = "murph.hosted-runner-secrets.v1";

describe("hosted runner secrets payload decoding", () => {
  it("returns an empty record when no payload is stored", () => {
    expect(decodeHostedRunnerSecretsPayload(null)).toEqual({});
  });

  it("decodes the canonical hosted Codex model credential from the stored payload", () => {
    const payload = encodeRunnerSecretsPayload({
      VERCEL_AI_API_KEY: "sk-user",
    });

    expect(decodeHostedRunnerSecretsPayload(payload)).toEqual({
      VERCEL_AI_API_KEY: "sk-user",
    });
  });

  it("drops blank values during normalization", () => {
    const payload = encodeRunnerSecretsPayload({
      VERCEL_AI_API_KEY: "  ",
    });

    expect(decodeHostedRunnerSecretsPayload(payload)).toEqual({});
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
      AGENTMAIL_API_KEY: "agentmail-secret",
    }))).toThrow(/not allowed/u);

    expect(() => decodeHostedRunnerSecretsPayload(encodeRunnerSecretsPayload({
      NODE_OPTIONS: "--require /tmp/evil-loader.js",
    }), {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "NODE_OPTIONS",
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
        VERCEL_AI_API_KEY: 123,
      },
      schema: HOSTED_RUNNER_SECRETS_SCHEMA,
      updatedAt: "2026-03-26T12:00:00.000Z",
    }));

    expect(() => decodeHostedRunnerSecretsPayload(payload)).toThrow(
      "Hosted runner secret value for VERCEL_AI_API_KEY must be a string.",
    );
  });
});

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
