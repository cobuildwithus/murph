/** Dedicated development-app authority for the real browser login canary. */
export const HOSTED_BROWSER_AUTH_SCENARIO = "hosted-web-auth-journey";
export const HOSTED_BROWSER_AUTH_ENV_KEYS = [
  "MURPH_E2E_AUTH_PRIVY_APP_ID",
  "MURPH_E2E_AUTH_PRIVY_APP_SECRET",
  "MURPH_E2E_AUTH_PRIVY_VERIFICATION_KEY",
  "MURPH_E2E_AUTH_TEST_EMAIL",
  "MURPH_E2E_AUTH_TEST_OTP",
] as const;

export function requireHostedBrowserAuthConfig(environment: NodeJS.ProcessEnv) {
  const missing = HOSTED_BROWSER_AUTH_ENV_KEYS.filter((key) => !environment[key]?.trim());
  if (missing.length) throw new Error(`Browser auth sandbox missing: ${missing.join(", ")}.`);
  const appId = environment.MURPH_E2E_AUTH_PRIVY_APP_ID!.trim();
  const email = environment.MURPH_E2E_AUTH_TEST_EMAIL!.trim();
  const otp = environment.MURPH_E2E_AUTH_TEST_OTP!.trim();
  if (!/^[a-zA-Z0-9_-]{25}$/u.test(appId)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    || !/^\d{6}$/u.test(otp)) {
    throw new Error("Browser auth sandbox configuration is malformed; values are withheld.");
  }
  if (environment.HOSTED_BETTER_AUTH_ENABLED === "true") {
    throw new Error("Browser Privy journey cannot run after Better Auth issuance is enabled.");
  }
  return {
    appId,
    appSecret: environment.MURPH_E2E_AUTH_PRIVY_APP_SECRET!.trim(),
    verificationKey: environment.MURPH_E2E_AUTH_PRIVY_VERIFICATION_KEY!.trim(),
    email,
    otp,
  };
}

export function removeHostedBrowserAuthEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of HOSTED_BROWSER_AUTH_ENV_KEYS) delete environment[key];
}

export function partitionHostedBrowserAuthEnvironment(input: {
  environment: NodeJS.ProcessEnv;
  selectedScenarioNames: readonly string[];
}) {
  const selected = input.selectedScenarioNames.includes(HOSTED_BROWSER_AUTH_SCENARIO);
  const configured = HOSTED_BROWSER_AUTH_ENV_KEYS.some((key) => input.environment[key] !== undefined);
  const genericEnvironment = { ...input.environment };
  const scenarioEnvironment: NodeJS.ProcessEnv = {};
  removeHostedBrowserAuthEnvironment(genericEnvironment);
  if (!selected && !configured) return { genericEnvironment, scenarioEnvironment };
  if (input.selectedScenarioNames.length !== 1 || !selected) {
    throw new Error(`Run browser auth alone: pnpm hosted-local e2e ${HOSTED_BROWSER_AUTH_SCENARIO}.`);
  }
  const config = requireHostedBrowserAuthConfig(input.environment);
  for (const key of HOSTED_BROWSER_AUTH_ENV_KEYS) scenarioEnvironment[key] = input.environment[key];
  // This public build input must match the app whose real identity token Web verifies.
  genericEnvironment.NEXT_PUBLIC_PRIVY_APP_ID = config.appId;
  return { genericEnvironment, scenarioEnvironment };
}
