import { describe, expect, it } from "vitest";

import {
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
} from "@murphai/importers/device-providers/provider-descriptors";

import { createGarminDeviceSyncProvider } from "../src/providers/garmin.ts";
import { createOuraDeviceSyncProvider } from "../src/providers/oura.ts";
import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";

describe("device-sync providers", () => {
  it("hydrates Garmin provider defaults from the shared descriptor", () => {
    const provider = createGarminDeviceSyncProvider({
      clientId: "garmin-client",
      clientSecret: "garmin-secret",
    });

    expect(provider.provider).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.provider);
    expect(provider.displayName).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.transportModes).toEqual(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.transportModes);
    expect(provider.callbackPath).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.oauth?.callbackPath);
    expect(provider.defaultScopes).toEqual([...GARMIN_DEVICE_PROVIDER_DESCRIPTOR.oauth?.defaultScopes ?? []]);
    expect(provider.sync?.windows).toEqual(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.sync?.windows);
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
    expect(provider.displayName).toBe(OURA_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.webhookPath).toBe(OURA_DEVICE_PROVIDER_DESCRIPTOR.webhook?.path);
    expect(provider.oauth?.defaultScopes).toContain("custom-scope");
    expect(provider.defaultScopes).toContain("custom-scope");
    expect(provider.sync?.windows).toEqual({
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
    expect(provider.displayName).toBe(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.displayName);
    expect(provider.webhookPath).toBe(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.webhook?.path);
    expect(provider.oauth?.defaultScopes).toContain("read:team");
    expect(provider.defaultScopes).toContain("read:team");
    expect(provider.sync?.windows).toEqual({
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
});
