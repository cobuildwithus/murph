export const HOSTED_WEB_DATABASE_URL_REQUIRED_MESSAGE =
  "DATABASE_URL is required for the hosted web control plane.";

export function assertHostedWebDatabaseUrlConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new TypeError(HOSTED_WEB_DATABASE_URL_REQUIRED_MESSAGE);
  }

  return databaseUrl;
}
