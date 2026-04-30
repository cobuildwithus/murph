import { describe, expect, it } from "vitest";

import {
  defaultDeviceProviderDescriptors,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  resolveDeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { createGarminDeviceSyncProvider } from "../src/providers/garmin.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createOuraDeviceSyncProvider } from "../src/providers/oura.ts";
import { createStravaDeviceSyncProvider } from "../src/providers/strava.ts";
import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";

describe("device-sync providers", () => {
  it("keeps the built-in runtime providers aligned with the shared descriptor registry", () => {
    const providers = [
      createGarminDeviceSyncProvider({
        clientId: "garmin-client",
        clientSecret: "garmin-secret",
      }),
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_junction-test",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
      }),
      createWhoopDeviceSyncProvider({
        clientId: "whoop-client",
        clientSecret: "whoop-secret",
      }),
      createOuraDeviceSyncProvider({
        clientId: "oura-client",
        clientSecret: "oura-secret",
      }),
      createStravaDeviceSyncProvider({
        clientId: "strava-client",
        clientSecret: "strava-secret",
      }),
    ];

    expect(
      [...providers.map((provider) => provider.provider)].sort(),
    ).toEqual(
      [...defaultDeviceProviderDescriptors.map((descriptor) => descriptor.provider)].sort(),
    );

    for (const provider of providers) {
      const descriptor = resolveDeviceProviderDescriptor(provider.provider);

      expect(descriptor?.provider).toBe(provider.provider);
      expect(provider.descriptor.provider).toBe(provider.provider);
      expect(provider.descriptor.displayName).toBe(descriptor?.displayName);
    }
  });

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
    expect(provider.credentialPolicy).toEqual({
      kind: "provider_config",
      providerConfigKey: "junction",
    });
  });

  it("hydrates Garmin provider defaults from the shared descriptor", () => {
    const provider = createGarminDeviceSyncProvider({
      clientId: "garmin-client",
      clientSecret: "garmin-secret",
    });

    expect(provider.provider).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.descriptor.displayName).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.descriptor.transportModes).toEqual(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.transportModes);
    expect(provider.descriptor.oauth?.callbackPath).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.oauth?.callbackPath);
    expect(provider.descriptor.oauth?.defaultScopes).toEqual([...GARMIN_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes ?? []]);
    expect(provider.descriptor.sync?.windows).toEqual(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows);
    expect(Boolean(provider.revokeAccess)).toBe(
      GARMIN_DEVICE_PROVIDER_DESCRIPTOR.sync?.supportsRemoteDisconnect,
    );
  });

  it("applies Oura runtime overrides onto the shared descriptor shape", () => {
    const baselineScopes = [...OURA_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes ?? []];
    const baselineWindows = { ...OURA_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows };
    const provider = createOuraDeviceSyncProvider({
      clientId: "oura-client",
      clientSecret: "oura-secret",
      scopes: ["daily", "custom-scope"],
      backfillDays: 14,
      reconcileDays: 5,
      reconcileIntervalMs: 123_000,
    });

    expect(provider.provider).toBe(OURA_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.descriptor.displayName).toBe(OURA_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.descriptor.webhook?.path).toBe(OURA_DEVICE_PROVIDER_DESCRIPTOR.webhook?.path);
    expect(provider.descriptor.oauth?.defaultScopes).toContain("custom-scope");
    expect(provider.descriptor.sync?.windows).toEqual({
      backfillDays: 14,
      reconcileDays: 5,
      reconcileIntervalMs: 123_000,
    });
    expect(Boolean(provider.revokeAccess)).toBe(
      OURA_DEVICE_PROVIDER_DESCRIPTOR.sync?.supportsRemoteDisconnect,
    );
    expect(OURA_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes).toEqual(baselineScopes);
    expect(OURA_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows).toEqual(baselineWindows);
  });

  it("applies WHOOP runtime overrides onto the shared descriptor shape", () => {
    const baselineScopes = [...WHOOP_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes ?? []];
    const baselineWindows = { ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows };
    const provider = createWhoopDeviceSyncProvider({
      clientId: "whoop-client",
      clientSecret: "whoop-secret",
      scopes: ["read:team"],
      backfillDays: 11,
      reconcileDays: 4,
      reconcileIntervalMs: 456_000,
    });

    expect(provider.provider).toBe(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.descriptor.displayName).toBe(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.descriptor.webhook?.path).toBe(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.webhook?.path);
    expect(provider.descriptor.oauth?.defaultScopes).toEqual(["offline", "read:profile", "read:team"]);
    expect(provider.descriptor.sync?.windows).toEqual({
      backfillDays: 11,
      reconcileDays: 4,
      reconcileIntervalMs: 456_000,
    });
    expect(Boolean(provider.revokeAccess)).toBe(
      WHOOP_DEVICE_PROVIDER_DESCRIPTOR.sync?.supportsRemoteDisconnect,
    );
    expect(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes).toEqual(baselineScopes);
    expect(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows).toEqual(baselineWindows);
  });

  it("keeps WHOOP explicit empty scope overrides at the required base scopes only", () => {
    const provider = createWhoopDeviceSyncProvider({
      clientId: "whoop-client",
      clientSecret: "whoop-secret",
      scopes: [],
    });

    expect(provider.descriptor.oauth?.defaultScopes).toEqual(["offline", "read:profile"]);
  });

  it("applies Strava runtime overrides onto the shared descriptor shape", () => {
    const baselineScopes = [...STRAVA_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes ?? []];
    const baselineWindows = { ...STRAVA_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows };
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client",
      clientSecret: "strava-secret",
      scopes: ["activity:read", "activity:read_all"],
      backfillDays: 18,
      reconcileDays: 6,
      reconcileIntervalMs: 789_000,
    });

    expect(provider.provider).toBe(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.descriptor.displayName).toBe(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.descriptor.webhook?.path).toBe(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.webhook?.path);
    expect(provider.descriptor.oauth?.defaultScopes).toEqual(["activity:read", "activity:read_all"]);
    expect(provider.descriptor.sync?.windows).toEqual({
      backfillDays: 18,
      reconcileDays: 6,
      reconcileIntervalMs: 789_000,
    });
    expect(Boolean(provider.revokeAccess)).toBe(
      STRAVA_DEVICE_PROVIDER_DESCRIPTOR.sync?.supportsRemoteDisconnect,
    );
    expect(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes).toEqual(baselineScopes);
    expect(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows).toEqual(baselineWindows);
  });
});
