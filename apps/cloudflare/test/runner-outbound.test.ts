import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "@murphai/hosted-execution";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { createHostedUserKeyStore } from "../src/user-key-store.ts";

const describe = baseDescribe.sequential;

const RUNNER_PROXY_TOKEN = "proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";

describe("handleRunnerOutboundRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects internal worker proxy traffic that is missing the per-run proxy token", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects internal worker proxy traffic when the per-run proxy token does not match", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: {
          [RUNNER_PROXY_TOKEN_HEADER]: "proxy-tokez",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("handles device-sync runtime requests locally and binds them to the authenticated user", async () => {
    const getDeviceSyncRuntimeSnapshot = vi.fn(async (input: { request: { userId: string } }) => ({
      connections: [],
      generatedAt: "2026-04-05T00:00:00.000Z",
      userId: input.request.userId,
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async commit() {
                throw new Error("not used");
              },
              getDeviceSyncRuntimeSnapshot,
            };
          },
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: "2026-04-05T00:00:00.000Z",
      userId: "member_123",
    });
    expect(getDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith({
      request: {
        provider: "oura",
        userId: "member_123",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not depend on hosted-web allowlists for local device-sync runtime paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: expect.any(String),
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bootstraps the bound user through the runner lane before local crypto-backed runtime reads", async () => {
    const bootstrapUser = vi.fn(async (userId: string) => ({ userId }));

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async commit() {
                throw new Error("not used");
              },
              bootstrapUser,
              async getDeviceSyncRuntimeSnapshot(input: { request: { userId: string } }) {
                return {
                  connections: [],
                  generatedAt: "2026-04-05T00:00:00.000Z",
                  userId: input.request.userId,
                };
              },
            };
          },
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(bootstrapUser).toHaveBeenCalledTimes(1);
    expect(bootstrapUser).toHaveBeenCalledWith("member_123");
  });

  it("keeps device-sync runtime routes local even when deprecated hosted-web vars are present", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: expect.any(String),
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies hosted device connect-link requests through hosted web with the Cloudflare callback signature", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/providers/whoop/connect-link", {
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example.test/api/internal/device-sync/providers/whoop/connect-link",
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect((requestHeaders as Headers).get("authorization")).toBeNull();
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
    expect((requestHeaders as Headers).get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("v1");
    expect((requestHeaders as Headers).get(HOSTED_EXECUTION_NONCE_HEADER)).toMatch(/^[a-f0-9]{32}$/u);
    expect((requestHeaders as Headers).get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect((requestHeaders as Headers).get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("returns 404 when a share pack has not been published for the bound user", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share.worker/internal/shares/share_123/payload", {
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the removed legacy hosted share payload route disabled", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share-pack.worker/api/hosted-share/internal/share_123/payload", {
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records hosted AI usage locally instead of proxying through hosted web", async () => {
    const putPendingUsage = vi.fn(async (input: { usage: Array<{ usageId?: string }> }) => ({
      recorded: input.usage.length,
      usageIds: input.usage.map((entry) => entry.usageId ?? "missing"),
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recorded: 1,
      usageIds: ["usage_123"],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://usage.worker/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          usage: [
            {
              usageId: "usage_123",
            },
          ],
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async commit() {
                throw new Error("not used");
              },
              putPendingUsage,
            };
          },
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 1,
      usageIds: ["usage_123"],
    });
    expect(putPendingUsage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects side-effect writes when the route effect id and payload effect id differ", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/effects/outbox_123", {
        body: JSON.stringify({
          effectId: "outbox_999",
          fingerprint: "dedupe_123",
          intentId: "outbox_123",
          kind: "assistant.delivery",
          recordedAt: "2026-03-26T12:00:05.000Z",
          state: "prepared",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "PUT",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "effectId mismatch: expected outbox_123, received outbox_999.",
    });
  });
});

function createRunnerProxyHeaders(headers: Record<string, string> = {}) {
  return {
    [RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
    ...headers,
  };
}

function createRunnerOutboundEnv(overrides: Partial<Record<string, unknown>> = {}) {
  const values = new Map<string, string>();
  const defaultUserRunnerNamespace = {
    getByName() {
      return {
        async bootstrapUser() {
          return { userId: "member_123" };
        },
        async commit() {
          throw new Error("not used");
        },
        async applyDeviceSyncRuntimeUpdates(input: { request: { userId: string } }) {
          return {
            appliedAt: "2026-04-05T00:00:00.000Z",
            updates: [],
            userId: input.request.userId,
          };
        },
        async getDeviceSyncRuntimeSnapshot(input: { request: { userId: string } }) {
          return {
            connections: [],
            generatedAt: "2026-04-05T00:00:00.000Z",
            userId: input.request.userId,
          };
        },
        async putPendingUsage(input: { usage: Array<{ usageId?: string }> }) {
          return {
            recorded: input.usage.length,
            usageIds: input.usage.map((entry) => entry.usageId ?? "missing"),
          };
        },
      };
    },
  };
  const userRunnerNamespace = "USER_RUNNER" in overrides
    ? overrides.USER_RUNNER
    : defaultUserRunnerNamespace;
  const env = {
    BUNDLES: {
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
            return Buffer.from(value, "utf8");
          },
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID: "automation:v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"deriveBits\"]}",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"ext\":true,\"key_ops\":[]}",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID: "recovery:v1",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"ext\":true,\"key_ops\":[]}",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"sign\"]}",
    ...overrides,
  };
  const bootstrappedByUserId = new Map<string, Promise<void>>();

  return {
    ...env,
    USER_RUNNER: {
      getByName(userId: string) {
        const stub = userRunnerNamespace.getByName(userId) as {
          bootstrapUser?: (boundUserId: string) => Promise<{ userId: string }>;
          commit?: () => Promise<unknown>;
          finalizeCommit?: () => Promise<unknown>;
        };
        return {
          ...stub,
          async bootstrapUser(boundUserId: string) {
            let seeded = bootstrappedByUserId.get(boundUserId);
            if (!seeded) {
              seeded = ensureRunnerOutboundUserEnvelope(env as Record<string, unknown>, boundUserId);
              bootstrappedByUserId.set(boundUserId, seeded);
            }
            await seeded;
            return stub.bootstrapUser?.(boundUserId) ?? { userId: boundUserId };
          },
        };
      },
    },
  };
}

async function ensureRunnerOutboundUserEnvelope(
  env: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const environment = readHostedExecutionEnvironment(
    env as Readonly<Record<string, string | undefined>>,
  );

  await createHostedUserKeyStore({
    automationRecipientKeyId: environment.automationRecipientKeyId,
    automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: environment.automationRecipientPublicKey,
    bucket: env.BUNDLES as never,
    envelopeEncryptionKey: environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
  }).bootstrapManagedUserCryptoContext(userId);
}
