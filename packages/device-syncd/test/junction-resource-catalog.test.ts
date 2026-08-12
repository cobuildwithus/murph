import { Junction } from "@junction-api/sdk";
import {
  JUNCTION_RESOURCE_INVENTORY,
  JUNCTION_TIMESERIES_RESOURCES,
} from "@murphai/contracts";
import { describe, expect, it } from "vitest";

// The SDK catalog also covers Junction's lab, order, scheduling, and internal
// device surfaces. Keep those exclusions explicit: an SDK upgrade that adds a
// value fails this test until the new resource is deliberately classified.
const OUT_OF_SCOPE_CLIENT_FACING_RESOURCES = new Set([
  "appointment",
  "cholesterol",
  "connection",
  "device",
  "device_legacy",
  "hypnogram",
  "ige",
  "igg",
  "match_review",
  "order",
  "result",
  "sleep_stream",
]);

const OUT_OF_SCOPE_TIMESERIES_RESOURCES = new Set([
  "cholesterol",
  "cholesterol/hdl",
  "cholesterol/ldl",
  "cholesterol/total",
  "cholesterol/triglycerides",
  "hypnogram",
  "ige",
  "igg",
]);

function normalizeSdkTimeseriesResource(resource: string): string {
  if (resource === "body_fat") {
    return "fat";
  }
  if (resource === "body_weight") {
    return "weight";
  }
  return resource;
}

describe("Junction SDK resource-catalog drift sentinel", () => {
  it("classifies every wearable resource exposed by the SDK client-facing enum", () => {
    const sdkWearableResources = Object.values(Junction.ClientFacingResource)
      .filter((resource) => !OUT_OF_SCOPE_CLIENT_FACING_RESOURCES.has(resource))
      .sort();

    expect(sdkWearableResources).toEqual([...JUNCTION_RESOURCE_INVENTORY].sort());
  });

  it("classifies every wearable resource exposed by the SDK timeseries enum", () => {
    const sdkWearableTimeseriesResources = Object.values(Junction.TimeseriesResource)
      .filter((resource) => !OUT_OF_SCOPE_TIMESERIES_RESOURCES.has(resource))
      .map(normalizeSdkTimeseriesResource)
      .sort();

    expect(sdkWearableTimeseriesResources).toEqual(
      [...JUNCTION_TIMESERIES_RESOURCES].sort(),
    );
  });
});
