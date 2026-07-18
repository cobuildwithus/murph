import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  createOnboardingEvalTurnEnvironment,
  evaluateCanonicalExpectationEvidence,
  onboardingScenarios,
} from "../src/onboarding.js";

describe("onboarding eval composition", () => {
  it("binds the case vault while preserving the authenticated Codex profile", () => {
    const ambientEnv = {
      CODEX_HOME: "/tmp/synthetic-codex-home",
      PATH: "/tmp/synthetic-bin",
      VAULT: "/tmp/unrelated-default-vault",
    };

    const turnEnvironment = createOnboardingEvalTurnEnvironment(
      "/tmp/onboarding-case-vault",
      ambientEnv,
    );

    expect(turnEnvironment).toEqual({
      currentWorkingDirectory: "/tmp/onboarding-case-vault",
      env: {
        CODEX_HOME: "/tmp/synthetic-codex-home",
        PATH: "/tmp/synthetic-bin",
        VAULT: "/tmp/onboarding-case-vault",
      },
    });
    expect(turnEnvironment.env).not.toBe(ambientEnv);
    expect(ambientEnv.VAULT).toBe("/tmp/unrelated-default-vault");
  });

  it("provides a focused smoke suite and a broader contextual-return suite", () => {
    const smoke = onboardingScenarios.filter((scenario) =>
      scenario.suites.includes("onboarding-smoke"),
    );

    expect(smoke.map((scenario) => scenario.id)).toEqual([
      "onboarding.fresh-welcome",
      "onboarding.anchor-not-authorization",
      "onboarding.direct-request-wins",
      "onboarding.safety-interrupts",
      "onboarding.overall-decline",
    ]);
    expect(
      onboardingScenarios.some(
        (scenario) => scenario.id === "onboarding.contextual-return-choice",
      ),
    ).toBe(true);
  });

  it("keeps every fixture synthetic, bounded, and self-describing", () => {
    const serialized = JSON.stringify(onboardingScenarios);

    expect(onboardingScenarios).toHaveLength(7);
    expect(serialized).not.toContain(homedir());
    expect(serialized).not.toContain(process.cwd());
    for (const scenario of onboardingScenarios) {
      expect(scenario.input.turns.length).toBeGreaterThan(0);
      expect(scenario.input.turns.length).toBeLessThanOrEqual(7);
      expect(scenario.input.criteria.length).toBeGreaterThanOrEqual(3);
      expect(scenario.input.expected.status).toMatch(/^(completed|open)$/u);
    }
  });

  it("checks canonical meaning without retaining canonical content", () => {
    const requiredGoalMatches = [
      [["strong", "strength"], ["hik"]],
      [["afternoon"], ["energy"]],
    ];
    const requiredClinicalAssertionGroups = [
      ["no_known_medications"],
      ["no_known_conditions"],
      ["no_known_allergies"],
    ];
    const matching = evaluateCanonicalExpectationEvidence({
      clinicalAssertions: [
        { assertion: "no_known_medications", domain: null },
        { assertion: "no_known_conditions", domain: null },
        { assertion: "no_known_allergies", domain: null },
        { assertion: "not_applicable", domain: "pregnancy" },
      ],
      goalTitles: [
        "Build strength for long hikes",
        "Understand afternoon energy dips",
      ],
      requirePregnancyNotApplicable: true,
      requiredClinicalAssertionGroups,
      requiredGoalMatches,
    });
    const sameCountsWrongContent = evaluateCanonicalExpectationEvidence({
      clinicalAssertions: [
        { assertion: "absence_asserted", domain: null },
        { assertion: "denial_asserted", domain: null },
        { assertion: "negative_screening", domain: null },
        { assertion: "not_applicable", domain: "unrelated" },
      ],
      goalTitles: ["Improve sleep", "Walk after lunch"],
      requirePregnancyNotApplicable: true,
      requiredClinicalAssertionGroups,
      requiredGoalMatches,
    });

    expect(matching).toEqual({
      clinicalAssertionsMatched: true,
      goalTermsMatched: true,
    });
    expect(sameCountsWrongContent).toEqual({
      clinicalAssertionsMatched: false,
      goalTermsMatched: false,
    });
    expect(JSON.stringify(matching)).not.toContain("Build strength");
    expect(JSON.stringify(matching)).not.toContain("no_known_medications");
  });

  it("requires each goal match to be present in one canonical goal", () => {
    const requiredGoalMatches = [
      [["strong", "strength"], ["hik"]],
      [["afternoon"], ["energy"]],
    ];

    expect(
      evaluateCanonicalExpectationEvidence({
        clinicalAssertions: [],
        goalTitles: ["Build strength", "Prepare for a long hike"],
        requiredGoalMatches,
      }).goalTermsMatched,
    ).toBe(false);
  });

  it("rejects pregnancy not-applicable evidence from another domain", () => {
    expect(
      evaluateCanonicalExpectationEvidence({
        clinicalAssertions: [
          { assertion: "no_known_medications", domain: null },
          { assertion: "not_applicable", domain: "unrelated" },
        ],
        goalTitles: [],
        requirePregnancyNotApplicable: true,
        requiredClinicalAssertionGroups: [["no_known_medications"]],
      }).clinicalAssertionsMatched,
    ).toBe(false);
  });

  it("supports pregnancy-only canonical expectations", () => {
    const matching = evaluateCanonicalExpectationEvidence({
      clinicalAssertions: [{ assertion: "not_pregnant", domain: null }],
      goalTitles: [],
      requirePregnancyNotApplicable: true,
    });
    const missing = evaluateCanonicalExpectationEvidence({
      clinicalAssertions: [],
      goalTitles: [],
      requirePregnancyNotApplicable: true,
    });

    expect(matching.clinicalAssertionsMatched).toBe(true);
    expect(missing.clinicalAssertionsMatched).toBe(false);
  });
});
