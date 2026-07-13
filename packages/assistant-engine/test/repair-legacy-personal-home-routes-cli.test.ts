import { describe, expect, it } from "vitest";

import {
  parseLegacyPersonalHomeRouteRepairArgs,
} from "../src/assistant/repair-legacy-personal-home-routes-cli.ts";

describe("parseLegacyPersonalHomeRouteRepairArgs", () => {
  it("requires explicit apply and exact input IDs", () => {
    expect(() =>
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--input-id",
        "input_1",
      ])
    ).toThrow("--apply is required");
    expect(() =>
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--apply",
      ])
    ).toThrow("at least one --input-id is required");
  });

  it("deduplicates audited input IDs without changing their order", () => {
    expect(
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--input-id",
        "input_1",
        "--input-id",
        "input_1",
        "--input-id",
        "input_2",
        "--apply",
      ]),
    ).toEqual({
      apply: true,
      help: false,
      inputIds: ["input_1", "input_2"],
      vaultRoot: "/tmp/vault",
    });
  });

  it("allows help without mutation arguments", () => {
    expect(parseLegacyPersonalHomeRouteRepairArgs(["--", "--help"])).toEqual({
      apply: false,
      help: true,
      inputIds: [],
      vaultRoot: "",
    });
  });
});
