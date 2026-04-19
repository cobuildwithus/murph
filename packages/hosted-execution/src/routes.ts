export const HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH = "/send";

/** @deprecated Legacy runner commit callback path kept for package compatibility. */
export function buildHostedExecutionRunnerCommitPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/commit`;
}

/** @deprecated Legacy runner side-effect callback path kept for package compatibility. */
export function buildHostedExecutionRunnerSideEffectPath(effectId: string): string {
  return `/effects/${encodeURIComponent(effectId)}`;
}

export function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}
