import { describe, expect, it } from "vitest";

import { parseOptions } from "../scripts/backfill-hosted-vault-share-recent-date-generations";

describe("backfill hosted vault-share recent-date generation script", () => {
  it("defaults to dry-run with an explicit stable cutoff", () => {
    expect(parseOptions([
      "--granted-before",
      "2026-08-11T20:00:00.000Z",
    ])).toEqual({
      batchSize: undefined,
      grantedBefore: new Date("2026-08-11T20:00:00.000Z"),
      help: false,
      mode: "dry-run",
    });
  });

  it("parses a bounded apply batch", () => {
    expect(parseOptions([
      "--apply",
      "--batch-size",
      "100",
      "--granted-before",
      "2026-08-11T20:00:00.000Z",
    ])).toMatchObject({
      batchSize: 100,
      mode: "apply",
    });
  });

  it("rejects non-canonical cutoffs", () => {
    expect(() => parseOptions([
      "--granted-before",
      "2026-08-11",
    ])).toThrow("exact ISO timestamp");
  });
});
