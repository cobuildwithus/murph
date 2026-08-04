import { describe, expect, it } from "vitest";

import { hostedLocalCrossRepoCiRequirements } from
  "../packages/hosted-local-harness/src/cross-repo-ci.ts";
import {
  assertHostedLocalCrossRepoCiCoverage,
  readHostedLocalWorkflowScenarioSelections,
} from "./check-hosted-local-cross-repo-ci.ts";

describe("hosted-local cross-repository CI coverage", () => {
  it("reads the whitespace-delimited scenario matrix values", () => {
    expect(readHostedLocalWorkflowScenarioSelections(`
      matrix:
        include:
          - scenarios: device-connect junction-link-connect
          - scenarios: linq-delivery temporal-orchestration # required journeys
    `)).toEqual([
      "device-connect",
      "junction-link-connect",
      "linq-delivery",
      "temporal-orchestration",
    ]);
  });

  it("accepts a workflow that covers every public requirement", () => {
    const workflowText = hostedLocalCrossRepoCiRequirements
      .map(({ scenario }) => `          - scenarios: ${scenario}`)
      .join("\n");

    expect(assertHostedLocalCrossRepoCiCoverage({ workflowText }))
      .toMatchObject({
        requiredScenarioNames: expect.arrayContaining([
          "device-connect",
          "junction-link-connect",
          "linq-first-contact",
        ]),
      });
  });

  it("accepts the canonical scenario name when a requirement uses an alias", () => {
    const workflowText = hostedLocalCrossRepoCiRequirements
      .map(({ scenario }) =>
        `          - scenarios: ${scenario === "linq-delivery" ? "linq-first-contact" : scenario}`
      )
      .join("\n");

    expect(() => assertHostedLocalCrossRepoCiCoverage({ workflowText }))
      .not.toThrow();
  });

  it("reports the missing product journey and its rationale", () => {
    const workflowText = hostedLocalCrossRepoCiRequirements
      .filter(({ scenario }) => scenario !== "junction-link-connect")
      .map(({ scenario }) => `          - scenarios: ${scenario}`)
      .join("\n");

    expect(() => assertHostedLocalCrossRepoCiCoverage({
      workflowPath: "public-murph-integration.yml",
      workflowText,
    })).toThrowError(
      /public-murph-integration\.yml is missing required hosted-local scenarios:[\s\S]*junction-link-connect:[\s\S]*complete Junction Link browser callback/u,
    );
  });

  it("fails on a workflow scenario that the public harness does not own", () => {
    expect(() => assertHostedLocalCrossRepoCiCoverage({
      workflowText: "          - scenarios: imaginary-production-journey",
    })).toThrow(/Unsupported hosted-local E2E scenario/u);
  });
});
