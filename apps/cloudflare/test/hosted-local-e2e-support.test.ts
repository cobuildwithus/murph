import { describe, expect, it } from "vitest";

import { mergeRequiredEnvProfile } from "./helpers/hosted-local-e2e-support.js";

describe("mergeRequiredEnvProfile", () => {
  it("preserves the default hosted runner profiles when adding a required channel profile", () => {
    expect(mergeRequiredEnvProfile(undefined, "linq")).toBe("assistant,parsers,web,linq");
  });

  it("adds the required profile without duplicating existing entries", () => {
    expect(mergeRequiredEnvProfile("assistant,linq,web", "linq")).toBe("assistant,linq,web");
  });
});
