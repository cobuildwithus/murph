import { describe, expect, it } from "vitest";

import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
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
