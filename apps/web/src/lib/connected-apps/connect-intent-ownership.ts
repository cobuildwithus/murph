export const HOSTED_CONNECTED_APP_STARTED_INTENT_OWNER_GRACE_MS =
  30 * 60 * 1_000;

export function hostedConnectedAppStartedIntentOwnerCutoff(now: Date): Date {
  return new Date(
    now.getTime() - HOSTED_CONNECTED_APP_STARTED_INTENT_OWNER_GRACE_MS,
  );
}
