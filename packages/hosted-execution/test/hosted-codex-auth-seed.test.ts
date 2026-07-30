import { describe, expect, it } from "vitest";

import {
  HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH,
  HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH,
  HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES,
  HOSTED_CODEX_AUTH_SEED_UNAVAILABLE_REASONS,
} from "../src/runtime-control.ts";
import {
  parseHostedCodexAuthSeedRequest,
  parseHostedCodexAuthSeedResponse,
} from "../src/parsers.ts";
import {
  HOSTED_RUNTIME_CODEX_AUTH_SEED_PATH,
} from "../src/routes.ts";

const CONNECTION_VERSION = "hca_abcdefghijklmnop";
const EXPIRES_AT = "2026-07-21T20:00:00.000Z";

function availableSeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "available",
    connectionVersion: CONNECTION_VERSION,
    expiresAt: EXPIRES_AT,
    accessToken: "synthetic-access-value",
    chatgptAccountId: "account_123",
    ...overrides,
  };
}

describe("hosted Codex auth seed contract", () => {
  it("exports one bounded sensitive read route", () => {
    expect(HOSTED_RUNTIME_CODEX_AUTH_SEED_PATH).toBe(
      "/api/internal/hosted-runtime/codex-auth/seed",
    );
    expect(HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH).toBe(6_144);
    expect(HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH).toBe(256);
    expect(HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES).toBe(16_384);
  });

  it("parses an exact request and defaults legacy credential reads to true", () => {
    expect(parseHostedCodexAuthSeedRequest({
      schemaVersion: 1,
      includeCredentials: false,
      knownConnectionVersion: null,
    })).toEqual({
      schemaVersion: 1,
      includeCredentials: false,
      knownConnectionVersion: null,
    });
    expect(parseHostedCodexAuthSeedRequest({
      schemaVersion: 1,
      includeCredentials: true,
      knownConnectionVersion: CONNECTION_VERSION,
    })).toEqual({
      schemaVersion: 1,
      includeCredentials: true,
      knownConnectionVersion: CONNECTION_VERSION,
    });
    expect(parseHostedCodexAuthSeedRequest({
      schemaVersion: 1,
      knownConnectionVersion: null,
    })).toEqual({
      schemaVersion: 1,
      includeCredentials: true,
      knownConnectionVersion: null,
    });

    for (const invalid of [
      {},
      { schemaVersion: 2, includeCredentials: false, knownConnectionVersion: null },
      { schemaVersion: 1, includeCredentials: undefined, knownConnectionVersion: null },
      { schemaVersion: 1, includeCredentials: "false", knownConnectionVersion: null },
      { schemaVersion: 1, includeCredentials: false, knownConnectionVersion: 1 },
      { schemaVersion: 1, includeCredentials: false, knownConnectionVersion: "hca_too_short" },
      {
        schemaVersion: 1,
        includeCredentials: false,
        knownConnectionVersion: null,
        connectionVersion: CONNECTION_VERSION,
      },
    ]) {
      expect(() => parseHostedCodexAuthSeedRequest(invalid)).toThrow(TypeError);
    }
  });

  it("parses available, token-free metadata, unchanged, and unavailable responses", () => {
    expect(parseHostedCodexAuthSeedResponse(availableSeed())).toEqual(availableSeed());
    expect(parseHostedCodexAuthSeedResponse({
      schemaVersion: 1,
      status: "available_metadata",
      connectionVersion: CONNECTION_VERSION,
    })).toEqual({
      schemaVersion: 1,
      status: "available_metadata",
      connectionVersion: CONNECTION_VERSION,
    });
    expect(parseHostedCodexAuthSeedResponse({
      schemaVersion: 1,
      status: "unchanged",
      connectionVersion: CONNECTION_VERSION,
    })).toEqual({
      schemaVersion: 1,
      status: "unchanged",
      connectionVersion: CONNECTION_VERSION,
    });

    for (const reason of HOSTED_CODEX_AUTH_SEED_UNAVAILABLE_REASONS) {
      const connectionVersion = reason === "unconfigured" ? null : CONNECTION_VERSION;
      expect(parseHostedCodexAuthSeedResponse({
        schemaVersion: 1,
        status: "unavailable",
        connectionVersion,
        reason,
      })).toEqual({
        schemaVersion: 1,
        status: "unavailable",
        connectionVersion,
        reason,
      });
    }
  });

  it("rejects incomplete and mistyped response variants", () => {
    for (const invalid of [
      null,
      [],
      { schemaVersion: 1, status: "available", connectionVersion: CONNECTION_VERSION },
      availableSeed({ schemaVersion: 2 }),
      availableSeed({ connectionVersion: 1 }),
      { schemaVersion: 1, status: "unchanged", connectionVersion: null },
      { schemaVersion: 1, status: "unavailable", reason: "expired" },
      {
        schemaVersion: 1,
        status: "unavailable",
        connectionVersion: 1,
        reason: "expired",
      },
      { schemaVersion: 1, status: "unsupported", connectionVersion: CONNECTION_VERSION },
    ]) {
      expect(() => parseHostedCodexAuthSeedResponse(invalid)).toThrow(TypeError);
    }
  });

  it("rejects unknown credential fields and mixed response variants", () => {
    for (const field of [
      "refreshToken",
      "refresh_token",
      "idToken",
      "id_token",
      "tokens",
      "planType",
    ]) {
      expect(() => parseHostedCodexAuthSeedRequest({
        schemaVersion: 1,
        includeCredentials: false,
        knownConnectionVersion: null,
        [field]: "forbidden-value",
      })).toThrow(/not allowed/u);
      expect(() => parseHostedCodexAuthSeedResponse(availableSeed({
        [field]: "forbidden-value",
      }))).toThrow(/not allowed/u);
    }

    for (const [field, value] of [
      ["accessToken", "forbidden-value"],
      ["chatgptAccountId", "forbidden-account"],
      ["expiresAt", EXPIRES_AT],
    ]) {
      expect(() => parseHostedCodexAuthSeedResponse({
        schemaVersion: 1,
        status: "available_metadata",
        connectionVersion: CONNECTION_VERSION,
        [field]: value,
      })).toThrow(/not allowed/u);
    }
    expect(() => parseHostedCodexAuthSeedResponse({
      schemaVersion: 1,
      status: "unchanged",
      connectionVersion: CONNECTION_VERSION,
      accessToken: "forbidden-value",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedCodexAuthSeedResponse({
      schemaVersion: 1,
      status: "unavailable",
      connectionVersion: CONNECTION_VERSION,
      reason: "expired",
      expiresAt: EXPIRES_AT,
    })).toThrow(/not allowed/u);
  });

  it("bounds sensitive strings and accepts only canonical UTC expiry", () => {
    expect(parseHostedCodexAuthSeedResponse(availableSeed({
      accessToken: "a".repeat(HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH),
      chatgptAccountId: "b".repeat(HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH),
    })).status).toBe("available");
    const maximallyEscapedResponse = availableSeed({
      accessToken: "\\".repeat(HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH),
      chatgptAccountId: "\"".repeat(HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH),
    });
    expect(new TextEncoder().encode(JSON.stringify(maximallyEscapedResponse)).byteLength)
      .toBeLessThanOrEqual(HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES);

    for (const overrides of [
      { accessToken: "a".repeat(HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH + 1) },
      { accessToken: "contains whitespace" },
      { accessToken: "contains\ncontrol" },
      { chatgptAccountId: "b".repeat(HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH + 1) },
      { chatgptAccountId: "account with spaces" },
      { expiresAt: "2026-07-21T16:00:00.000-04:00" },
      { expiresAt: "2026-07-21T20:00:00Z" },
      { expiresAt: "2026-02-30T20:00:00.000Z" },
    ]) {
      expect(() => parseHostedCodexAuthSeedResponse(availableSeed(overrides))).toThrow(TypeError);
    }
  });

  it("fails closed without echoing rejected credential values", () => {
    const sentinel = "sensitive-sentinel-that-must-not-echo";
    let failure: unknown;
    try {
      parseHostedCodexAuthSeedResponse(availableSeed({
        accessToken: `${sentinel}\n`,
      }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).not.toContain(sentinel);

    expect(() => parseHostedCodexAuthSeedResponse({
      schemaVersion: 1,
      status: "unavailable",
      connectionVersion: CONNECTION_VERSION,
      reason: "superseded",
    })).toThrow(/not supported/u);
  });
});
