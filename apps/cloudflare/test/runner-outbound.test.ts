import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";

describe("handleRunnerOutboundRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies device-sync runtime requests through the worker with the bound user id", async () => {
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
          userId: "member_other",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://web.example.test/api/internal/device-sync/runtime/snapshot"),
      expect.objectContaining({
        body: JSON.stringify({
          provider: "oura",
          userId: "member_123",
        }),
        headers: expect.objectContaining({
          authorization: "Bearer internal-token",
          "content-type": "application/json; charset=utf-8",
          "x-hosted-execution-user-id": "member_123",
        }),
        method: "POST",
      }),
    );
  });

  it("proxies hosted share payload requests through the worker control token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share-pack.worker/api/hosted-share/internal/share_123/payload?shareCode=code_123", {
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://web.example.test/api/hosted-share/internal/share_123/payload?shareCode=code_123"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer share-token",
          "x-hosted-execution-user-id": "member_123",
        }),
        method: "GET",
      }),
    );
  });

  it("rejects side-effect writes when the route effect id and payload effect id differ", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://side-effects.worker/effects/outbox_123", {
        body: JSON.stringify({
          delivery: {
            channel: "telegram",
            messageLength: 12,
            sentAt: "2026-03-26T12:00:00.000Z",
            target: "thread_123",
            targetKind: "thread",
          },
          effectId: "outbox_999",
          fingerprint: "dedupe_123",
          intentId: "outbox_123",
          kind: "assistant.delivery",
          recordedAt: "2026-03-26T12:00:05.000Z",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      createRunnerOutboundEnv(),
      "member_123",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "effectId mismatch: expected outbox_123, received outbox_999.",
    });
  });
});

function createRunnerOutboundEnv(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    BUNDLES: {
      async delete() {},
      async get() {
        return null;
      },
      async put() {},
    },
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
    HOSTED_SHARE_INTERNAL_TOKEN: "share-token",
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    USER_RUNNER: {
      getByName() {
        return {
          async bootstrapUser() {
            return { userId: "member_123" };
          },
          async commit() {
            throw new Error("not used");
          },
          async finalizeCommit() {
            throw new Error("not used");
          },
        };
      },
    },
    ...overrides,
  };
}
