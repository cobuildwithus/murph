import "server-only";

const HOSTED_CALL_CIRCLE_OFFERS_ENABLED_ENV = "HOSTED_CALL_CIRCLE_OFFERS_ENABLED";

export function isHostedCallCircleOffersEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return source[HOSTED_CALL_CIRCLE_OFFERS_ENABLED_ENV]?.trim() === "1";
}
