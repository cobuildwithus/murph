export function buildCloudflareHostedControlPendingUsageUsersPath(): string {
  return "/internal/usage/pending-users";
}

export function buildCloudflareHostedControlSharePackPath(userId: string, shareId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/shares/${encodeURIComponent(shareId)}/pack`;
}

export function buildCloudflareHostedControlUserCryptoContextPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/crypto-context`;
}

export function buildCloudflareHostedControlUserDispatchPayloadPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/dispatch-payload`;
}

export function buildCloudflareHostedControlUserEventStatusPath(
  userId: string,
  eventId: string,
): string {
  return `/internal/users/${encodeURIComponent(userId)}/events/${encodeURIComponent(eventId)}/status`;
}

export function buildCloudflareHostedControlUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
}

export function buildCloudflareHostedControlUserPendingUsagePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/usage/pending`;
}

export function buildCloudflareHostedControlUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildCloudflareHostedControlUserStoredDispatchPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/dispatch-payload/dispatch`;
}
