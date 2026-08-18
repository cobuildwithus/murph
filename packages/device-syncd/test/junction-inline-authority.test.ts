import { describe, expect, it } from "vitest";

import {
  areJunctionProviderSlugsDataEquivalent,
  classifyDeviceSyncJunctionInlineSourceProviderSlug,
} from "../src/junction-inline-authority.ts";

describe("Junction inline webhook source attribution", () => {
  it.each([
    {
      expected: { sourceProviderSlug: "google_health", status: "resolved" },
      name: "direct explicit source",
      payload: { sourceProviderSlug: "google_health" },
    },
    {
      expected: { sourceProviderSlug: "google_health", status: "resolved" },
      name: "nested data source",
      payload: { data: { sourceProviderSlug: "google_health" } },
    },
    {
      expected: { sourceProviderSlug: "google_health", status: "resolved" },
      name: "nested records with one authority",
      payload: {
        records: [
          { provider: "google_health" },
          { sourceProviderSlug: "google_health" },
        ],
      },
    },
    {
      expected: { sourceProviderSlug: "google_health", status: "resolved" },
      name: "inline child authority wins over envelope provider metadata",
      payload: {
        provider: "fitbit",
        data: { sourceProviderSlug: "google_health" },
      },
    },
    {
      expected: { sourceProviderSlug: "fitbit", status: "resolved" },
      name: "envelope provider metadata is the fallback when inline data is unknown",
      payload: {
        provider: "fitbit",
        data: { id: "unknown" },
      },
    },
    {
      expected: { sourceProviderSlug: "google_health", status: "resolved" },
      name: "group key supplies missing child source",
      payload: {
        groups: {
          google_health: [{ id: "one" }, { id: "two" }],
        },
      },
    },
    {
      expected: { sourceProviderSlug: "apple_health", status: "resolved" },
      name: "equivalent nested provider aliases",
      payload: {
        records: [
          { sourceProviderSlug: "apple_health" },
          { sourceProviderSlug: "apple_health_kit" },
        ],
      },
    },
    {
      expected: { sourceProviderSlug: "apple_health_kit", status: "resolved" },
      name: "equivalent explicit and nested provider aliases",
      payload: {
        sourceProviderSlug: "apple_health_kit",
        data: { sourceProviderSlug: "apple_health" },
      },
    },
    {
      expected: { status: "ambiguous" },
      name: "mixed nested migration authorities",
      payload: {
        results: [
          { sourceProviderSlug: "fitbit" },
          { sourceProviderSlug: "google_health" },
        ],
      },
    },
    {
      expected: { status: "ambiguous" },
      name: "known and unknown nested authorities",
      payload: {
        records: [
          { sourceProviderSlug: "google_health" },
          { id: "unknown" },
        ],
      },
    },
    {
      expected: { status: "ambiguous" },
      name: "mixed grouped migration authorities",
      payload: {
        groups: {
          fitbit: [{ id: "legacy" }],
          google_health: [{ id: "successor" }],
        },
      },
    },
    {
      expected: { status: "ambiguous" },
      name: "explicit source conflicts with nested source",
      payload: {
        sourceProviderSlug: "fitbit",
        data: { sourceProviderSlug: "google_health" },
      },
    },
    {
      expected: { status: "missing" },
      name: "unknown source remains retryable",
      payload: { data: { id: "unknown" } },
    },
  ])("classifies $name", ({ expected, payload }) => {
    expect(classifyDeviceSyncJunctionInlineSourceProviderSlug(payload)).toEqual(expected);
  });

  it("does not treat legacy Fitbit and Google Health as data-equivalent", () => {
    expect(areJunctionProviderSlugsDataEquivalent("fitbit", "google_health")).toBe(false);
    expect(areJunctionProviderSlugsDataEquivalent("google_health", "fitbit")).toBe(false);
    expect(areJunctionProviderSlugsDataEquivalent("apple_health", "apple_health_kit")).toBe(true);
  });
});
