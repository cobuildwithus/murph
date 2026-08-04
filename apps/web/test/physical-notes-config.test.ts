import { describe, expect, it } from "vitest";

import {
  readPhysicalNoteConfig,
} from "../src/lib/physical-notes/config";

const BASE_ENV = {
  LOB_FROM_ADDRESS_ID: "adr_from_test",
  LOB_PHYSICAL_NOTE_COST_USD_MICROS: "250000",
  LOB_PHYSICAL_NOTE_PRICING_VERSION: "lob-test-v1",
} as const;

describe("physical-note provider configuration", () => {
  it("allows Lob test proofs without live-account confirmations", () => {
    expect(readPhysicalNoteConfig({
      ...BASE_ENV,
      LOB_API_KEY: "test_physical_notes",
    })).toEqual({
      apiKey: "test_physical_notes",
      costUsdMicros: 250_000n,
      fromAddressId: "adr_from_test",
      pricingVersion: "lob-test-v1",
    });
  });

  it("fails live sending closed until secure destruction is confirmed", () => {
    const liveEnv = {
      ...BASE_ENV,
      LOB_API_KEY: "live_physical_notes",
    };

    expect(readPhysicalNoteConfig(liveEnv)).toBeNull();
    expect(readPhysicalNoteConfig({
      ...liveEnv,
      LOB_PHYSICAL_NOTES_LIVE_ENABLED: "true",
    })).toBeNull();
    expect(readPhysicalNoteConfig({
      ...liveEnv,
      LOB_USPS_SECURE_DESTRUCTION_CONFIRMED: "true",
    })).toBeNull();
    expect(readPhysicalNoteConfig({
      ...liveEnv,
      LOB_PHYSICAL_NOTES_LIVE_ENABLED: " TRUE ",
      LOB_USPS_SECURE_DESTRUCTION_CONFIRMED: " true ",
    })).toEqual({
      apiKey: "live_physical_notes",
      costUsdMicros: 250_000n,
      fromAddressId: "adr_from_test",
      pricingVersion: "lob-test-v1",
    });
  });
});
