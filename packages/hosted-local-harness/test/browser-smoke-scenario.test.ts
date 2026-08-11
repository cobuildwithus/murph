import { describe, expect, test } from "vitest";

import {
  listHostedLocalE2eScenarios,
  resolveHostedLocalE2eScenarios,
} from "../src/e2e.ts";

describe("hosted-local browser smoke scenario", () => {
  test("is explicit, opt-in locally, and discoverable through the canonical registry", () => {
    expect(resolveHostedLocalE2eScenarios("hosted-web-browser-smoke")).toEqual([
      {
        file: "apps/cloudflare/test/hosted-local-web-browser-smoke-e2e.test.ts",
        manualOnly: true,
        name: "hosted-web-browser-smoke",
      },
    ]);
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name))
      .not.toContain("hosted-web-browser-smoke");
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name))
      .toContain("hosted-web-browser-smoke");
  });
});
