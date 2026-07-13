import process from "node:process";

const HOSTED_APP_SESSION_HMAC_KEY_ENV = "HOSTED_APP_SESSION_HMAC_KEY";

export function sanitizeHostedLocalGenericEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  delete sanitized[HOSTED_APP_SESSION_HMAC_KEY_ENV];
  return sanitized;
}

export function removeHostedLocalWebAuthorityFromProcessEnvironment(): void {
  delete process.env[HOSTED_APP_SESSION_HMAC_KEY_ENV];
}
