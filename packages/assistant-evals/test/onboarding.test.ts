import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  createOnboardingEvalTurnEnvironment,
  onboardingScenarios,
} from "../src/onboarding.js";

describe("onboarding eval composition", () => {
  it("binds every evaluated turn to its isolated case vault", () => {
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
});
