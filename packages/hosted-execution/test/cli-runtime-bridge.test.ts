import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

import { describe, it } from "vitest";

import {
  HostedCliBridgeRequestError,
  requestHostedCliAssistantCurrentRoute,
  requestHostedCliDeviceAccountList,
  requestHostedCliDeviceConnectLink,
} from "../src/cli-runtime-bridge.ts";

function isBridgeRequestErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof HostedCliBridgeRequestError);
    assert.equal(error.code, code);
    return true;
  };
}

describe("hosted CLI runtime bridge client", () => {
  it("passes a timeout abort signal and maps timeout failures", async () => {
    let signalSeen = false;
    const fetchImpl: typeof fetch = async (_url, init) => {
      signalSeen = init?.signal instanceof AbortSignal;
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
    );
    assert.equal(signalSeen, true);
  });

  it("maps network failures without exposing low-level fetch messages", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed: socket hang up");
    };

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HostedCliBridgeRequestError);
        assert.equal(error.code, "HOSTED_CLI_BRIDGE_REQUEST_FAILED");
        assert.equal(error.message, "Hosted CLI bridge request failed.");
        return true;
      },
    );
  });

  it("times out when a loopback listener accepts but never responds", async () => {
    const server = createServer();

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected hosted CLI bridge timeout test to bind a TCP port.");
      }

      await assert.rejects(
        requestHostedCliDeviceConnectLink({
          bridge: {
            token: "bridge-token",
            url: `http://127.0.0.1:${address.port}/`,
          },
          connectTarget: "whoop",
          timeoutMs: 50,
        }),
        isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("preserves bridge error codes from non-ok responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT",
            message: "Hosted CLI bridge request timed out.",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 408,
        },
      );

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
    );
  });

  it("requests the active assistant current route through the bridge", async () => {
    let requestedPath = "";
    let requestBody: unknown = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      requestedPath = new URL(String(url)).pathname;
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          route: {
            channel: "linq",
            deliveryTarget: "linq_chat_real",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    };

    const result = await requestHostedCliAssistantCurrentRoute({
      bridge: {
        token: "bridge-token",
        url: "http://127.0.0.1:8787/",
      },
      fetchImpl,
    });

    assert.equal(requestedPath, "/assistant/current-route");
    assert.deepEqual(requestBody, {});
    assert.deepEqual(result, {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
      },
    });
  });

  it("preserves assistant current route continuity locator fields", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          route: {
            channel: "linq",
            deliveryTarget: "linq_chat_real",
            identityId: "h1_111111111111111111111111",
            participantId: "h1_222222222222222222222222",
            threadId: "h1_333333333333333333333333",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );

    const result = await requestHostedCliAssistantCurrentRoute({
      bridge: {
        token: "bridge-token",
        url: "http://127.0.0.1:8787/",
      },
      fetchImpl,
    });

    assert.deepEqual(result, {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "h1_111111111111111111111111",
        participantId: "h1_222222222222222222222222",
        threadId: "h1_333333333333333333333333",
      },
    });
  });

  it("requests hosted device account lists through the bridge", async () => {
    let requestedPath = "";
    let requestBody: unknown = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      requestedPath = new URL(String(url)).pathname;
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          accounts: [
            {
              accessTokenExpiresAt: "2026-05-04T00:00:00.000Z",
              connectedAt: "2026-05-03T20:00:00.000Z",
              createdAt: "2026-05-03T20:00:00.000Z",
              displayName: "WHOOP",
              externalAccountId: "external_whoop",
              id: "dsc_whoop",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: "2026-05-03T21:00:00.000Z",
              lastSyncErrorAt: null,
              lastSyncStartedAt: "2026-05-03T21:00:00.000Z",
              lastWebhookAt: null,
              metadata: {},
              nextReconcileAt: "2026-05-04T03:00:00.000Z",
              provider: "whoop",
              scopes: ["read:recovery"],
              sources: [
                {
                  displayName: "Garmin",
                  firstSeenAt: "2026-05-03T20:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-05-03T21:00:00.000Z",
                  resourceCount: 2,
                  sourceProviderSlug: "garmin",
                  status: "connected",
                },
              ],
              setupExpiresAt: null,
              setupPhase: null,
              status: "active",
              updatedAt: "2026-05-03T21:00:00.000Z",
            },
          ],
          provider: "whoop",
          sourceProvider: "garmin",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    };

    const result = await requestHostedCliDeviceAccountList({
      bridge: {
        token: "bridge-token",
        url: "http://127.0.0.1:8787/",
      },
      fetchImpl,
      provider: "whoop",
      sourceProvider: "garmin",
    });

    assert.equal(requestedPath, "/device/accounts/list");
    assert.deepEqual(requestBody, { provider: "whoop", sourceProvider: "garmin" });
    assert.equal(result.provider, "whoop");
    assert.equal(result.sourceProvider, "garmin");
    assert.equal(result.accounts[0]?.provider, "whoop");
    assert.equal(result.accounts[0]?.status, "active");
    assert.equal(result.accounts[0]?.sources?.[0]?.sourceProviderSlug, "garmin");
  });

  it("rejects hosted device account metadata in bridge responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          accounts: [
            {
              accessTokenExpiresAt: "2026-05-04T00:00:00.000Z",
              connectedAt: "2026-05-03T20:00:00.000Z",
              createdAt: "2026-05-03T20:00:00.000Z",
              displayName: "WHOOP",
              externalAccountId: "external_whoop",
              id: "dsc_whoop",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: "2026-05-03T21:00:00.000Z",
              lastSyncErrorAt: null,
              lastSyncStartedAt: "2026-05-03T21:00:00.000Z",
              lastWebhookAt: null,
              metadata: {
                providerUserId: "provider_user_that_must_not_cross_bridge",
              },
              nextReconcileAt: "2026-05-04T03:00:00.000Z",
              provider: "whoop",
              scopes: ["read:recovery"],
              setupExpiresAt: null,
              setupPhase: null,
              status: "active",
              updatedAt: "2026-05-03T21:00:00.000Z",
            },
          ],
          provider: "whoop",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );

    await assert.rejects(
      requestHostedCliDeviceAccountList({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        fetchImpl,
        provider: "whoop",
      }),
    );
  });
});
