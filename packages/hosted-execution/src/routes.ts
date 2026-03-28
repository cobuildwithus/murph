export const HOSTED_EXECUTION_DISPATCH_PATH = "/internal/dispatch";

export function buildHostedExecutionUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildHostedExecutionUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildHostedExecutionUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
}
