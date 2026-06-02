import { describe, expect, it } from "vitest";

import { defaultDeviceProviderAdapters } from "../src/device-providers/defaults.ts";
import {
  DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
  defaultDeviceProviderDescriptors,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  resolveDeviceProviderConnectionDescriptor,
  resolveDeviceProviderSourcePriority,
  resolveDeviceProviderDescriptor,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
} from "../src/device-providers/provider-descriptors.ts";
import { createDeviceProviderRegistry } from "../src/device-providers/registry.ts";

describe("device provider descriptors", () => {
  it("keeps the built-in adapters aligned with the shared provider descriptors", () => {
    expect(defaultDeviceProviderAdapters.map((adapter) => adapter.provider)).toEqual(
      defaultDeviceProviderDescriptors.map((descriptor) => descriptor.provider),
    );

    for (const adapter of defaultDeviceProviderAdapters) {
      const descriptor = resolveDeviceProviderDescriptor(adapter.provider);

      expect(descriptor).toBeDefined();
      expect(adapter.displayName).toBe(descriptor?.displayName);
      expect(adapter.transportModes).toEqual(descriptor?.transportModes);
      expect(adapter.oauth).toEqual(descriptor?.oauth);
      expect(adapter.webhook).toEqual(descriptor?.webhook);
      expect(adapter.sync).toEqual(descriptor?.sync);
      expect(adapter.normalization).toEqual(descriptor?.normalization);
      expect(adapter.sourcePriorityHints).toEqual(descriptor?.sourcePriorityHints);
    }
  });

  it("registers adapters through a normalized shared provider key", () => {
    const registry = createDeviceProviderRegistry(defaultDeviceProviderAdapters);

    expect(registry.get(" WhOoP ")?.provider).toBe("whoop");
    expect(registry.get("OURA")?.provider).toBe("oura");
    expect(registry.get("garmin")?.provider).toBe("garmin");
  });

  it("keeps Garmin as import-only descriptor metadata", () => {
    expect(GARMIN_DEVICE_PROVIDER_DESCRIPTOR.transportModes).toEqual(["async_export"]);
    expect(resolveDeviceProviderConnectionDescriptor(GARMIN_DEVICE_PROVIDER_DESCRIPTOR)).toEqual({
      kind: "none",
    });
    expect("oauth" in GARMIN_DEVICE_PROVIDER_DESCRIPTOR).toBe(false);
    expect("sync" in GARMIN_DEVICE_PROVIDER_DESCRIPTOR).toBe(false);
  });

  it("keeps the common scheduled device-sync backfill window at 180 days", () => {
    expect(DEFAULT_DEVICE_SYNC_BACKFILL_DAYS).toBe(180);
    expect(OURA_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.backfillDays).toBe(
      DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
    );
    expect(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.backfillDays).toBe(
      DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
    );
    expect(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.backfillDays).toBe(
      DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
    );
    expect(STRAVA_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.backfillDays).toBe(30);
  });

  it("resolves metric priority from the shared descriptor policy", () => {
    expect(resolveDeviceProviderSourcePriority(OURA_DEVICE_PROVIDER_DESCRIPTOR, {
      metric: "sleepScore",
      metricFamily: "sleep",
    })).toBeGreaterThan(
      resolveDeviceProviderSourcePriority(OURA_DEVICE_PROVIDER_DESCRIPTOR, {
        metric: "steps",
        metricFamily: "activity",
      }),
    );
  });

  it("registers Junction as an external-link polling and webhook provider without credential policy", () => {
    const descriptor = resolveDeviceProviderDescriptor("JUNCTION");

    expect(descriptor).toBe(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR);
    expect(descriptor?.transportModes).toEqual(["external_link", "scheduled_poll", "webhook_push"]);
    expect(descriptor ? resolveDeviceProviderConnectionDescriptor(descriptor) : undefined).toEqual({
      kind: "external_link",
      callbackPath: "/connect/junction/callback",
    });
    expect(descriptor?.oauth).toBeUndefined();
    expect(descriptor?.webhook).toEqual({
      path: "/webhooks/junction",
      deliveryMode: "resource",
      supportsAdmin: false,
    });
    expect(descriptor && "credentialPolicy" in descriptor).toBe(false);
    const junctionSleepPriority = resolveDeviceProviderSourcePriority(JUNCTION_DEVICE_PROVIDER_DESCRIPTOR, {
      metric: "sleepScore",
      metricFamily: "sleep",
    });
    const directProviderPriorities = [
      OURA_DEVICE_PROVIDER_DESCRIPTOR,
      GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
      WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
      STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
    ].map((directDescriptor) => resolveDeviceProviderSourcePriority(directDescriptor, {
      metric: "sleepScore",
      metricFamily: "sleep",
    }));

    expect(directProviderPriorities.every((priority) => junctionSleepPriority < priority)).toBe(true);
  });
});
