import process from "node:process";

export function isHostedLocalWebAuthorityEnvironmentKey(key: string): boolean {
  return key === "HOSTED_APP_SESSION_HMAC_KEY"
    || key.startsWith("HOSTED_BETTER_AUTH_") || key.startsWith("HOSTED_AUTH_");
}

export function sanitizeHostedLocalGenericEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !isHostedLocalWebAuthorityEnvironmentKey(key)));
}

export function removeHostedLocalWebAuthorityEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (isHostedLocalWebAuthorityEnvironmentKey(key)) delete environment[key];
  }
}

export function removeHostedLocalWebAuthorityFromProcessEnvironment(): void {
  removeHostedLocalWebAuthorityEnvironment(process.env);
}

// Capture authentication configuration before generic children lose Web authority.
// Synthetic defaults are for the local Web child and its isolated test issuer.
export function buildHostedLocalWebAuthEnvironment(source: NodeJS.ProcessEnv) {
  const auth = Object.fromEntries(Object.entries(source).filter(([key]) =>
    key.startsWith("HOSTED_AUTH_") || key.startsWith("HOSTED_BETTER_AUTH_")));
  return {
    ...auth,
    HOSTED_BETTER_AUTH_SECRET: auth.HOSTED_BETTER_AUTH_SECRET?.trim() || Buffer.alloc(32, 9).toString("base64url"),
    HOSTED_AUTH_STORAGE_KEY: auth.HOSTED_AUTH_STORAGE_KEY?.trim() || Buffer.alloc(32, 10).toString("base64url"),
  };
}
