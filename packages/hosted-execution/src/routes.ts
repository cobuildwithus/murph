export const HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH = "/send";

export function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}
