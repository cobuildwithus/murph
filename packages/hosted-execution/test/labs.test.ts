import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeLabsToolRequest,
  parseHostedRuntimeLabsToolResponse,
} from "../src/labs.ts";

const offering = {
  catalogPrice: {
    amount: "42.50",
    currency: "USD" as const,
    source: "junction_catalog" as const,
  },
  commonTurnaroundDays: 2,
  description: "A synthetic catalog fixture.",
  includedMarkerCount: 2,
  includedMarkers: [
    { name: "Marker Alpha", slug: "marker-alpha" },
    { name: "Marker Beta", slug: null },
  ],
  junctionOrderable: true,
  kind: "panel" as const,
  labId: 7,
  maximumTurnaroundDays: 5,
  name: "Synthetic Panel",
  offeringId: "junction:7:synthetic-panel",
  providerId: "synthetic-panel",
  slug: "synthetic-panel",
  unit: null,
};

const responseBase = {
  checkedAt: "2026-07-16T12:00:00.000Z",
  orderableThroughMurph: false as const,
  orderingStatus: "discovery_only" as const,
  source: "junction" as const,
};

describe("hosted Labs contract", () => {
  it("parses the bounded search, show, and location requests", () => {
    expect(parseHostedRuntimeLabsToolRequest({
      action: "search",
      kind: "panel",
      limit: 5,
      page: 2,
      query: "heart health",
    })).toEqual({
      action: "search",
      kind: "panel",
      limit: 5,
      page: 2,
      query: "heart health",
    });
    expect(parseHostedRuntimeLabsToolRequest({
      action: "show",
      labId: 7,
      providerId: "synthetic-panel",
    })).toMatchObject({ action: "show", labId: 7 });
    expect(parseHostedRuntimeLabsToolRequest({
      action: "locations",
      labId: 7,
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
      offeringId: "opaque-only",
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

  it("parses normalized catalog search and detail responses", () => {
    expect(parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [offering],
      provider: { page: 1, pages: 4, total: 67 },
    })).toMatchObject({
      action: "search",
      items: [{ name: "Synthetic Panel" }],
      orderableThroughMurph: false,
    });

    expect(parseHostedRuntimeLabsToolResponse({
      action: "show",
      ...responseBase,
      offering,
    })).toMatchObject({
      action: "show",
      offering: { catalogPrice: { amount: "42.50" } },
    });
  });

  it("parses bounded locations and enforces not-served consistency", () => {
    expect(parseHostedRuntimeLabsToolResponse({
      action: "locations",
      ...responseBase,
      homeCollectionAvailable: false,
      locations: [{
        address: {
          city: "Fixture City",
          line1: "1 Fixture Way",
          line2: null,
          postalCode: "00000",
          state: "NY",
        },
        capabilities: ["walk_in"],
        coordinates: { latitude: 40, longitude: -73 },
        distanceMiles: 1.25,
        labId: 7,
        labSlug: "synthetic-lab",
        name: "Synthetic Collection Site",
        phoneNumber: null,
        siteCode: "fixture-site",
      }],
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
      action: "show",
      ...responseBase,
      offering: {
        ...offering,
        includedMarkerCount: 1,
      },
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "show",
      ...responseBase,
      orderableThroughMurph: true,
      offering,
    })).toThrow();
    expect(() => parseHostedRuntimeLabsToolResponse({
      action: "search",
      ...responseBase,
      items: [offering],
      provider: { page: 1, pages: 1, rawToken: "not-allowed", total: 1 },
    })).toThrow();

    try {
      parseHostedRuntimeLabsToolResponse({
        action: "show",
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
