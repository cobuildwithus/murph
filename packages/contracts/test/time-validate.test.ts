import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  addDaysToIsoDate,
  compareIsoTimestampsAscending,
  compareNullableIsoTimestampsAscending,
  extractIsoDatePrefix,
  formatTimeZoneDateTimeParts,
  isStrictIsoDateTime,
  isValidIanaTimeZone,
  isStrictIsoDate,
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
  parseDailyTime,
  reinterpretIsoTimestampInTimeZone,
  resolveFloatingIsoTimestampInTimeZone,
  toLocalDayKey,
} from "../src/time.ts";
import { assertContract, formatContractIssues, safeParseContract } from "../src/validate.ts";

describe("time helpers", () => {
  it("validates and normalizes strict ISO date values", () => {
    expect(isStrictIsoDate("2024-02-29")).toBe(true);
    expect(isStrictIsoDate("2024-02-30")).toBe(false);
    expect(isStrictIsoDateTime("2024-02-29T23:59:59.999Z")).toBe(true);
    expect(isStrictIsoDateTime("2024-02-30T00:00:00.000Z")).toBe(false);
    expect(isStrictIsoDateTime("2024-01-01T00:00:00+24:00")).toBe(false);
    expect(isStrictIsoDate("0001-01-01")).toBe(true);
    expect(isStrictIsoDateTime("0001-01-01T00:00:00.000Z")).toBe(true);
    expect(normalizeStrictIsoTimestamp("2024-02-29")).toBe(
      "2024-02-29T00:00:00.000Z",
    );
    expect(normalizeStrictIsoTimestamp(new Date("2024-02-29T12:34:56.789Z"))).toBe(
      "2024-02-29T12:34:56.789Z",
    );
    expect(normalizeStrictIsoTimestamp(Date.parse("2024-02-29T12:34:56.789Z"))).toBe(
      "2024-02-29T12:34:56.789Z",
    );
    expect(normalizeStrictIsoTimestamp("not-a-date")).toBeNull();
    expect(normalizeStrictIsoTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeStrictIsoTimestamp(new Date(Number.NaN))).toBeNull();
  });

  it("compares ISO timestamps by instant before falling back to string order", () => {
    expect(
      compareIsoTimestampsAscending(
        "2026-04-08T00:30:00+01:00",
        "2026-04-08T00:00:00.000Z",
      ),
    ).toBeLessThan(0);
    expect(
      compareIsoTimestampsAscending(
        "2026-04-08T01:00:00+01:00",
        "2026-04-08T00:00:00.000Z",
      ),
    ).toBe(0);
    expect(
      compareIsoTimestampsAscending(
        "2026-04-08T00:00:00.123456Z",
        "2026-04-08T00:00:00.123457Z",
      ),
    ).toBeLessThan(0);
    expect(
      compareIsoTimestampsAscending(
        "2026-04-08T01:00:00.123456+01:00",
        "2026-04-08T00:00:00.1234560Z",
      ),
    ).toBe(0);
    expect(
      compareIsoTimestampsAscending(
        "2026-04-08T01:00:00.123456+01:00",
        "2026-04-08T00:00:00.123457Z",
      ),
    ).toBeLessThan(0);
    expect(compareIsoTimestampsAscending("not-a-date-b", "not-a-date-a")).toBeGreaterThan(0);
    expect(
      compareNullableIsoTimestampsAscending(null, "2026-04-08T00:00:00.000Z"),
    ).toBeGreaterThan(0);
  });

  it("parses daily times and formats timezone parts deterministically", () => {
    expect(parseDailyTime("07:45")).toEqual({ hour: 7, minute: 45 });
    expect(parseDailyTime("24:00")).toBeNull();
    expect(normalizeIanaTimeZone("UTC")).toBe("UTC");
    expect(normalizeIanaTimeZone("")).toBeNull();
    expect(normalizeIanaTimeZone(null)).toBeNull();
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Olympus")).toBe(false);
    expect(extractIsoDatePrefix(" 2026-03-11T19:00:00.000Z ")).toBe("2026-03-11");
    expect(extractIsoDatePrefix(null)).toBeNull();

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
    expect(toLocalDayKey("2026-03-11T19:00:00.000Z", "UTC")).toBe("2026-03-11");
    expect(() => formatTimeZoneDateTimeParts("2026-03-11T19:00:00.000Z", "Mars/Olympus")).toThrow(
      "Invalid IANA time zone",
    );
    expect(() => formatTimeZoneDateTimeParts("not-a-date", "UTC")).toThrow(
      "Invalid ISO date-time",
    );
  });

  it("resolves floating timestamps independently across timezone transitions", () => {
    expect(
      resolveFloatingIsoTimestampInTimeZone(
        "2026-03-08T01:58:00+00:00",
        "America/New_York",
      ),
    ).toEqual({
      dayKey: "2026-03-08",
      timestamp: "2026-03-08T06:58:00.000Z",
    });
    expect(
      resolveFloatingIsoTimestampInTimeZone(
        "2026-03-08T03:03:00+00:00",
        "America/New_York",
      ),
    ).toEqual({
      dayKey: "2026-03-08",
      timestamp: "2026-03-08T07:03:00.000Z",
    });
    expect(
      reinterpretIsoTimestampInTimeZone(
        "2026-03-08T10:03:00.125Z",
        "America/Phoenix",
        "America/New_York",
      ),
    ).toEqual({
      dayKey: "2026-03-08",
      timestamp: "2026-03-08T07:03:00.125Z",
    });
    expect(
      resolveFloatingIsoTimestampInTimeZone(
        "2026-03-08T02:30:00+00:00",
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      resolveFloatingIsoTimestampInTimeZone(
        "2026-11-01T01:30:00+00:00",
        "America/New_York",
      ),
    ).toBeNull();
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

  it("formats union issues and indexed paths", () => {
    const result = safeParseContract(
      z.object({
        value: z.union([
          z.object({
            count: z.number(),
          }),
          z.array(z.string().min(2)),
        ]),
      }),
      {
        value: ["x"],
      },
    );

    expect(result).toEqual({
      success: false,
      errors: ["$.value[0]: Too small: expected string to have >=2 characters"],
    });
    expect(
      formatContractIssues(
        new z.ZodError([
          {
            code: "custom",
            message: "root problem",
            path: [],
          },
        ]),
      ),
    ).toEqual(["$: root problem"]);
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

  it("returns parsed data when assertion succeeds", () => {
    expect(
      assertContract(
        z.object({
          name: z.string().min(1),
        }),
        {
          name: "Murph",
        },
      ),
    ).toEqual({
      name: "Murph",
    });
  });
});
