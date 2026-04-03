import { describe, expect, it } from "vitest";

import { defaultDeviceProviderAdapters } from "../src/device-providers/defaults.ts";
import {
  defaultDeviceProviderDescriptors,
  resolveDeviceProviderDescriptor,
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
});
