import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeLabsToolRequest,
  parseHostedRuntimeLabsToolResponse,
} from "../src/labs.ts";

const offering = {
  catalogPrice: {
    amount: "42.50",
    currency: "USD" as const,
  },
  commonTurnaroundDays: 2,
  description: "A synthetic catalog fixture.",
  includedMarkerCount: 2,
  includedMarkers: [
    { name: "Marker Alpha" },
    { name: "Marker Beta" },
  ],
  kind: "panel" as const,
  maximumTurnaroundDays: 5,
  name: "Synthetic Panel",
  unit: null,
};

const responseBase = {
  checkedAt: "2026-07-16T12:00:00.000Z",
  orderableThroughMurph: false as const,
  orderingStatus: "discovery_only" as const,
};

const location = {
  address: {
    city: "Fixture City",
    line1: "1 Fixture Way",
    line2: null,
    postalCode: "00000",
    state: "NY",
  },
  coordinates: { latitude: 40, longitude: -73 },
  distanceMiles: 1.25,
  name: "Synthetic Collection Site",
  phoneNumber: null,
};

describe("hosted Labs contract", () => {
  it("parses the bounded search and location requests", () => {
    expect(parseHostedRuntimeLabsToolRequest({
      action: "search",
      kind: "panel",
      limit: 5,
      query: "heart health",
    })).toEqual({
      action: "search",
      kind: "panel",
      limit: 5,
      query: "heart health",
    });
    expect(parseHostedRuntimeLabsToolRequest({
      action: "locations",
      limit: 4,
      radiusMiles: 25,
      zipCode: "00000",
    })).toMatchObject({ action: "locations", radiusMiles: 25 });
  });

  it("rejects extra, unbounded, and malformed request fields", () => {
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "search",
      memberId: "not-allowed",
      query: "lipid",
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "search",
      limit: 21,
      query: "lipid",
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "show",
      labId: 7,
      providerId: "synthetic-panel",
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "search",
      page: 2,
      query: "lipid",
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "locations",
      labId: 7,
      zipCode: "00000",
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolRequest({
      action: "locations",
      radiusMiles: 500,
      zipCode: "invalid",
    })).toThrow();

    const privateInput = "private-query-must-not-echo";
    try {
      parseHostedRuntimeLabsToolRequest({ action: "search", query: privateInput, limit: 21 });
      throw new Error("Expected the invalid Labs request to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error instanceof Error ? error.message : "").toBe(
        "Hosted Labs tool request is invalid.",
      );
      expect(error instanceof Error ? error.message : "").not.toContain(privateInput);
    }
  });

  it("parses normalized display-ready catalog search responses", () => {
    const parsed = parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [offering],
    });
    expect(parsed).toMatchObject({
      action: "search",
      items: [{ name: "Synthetic Panel" }],
      orderableThroughMurph: false,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/junction/iu);
    expect(JSON.stringify(parsed)).not.toMatch(
      /offeringId|providerId|labId|slug|provider/iu,
    );
  });

  it.each([
    ["offeringId", { ...offering, offeringId: "internal-offering" }],
    ["labId", { ...offering, labId: 7 }],
    ["providerId", { ...offering, providerId: "internal-provider" }],
    ["slug", { ...offering, slug: "internal-slug" }],
    [
      "included marker slug",
      { ...offering, includedMarkers: [{ name: "Marker Alpha", slug: "marker-alpha" }] },
    ],
  ])("rejects removed public catalog field %s", (_field, candidate) => {
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [candidate],
    })).toThrow("Hosted Labs tool response is invalid.");
  });

  it.each([
    ["labId", { labId: 7 }],
    ["labSlug", { labSlug: "internal-lab" }],
    ["siteCode", { siteCode: "internal-site" }],
    ["capabilities", { capabilities: ["appointment_scheduling"] }],
  ])("rejects removed public location field %s", (_field, extra) => {
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "locations",
      ...responseBase,
      homeCollectionAvailable: false,
      locations: [{ ...location, ...extra }],
      radiusMiles: 25,
      status: "available",
      zipCode: "00000",
    })).toThrow("Hosted Labs tool response is invalid.");
  });

  it("parses bounded locations and enforces not-served consistency", () => {
    expect(parseHostedRuntimeLabsToolResponse({
      action: "locations",
      ...responseBase,
      homeCollectionAvailable: false,
      locations: [location],
      radiusMiles: 25,
      status: "available",
      zipCode: "00000",
    })).toMatchObject({ action: "locations", status: "available" });

    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "locations",
      ...responseBase,
      homeCollectionAvailable: true,
      locations: [],
      radiusMiles: 25,
      status: "not_served",
      zipCode: "00000",
    })).toThrow();
  });

  it("rejects incomplete or overclaimed response facts", () => {
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [{
        ...offering,
        includedMarkerCount: 1,
      }],
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      orderableThroughMurph: true,
      items: [offering],
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [offering],
      provider: { page: 1, pages: 1, total: 1 },
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "locations",
      ...responseBase,
      homeCollectionAvailable: false,
      locations: [{ ...location, labId: 7 }],
      radiusMiles: 25,
      status: "available",
      zipCode: "00000",
    })).toThrow();

    try {
      parseHostedRuntimeLabsToolResponse({
        action: "search",
        privateProviderPayload: "private-response-must-not-echo",
      });
      throw new Error("Expected the invalid Labs response to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error instanceof Error ? error.message : "").toBe(
        "Hosted Labs tool response is invalid.",
      );
    }
  });
});
