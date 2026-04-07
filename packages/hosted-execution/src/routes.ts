export const HOSTED_EXECUTION_DISPATCH_PATH = "/internal/dispatch";
export const HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH = "/send";

export function buildHostedExecutionRunnerCommitPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/commit`;
}

export function buildHostedExecutionRunnerSideEffectPath(effectId: string): string {
  return `/effects/${encodeURIComponent(effectId)}`;
}

export function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}
