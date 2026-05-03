import assert from "node:assert/strict";

import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
  requestHostedCliDeviceConnectLink,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import { expect, test, vi } from "vitest";

import {
  startHostedCliRuntimeBridge,
} from "../src/hosted-runtime/cli-runtime-bridge.ts";
import type {
  HostedRuntimeDeviceSyncPort,
} from "../src/hosted-runtime/platform.ts";

function createDeviceSyncPortStub(): HostedRuntimeDeviceSyncPort {
  return {
    async applyUpdates() {
      throw new Error("applyUpdates should not be called.");
    },
    createConnectLink: vi.fn(async ({ connectTarget }) => ({
      authorizationUrl: `https://connect.example.test/${connectTarget}?state=opaque`,
      expiresAt: "2026-05-03T20:15:00.000Z",
      provider: connectTarget,
      providerLabel: connectTarget.toUpperCase(),
    })),
    async fetchSnapshot() {
      throw new Error("fetchSnapshot should not be called.");
    },
  };
}

test("hosted CLI runtime bridge creates device connect links through the runtime port", async () => {
  const deviceSyncPort = createDeviceSyncPortStub();
  const bridge = await startHostedCliRuntimeBridge({ deviceSyncPort });
  assert.ok(bridge);

  try {
    const result = await requestHostedCliDeviceConnectLink({
      bridge: {
        token: bridge.env[HOSTED_CLI_BRIDGE_TOKEN_ENV],
        url: bridge.env[HOSTED_CLI_BRIDGE_URL_ENV],
      },
      connectTarget: "whoop",
    });

    assert.deepEqual(result, {
      authorizationUrl: "https://connect.example.test/whoop?state=opaque",
      expiresAt: "2026-05-03T20:15:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(deviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      connectTarget: "whoop",
    });
    assert.doesNotMatch(JSON.stringify(bridge.env), /opaque/u);
  } finally {
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge rejects bad tokens and model-owned return metadata", async () => {
  const bridge = await startHostedCliRuntimeBridge({
    deviceSyncPort: createDeviceSyncPortStub(),
  });
  assert.ok(bridge);

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
    assert.match(await override.text(), /Unrecognized key/u);
  } finally {
    await bridge.stop();
  }
});

test("hosted CLI runtime bridge redacts downstream connect failures", async () => {
  const bridge = await startHostedCliRuntimeBridge({
    deviceSyncPort: {
      async applyUpdates() {
        throw new Error("applyUpdates should not be called.");
      },
      async createConnectLink() {
        throw new Error("downstream private detail should not surface");
      },
      async fetchSnapshot() {
        throw new Error("fetchSnapshot should not be called.");
      },
    },
  });
  assert.ok(bridge);

  try {
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
  } finally {
    await bridge.stop();
  }
});
