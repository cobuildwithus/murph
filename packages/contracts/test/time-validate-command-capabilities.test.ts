import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  commandCapabilityBundles,
  commandNounCapabilityByNoun,
} from "../src/command-capabilities.ts";
import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
  isStrictIsoDate,
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
  parseDailyTime,
  toLocalDayKey,
} from "../src/time.ts";
import { assertContract, safeParseContract } from "../src/validate.ts";

describe("time helpers", () => {
  it("validates and normalizes strict ISO date values", () => {
    expect(isStrictIsoDate("2024-02-29")).toBe(true);
    expect(isStrictIsoDate("2024-02-30")).toBe(false);
    expect(normalizeStrictIsoTimestamp("2024-02-29")).toBe(
      "2024-02-29T00:00:00.000Z",
    );
    expect(normalizeStrictIsoTimestamp("not-a-date")).toBeNull();
  });

  it("parses daily times and formats timezone parts deterministically", () => {
    expect(parseDailyTime("07:45")).toEqual({ hour: 7, minute: 45 });
    expect(parseDailyTime("24:00")).toBeNull();
    expect(normalizeIanaTimeZone("UTC")).toBe("UTC");
    expect(normalizeIanaTimeZone("")).toBeNull();

    expect(
      formatTimeZoneDateTimeParts("2026-03-11T19:00:00.000Z", "UTC"),
    ).toEqual({
      year: 2026,
      month: 3,
      day: 11,
      hour: 19,
      minute: 0,
      second: 0,
      dayOfWeek: 3,
      dayKey: "2026-03-11",
    });
    expect(toLocalDayKey("2026-03-11", "America/New_York")).toBe("2026-03-11");
  });

  it("adds days across month boundaries", () => {
    expect(addDaysToIsoDate("2024-02-28", 2)).toBe("2024-03-01");
    expect(() => addDaysToIsoDate("not-a-date", 1)).toThrow("Invalid ISO date: not-a-date");
  });
});

describe("contract validation helpers", () => {
  it("returns flattened issues for invalid values", () => {
    const result = safeParseContract(
      z.object({
        nested: z.object({
          count: z.number(),
        }),
      }),
      {
        nested: {
          count: "oops",
        },
      },
    );

    expect(result).toEqual({
      success: false,
      errors: [
        "$.nested.count: Invalid input: expected number, received string",
      ],
    });
  });

  it("throws with a labeled error when assertContract fails", () => {
    expect(() =>
      assertContract(
        z.object({
          name: z.string().min(1),
        }),
        {
          name: "",
        },
        "payload",
      ),
    ).toThrowError("payload failed validation:");
  });
});

describe("command capability definitions", () => {
  it("keeps the shared bundle and noun map aligned", () => {
    expect(commandCapabilityBundles.payloadCrud.capabilities).toEqual([
      "scaffold",
      "upsert",
      "show",
      "list",
    ]);
    expect(commandNounCapabilityByNoun.get("food")).toEqual({
      noun: "food",
      bundles: ["payloadCrud"],
    });
    expect(commandNounCapabilityByNoun.get("vault")).toEqual({
      noun: "vault",
      bundles: ["readable", "derivedAdmin"],
      additionalCapabilities: ["update", "repair"],
    });
  });
});
