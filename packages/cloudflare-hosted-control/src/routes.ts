export function buildCloudflareHostedControlUserEventStatusPath(
  userId: string,
  eventId: string,
): string {
  return `/internal/users/${encodeURIComponent(userId)}/events/${encodeURIComponent(eventId)}/status`;
}

export function buildCloudflareHostedControlUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}
