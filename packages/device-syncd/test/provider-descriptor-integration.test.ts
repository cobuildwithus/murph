import { describe, expect, it } from "vitest";

import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  resolveDeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";

describe("device-sync providers", () => {

  it("hydrates Junction provider defaults from the shared descriptor", () => {
    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_junction-test",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
    });

    expect(provider.provider).toBe(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.descriptor.displayName).toBe(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.descriptor.transportModes).toEqual(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.transportModes);
    expect(provider.descriptor.connection).toEqual(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.connection);
    expect(provider.descriptor.sync?.windows).toEqual(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows);
    expect(provider.descriptor.webhook).toEqual(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.webhook);
    expect(Boolean(provider.connectionHandler?.revokeAccess)).toBe(
      JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync?.supportsRemoteDisconnect,
    );
    expect(provider.credentialPolicy).toEqual({
      kind: "provider_config",
      providerConfigKey: "junction",
    });
  });

  it("reports the normalized Junction reconcile interval", () => {
    const baselineWindows = { ...JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows };
    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_junction-test",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      reconcileIntervalMs: 1,
      region: "us",
    });

    expect(provider.descriptor.sync?.windows.reconcileIntervalMs).toBe(60_000);
    expect(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows).toEqual(baselineWindows);
  });

});

it("keeps the built-in runtime providers aligned with the shared descriptor registry", () => {
    const providers = [
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_junction-test",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
      }),
    ];

    expect([...providers.map((provider) => provider.provider)].sort()).toEqual([
      "junction",
    ]);

    for (const provider of providers) {
      const descriptor = resolveDeviceProviderDescriptor(provider.provider);

      expect(descriptor?.provider).toBe(provider.provider);
      expect(provider.descriptor.provider).toBe(provider.provider);
      expect(provider.descriptor.displayName).toBe(descriptor?.displayName);
      expect(provider.jobExecutor).toBeDefined();
    }

    const junction = providers.find((provider) => provider.provider === "junction");
    expect(junction?.connectionHandler).toBeDefined();
    expect(junction?.webhookHandler).toBeDefined();
    expect(Boolean(junction && "buildConnectUrl" in junction)).toBe(false);
    expect(Boolean(junction && "exchangeAuthorizationCode" in junction)).toBe(false);
    expect(Boolean(junction && "refreshTokens" in junction)).toBe(false);

  });
