export function buildCloudflareHostedControlUserEventStatusPath(
  userId: string,
  eventId: string,
): string {
  return `/internal/users/${encodeURIComponent(userId)}/events/${encodeURIComponent(eventId)}/status`;
}

export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildCloudflareHostedControlBrowserVaultSessionPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/browser-vault/session`;
}
