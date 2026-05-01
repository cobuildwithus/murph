import assert from "node:assert/strict";

import { test } from "vitest";

import {
  assertDeviceSyncProviderCapabilities,
  createDeviceSyncRegistry,
} from "../src/registry.ts";

import type { DeviceProviderDescriptor } from "@murphai/importers/device-providers/provider-descriptors";
import type { DeviceSyncProvider } from "../src/types.ts";

function descriptor(
  provider: string,
  connection: DeviceProviderDescriptor["connection"],
): DeviceProviderDescriptor {
  return {
    provider,
    displayName: provider,
    transportModes: connection?.kind === "external_link" ? ["external_link"] : ["oauth_callback"],
    ...(connection ? { connection } : {}),
    normalization: {
      metricFamilies: ["activity"],
      snapshotParser: "schema",
    },
    sourcePriorityHints: {
      defaultPriority: 50,
      metricFamilies: {
        activity: 50,
      },
    },
  };
}

function provider(overrides: Partial<DeviceSyncProvider> = {}): DeviceSyncProvider {
  return {
    provider: "demo",
    descriptor: descriptor("demo", {
      kind: "oauth2",
      callbackPath: "/oauth/demo/callback",
      defaultScopes: ["offline"],
    }),
    buildConnectUrl: () => "https://provider.example/connect",
    async exchangeAuthorizationCode() {
      return {
        externalAccountId: "external-account",
        credential: {
          kind: "oauth_tokens",
          tokens: {
            accessToken: "<REDACTED_ACCESS_TOKEN>",
          },
        },
      };
    },
    async refreshTokens() {
      return {
        accessToken: "<REDACTED_ACCESS_TOKEN_2>",
      };
    },
    ...overrides,
  };
}

test("device sync registry accepts OAuth compatibility and generic connection handlers", () => {
  assert.doesNotThrow(() => createDeviceSyncRegistry([provider()]));

  assert.doesNotThrow(() =>
    createDeviceSyncRegistry([
      provider({
        buildConnectUrl: undefined,
        exchangeAuthorizationCode: undefined,
        refreshTokens: undefined,
        connectionHandler: {
          async beginConnection() {
            return {
              authorizationUrl: "https://provider.example/connect",
            };
          },
          async completeConnection() {
            return {
              externalAccountId: "external-account",
              credential: {
                kind: "oauth_tokens",
                tokens: {
                  accessToken: "<REDACTED_ACCESS_TOKEN>",
                },
              },
            };
          },
          async refreshTokens() {
            return {
              accessToken: "<REDACTED_ACCESS_TOKEN_2>",
            };
          },
        },
      }),
    ])
  );
});

test("device sync registry requires OAuth providers to expose a connection path", () => {
  assert.throws(
    () =>
      createDeviceSyncRegistry([
        provider({
          buildConnectUrl: undefined,
          exchangeAuthorizationCode: undefined,
        }),
      ]),
    /declares oauth2 connection support/u,
  );
});

test("device sync registry requires external-link providers to expose generic connection handlers", () => {
  assert.throws(
    () =>
      createDeviceSyncRegistry([
        provider({
          descriptor: descriptor("junction", {
            kind: "external_link",
            callbackPath: "/connect/junction/callback",
          }),
          credentialPolicy: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        }),
      ]),
    /declares external_link connection support/u,
  );

  assert.doesNotThrow(() =>
    assertDeviceSyncProviderCapabilities(
      provider({
        descriptor: descriptor("junction", {
          kind: "external_link",
          callbackPath: "/connect/junction/callback",
        }),
        credentialPolicy: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        buildConnectUrl: undefined,
        exchangeAuthorizationCode: undefined,
        refreshTokens: undefined,
        connectionHandler: {
          async beginConnection() {
            return {
              authorizationUrl: "https://provider.example/link",
            };
          },
          async completeConnection() {
            return {
              externalAccountId: "external-account",
              credential: {
                kind: "provider_config",
                providerConfigKey: "junction",
              },
            };
          },
        },
      }),
    )
  );
});

test("device sync registry requires refresh support for refreshable OAuth credentials", () => {
  assert.throws(
    () =>
      createDeviceSyncRegistry([
        provider({
          refreshTokens: undefined,
        }),
      ]),
    /declares oauth_tokens credentials/u,
  );

  assert.doesNotThrow(() =>
    createDeviceSyncRegistry([
      provider({
        refreshTokens: undefined,
        descriptor: {
          ...descriptor("demo", {
            kind: "oauth2",
            callbackPath: "/oauth/demo/callback",
          }),
          sync: {
            windows: {
              backfillDays: 30,
              reconcileDays: 7,
              reconcileIntervalMs: 60_000,
            },
            jobKinds: ["backfill"],
            supportsRemoteDisconnect: false,
            supportsTokenRefresh: false,
          },
        },
      }),
    ])
  );
});
