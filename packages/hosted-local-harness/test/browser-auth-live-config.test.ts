import { describe, expect, it } from "vitest";
import { HOSTED_BROWSER_AUTH_ENV_KEYS, HOSTED_BROWSER_AUTH_SCENARIO, partitionHostedBrowserAuthEnvironment, requireHostedBrowserAuthConfig } from "../src/browser-auth-live-config.ts";
import { resolveHostedLocalE2eScenarios } from "../src/e2e.ts";

const configured: NodeJS.ProcessEnv = {
  MURPH_E2E_AUTH_PRIVY_APP_ID: "c".repeat(25),
  MURPH_E2E_AUTH_PRIVY_APP_SECRET: "synthetic-private-authority",
  MURPH_E2E_AUTH_PRIVY_VERIFICATION_KEY: "synthetic-public-verifier",
  MURPH_E2E_AUTH_TEST_EMAIL: "test@example.test",
  MURPH_E2E_AUTH_TEST_OTP: "123456",
};

describe("browser authentication authority", () => {
  it("requires every dedicated field when the named journey is selected", () => {
    for (const key of HOSTED_BROWSER_AUTH_ENV_KEYS) {
      const environment = { ...configured };
      delete environment[key];
      expect(() => partitionHostedBrowserAuthEnvironment({ environment, selectedScenarioNames: [HOSTED_BROWSER_AUTH_SCENARIO] })).toThrow(key);
    }
    expect(() => partitionHostedBrowserAuthEnvironment({ environment: {}, selectedScenarioNames: [HOSTED_BROWSER_AUTH_SCENARIO] })).toThrow("missing");
  });
  it("withholds login and management authority from build, image and cleanup commands", () => {
    const result = partitionHostedBrowserAuthEnvironment({ environment: { ...configured, PATH: "/synthetic/bin" }, selectedScenarioNames: [HOSTED_BROWSER_AUTH_SCENARIO] });
    expect(result.genericEnvironment).toEqual({ PATH: "/synthetic/bin", NEXT_PUBLIC_PRIVY_APP_ID: configured.MURPH_E2E_AUTH_PRIVY_APP_ID });
    expect(result.scenarioEnvironment).toEqual(configured);
  });
  it("rejects authority supplied to another or combined scenario without echoing values", () => {
    for (const selectedScenarioNames of [["device-connect"], [HOSTED_BROWSER_AUTH_SCENARIO, "device-connect"]]) {
      expect(() => partitionHostedBrowserAuthEnvironment({ environment: configured, selectedScenarioNames })).toThrow("alone");
    }
    expect(() => requireHostedBrowserAuthConfig({ ...configured, MURPH_E2E_AUTH_TEST_OTP: "never-echo-me" })).toThrow("values are withheld");
  });
  it("does not disguise a migrated issuer as a successful Privy journey", () => {
    expect(() => requireHostedBrowserAuthConfig({ ...configured, HOSTED_BETTER_AUTH_ENABLED: "true" })).toThrow("Better Auth");
  });
  it("keeps the live scenario explicit and the credential-free inventory usable", () => {
    expect(resolveHostedLocalE2eScenarios(HOSTED_BROWSER_AUTH_SCENARIO)).toHaveLength(1);
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(HOSTED_BROWSER_AUTH_SCENARIO);
    expect(partitionHostedBrowserAuthEnvironment({ environment: { CI: "true" }, selectedScenarioNames: ["device-connect"] })).toEqual({ genericEnvironment: { CI: "true" }, scenarioEnvironment: {} });
  });
});
