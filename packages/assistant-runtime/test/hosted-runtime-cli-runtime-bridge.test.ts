import assert from "node:assert/strict";
import { createConnection } from "node:net";

import {
  HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
  requestHostedCliDeviceAccountList,
  requestHostedCliDeviceConnectLink,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import { expect, test, vi } from "vitest";

import {
  getOrCreateHostedCliRuntimeBridge,
  type HostedCliRuntimeBridge,
  type HostedCliRuntimeBridgeInvocationInput,
} from "../src/hosted-runtime/cli-runtime-bridge.ts";
import type {
  HostedRuntimeDeviceSyncPort,
} from "../src/hosted-runtime/platform.ts";

function createDeviceSyncPortStub(): HostedRuntimeDeviceSyncPort {
  return {
    async ackDirtyStateProcessed() {
      throw new Error("ackDirtyStateProcessed should not be called.");
    },
    async applyUpdates() {
      throw new Error("applyUpdates should not be called.");
    },
    createConnectLink: vi.fn(async ({ connectTarget }) => ({
      authorizationUrl: `https://connect.example.test/${connectTarget}?state=opaque`,
      connectUrl: `https://connect.example.test/${connectTarget}?state=opaque`,
      expiresAt: "2026-05-03T20:15:00.000Z",
      provider: connectTarget,
      providerLabel: connectTarget.toUpperCase(),
    })),
    async fetchSnapshot() {
      throw new Error("fetchSnapshot should not be called.");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_test",
      };
    },
  };
}

async function withHostedCliBridgeInvocation<T>(
  input: HostedCliRuntimeBridgeInvocationInput,
  operation: (bridge: HostedCliRuntimeBridge) => Promise<T>,
): Promise<T> {
  const bridge = await getOrCreateHostedCliRuntimeBridge();
  try {
    return await bridge.runWithInvocation(input, () => operation(bridge));
  } finally {
    await bridge.stop();
  }
}

test("hosted CLI runtime bridge creates device connect links through the runtime port", async () => {
  const deviceSyncPort = createDeviceSyncPortStub();
  await withHostedCliBridgeInvocation({ deviceSyncPort }, async (bridge) => {
    const result = await requestHostedCliDeviceConnectLink({
      bridge: {
        token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
        url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
      },
      connectTarget: "whoop",
    });

    assert.deepEqual(result, {
      authorizationUrl: "https://connect.example.test/whoop?state=opaque",
      connectUrl: "https://connect.example.test/whoop?state=opaque",
      expiresAt: "2026-05-03T20:15:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(deviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      connectTarget: "whoop",
    });
    assert.doesNotMatch(JSON.stringify(bridge.env), /opaque/u);
  });
});

test("hosted CLI runtime bridge keeps stable env while swapping active invocations", async () => {
  const bridge = await getOrCreateHostedCliRuntimeBridge();
  const firstDeviceSyncPort = createDeviceSyncPortStub();
  const secondDeviceSyncPort = createDeviceSyncPortStub();
  const stableEnv = { ...bridge.env };

  try {
    const outsideInvocation = await fetch(
      new URL(HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH, bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]),
      {
        body: JSON.stringify({ connectTarget: "whoop" }),
        headers: {
          authorization: `Bearer ${bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV]}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    assert.equal(outsideInvocation.status, 503);
    assert.match(await outsideInvocation.text(), /HOSTED_CLI_BRIDGE_UNAVAILABLE/u);

    await bridge.runWithInvocation({ deviceSyncPort: firstDeviceSyncPort }, async () => {
      await requestHostedCliDeviceConnectLink({
        bridge: {
          token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
          url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
        },
        connectTarget: "whoop",
      });
    });
    const sameBridge = await getOrCreateHostedCliRuntimeBridge();
    assert.strictEqual(sameBridge, bridge);
    assert.deepEqual(sameBridge.env, stableEnv);

    await sameBridge.runWithInvocation({ deviceSyncPort: secondDeviceSyncPort }, async () => {
      await requestHostedCliDeviceConnectLink({
        bridge: {
          token: sameBridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
          url: sameBridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
        },
        connectTarget: "oura",
      });
    });

    expect(firstDeviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      connectTarget: "whoop",
    });
    expect(secondDeviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      connectTarget: "oura",
    });
  } finally {
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge rejects overlapping active invocations", async () => {
  const bridge = await getOrCreateHostedCliRuntimeBridge();

  try {
    await bridge.runWithInvocation({ deviceSyncPort: createDeviceSyncPortStub() }, async () => {
      await assert.rejects(
        () => bridge.runWithInvocation({ deviceSyncPort: createDeviceSyncPortStub() }, async () => undefined),
        /already has an active invocation/u,
      );
    });
  } finally {
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge lists device accounts from runtime snapshots", async () => {
  const deviceSyncPort = {
    async ackDirtyStateProcessed() {
      throw new Error("ackDirtyStateProcessed should not be called.");
    },
    async applyUpdates() {
      throw new Error("applyUpdates should not be called.");
    },
    async createConnectLink() {
      throw new Error("createConnectLink should not be called.");
    },
    fetchSnapshot: vi.fn(async () => ({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-05-04T00:00:00.000Z",
            connectedAt: "2026-05-03T20:00:00.000Z",
            createdAt: "2026-05-03T20:00:00.000Z",
            displayName: "WHOOP",
            externalAccountId: "external_whoop",
            id: "dsc_whoop",
            metadata: {
              connectState: "state_that_must_not_cross_bridge",
              profile: {
                providerUserId: "provider_user_that_must_not_cross_bridge",
              },
            },
            provider: "whoop",
            scopes: ["read:recovery"],
            status: "active" as const,
            updatedAt: "2026-05-03T21:00:00.000Z",
          },
          credential: {
            kind: "oauth_tokens" as const,
            tokenBundle: {
              accessToken: "redacted-token",
              accessTokenExpiresAt: "2026-05-04T00:00:00.000Z",
              keyVersion: "test-key",
              refreshToken: "redacted-refresh",
              tokenVersion: 1,
            },
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-05-03T21:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-05-03T21:00:00.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-05-04T03:00:00.000Z",
          },
          sources: [
            {
              displayName: "Garmin",
              firstSeenAt: "2026-05-03T20:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-05-03T21:00:00.000Z",
              resourceCount: 2,
              sourceProviderSlug: "garmin",
              status: "connected" as const,
            },
          ],
        },
      ],
      generatedAt: "2026-05-03T21:00:00.000Z",
      userId: "member_test",
    })),
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_test",
      };
    },
  } satisfies HostedRuntimeDeviceSyncPort;
  await withHostedCliBridgeInvocation({ deviceSyncPort }, async (bridge) => {
    const result = await requestHostedCliDeviceAccountList({
      bridge: {
        token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
        url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
      },
      provider: "whoop",
      sourceProvider: "garmin",
    });

    expect(deviceSyncPort.fetchSnapshot).toHaveBeenCalledWith({
      provider: "whoop",
      sourceProviderSlug: "garmin",
    });
    assert.equal(result.provider, "whoop");
    assert.equal(result.sourceProvider, "garmin");
    assert.equal(result.accounts.length, 1);
    assert.equal(result.accounts[0]?.provider, "whoop");
    assert.equal(result.accounts[0]?.status, "active");
    assert.deepEqual(result.accounts[0]?.sources, [
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
    ]);
    assert.deepEqual(result.accounts[0]?.metadata, {});
    assert.doesNotMatch(
      JSON.stringify(result),
      /redacted-token|redacted-refresh|state_that_must_not_cross_bridge|provider_user_that_must_not_cross_bridge/u,
    );
  });
});

test("hosted CLI runtime bridge adds only server-owned messaging return targets", async () => {
  let serverOwnedReturnTarget: "imessage" | "telegram" | null = "telegram";
  const deviceSyncPort = createDeviceSyncPortStub();
  await withHostedCliBridgeInvocation({
    deviceSyncPort,
    messagingReturnTarget: () => serverOwnedReturnTarget,
  }, async (bridge) => {
    await requestHostedCliDeviceConnectLink({
      bridge: {
        token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
        url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
      },
      connectTarget: "whoop",
    });

    expect(deviceSyncPort.createConnectLink).toHaveBeenLastCalledWith({
      connectTarget: "whoop",
      messagingReturnTarget: "telegram",
    });

    serverOwnedReturnTarget = null;
    await requestHostedCliDeviceConnectLink({
      bridge: {
        token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
        url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
      },
      connectTarget: "oura",
    });

    expect(deviceSyncPort.createConnectLink).toHaveBeenLastCalledWith({
      connectTarget: "oura",
    });
  });
});

test("hosted CLI runtime bridge rejects bad tokens and model-owned return metadata", async () => {
  const bridge = await getOrCreateHostedCliRuntimeBridge();

  try {
    const unauthorized = await fetch(
      new URL(HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH, bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]),
      {
        body: JSON.stringify({ connectTarget: "whoop" }),
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    assert.equal(unauthorized.status, 401);

    await bridge.runWithInvocation({ deviceSyncPort: createDeviceSyncPortStub() }, async () => {
      const override = await fetch(
        new URL(HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH, bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]),
        {
          body: JSON.stringify({
            connectTarget: "whoop",
            messagingReturnTarget: "telegram",
          }),
          headers: {
            authorization: `Bearer ${bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV]}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      assert.equal(override.status, 400);
      const overrideText = await override.text();
      assert.match(overrideText, /HOSTED_CLI_BRIDGE_REQUEST_INVALID/u);
      assert.doesNotMatch(overrideText, /messagingReturnTarget/u);
    });

    const accountListUnauthorized = await fetch(
      new URL(HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH, bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]),
      {
        body: JSON.stringify({ provider: "whoop" }),
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    assert.equal(accountListUnauthorized.status, 401);
  } finally {
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge stop destroys partial authenticated requests", async () => {
  const bridge = await getOrCreateHostedCliRuntimeBridge();
  const bridgeUrl = new URL(bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]);
  const socket = createConnection({
    host: bridgeUrl.hostname,
    port: Number(bridgeUrl.port),
  });

  try {
    await bridge.runWithInvocation({ deviceSyncPort: createDeviceSyncPortStub() }, async () => {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.on("error", () => {});
      socket.write([
        `POST ${HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH} HTTP/1.1`,
        `Host: ${bridgeUrl.host}`,
        `Authorization: Bearer ${bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV]}`,
        "Content-Type: application/json",
        "Content-Length: 8192",
        "",
        "{\"connectTarget\":\"whoop\"",
      ].join("\r\n"));

      const socketClosed = new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.once("error", () => resolve());
      });
      await Promise.race([
        bridge.stop(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out stopping hosted CLI bridge.")), 1_000)
        ),
      ]);
      await Promise.race([
        socketClosed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out closing hosted CLI bridge socket.")), 1_000)
        ),
      ]);
    });
    assert.equal(socket.destroyed, true);
  } finally {
    socket.destroy();
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge redacts downstream connect failures", async () => {
  await withHostedCliBridgeInvocation({
    deviceSyncPort: {
      async ackDirtyStateProcessed() {
        throw new Error("ackDirtyStateProcessed should not be called.");
      },
      async applyUpdates() {
        throw new Error("applyUpdates should not be called.");
      },
      async createConnectLink() {
        throw new Error("downstream private detail should not surface");
      },
      async fetchSnapshot() {
        throw new Error("fetchSnapshot should not be called.");
      },
      async fetchDirtyStates() {
        return {
          hasMore: false,
          items: [],
          nextWakeAt: null,
          userId: "member_test",
        };
      },
    },
  }, async (bridge) => {
    const response = await fetch(
      new URL(HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH, bridge.env[HOSTED_CLI_BRIDGE_URL_ENV]),
      {
        body: JSON.stringify({ connectTarget: "whoop" }),
        headers: {
          authorization: `Bearer ${bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV]}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    const text = await response.text();

    assert.equal(response.status, 502);
    assert.match(text, /HOSTED_DEVICE_CONNECT_LINK_FAILED/u);
    assert.doesNotMatch(text, /private detail/u);
    assert.doesNotMatch(text, /should not surface/u);
  });
});
