export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildCloudflareHostedControlUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildCloudflareHostedControlBrowserVaultSessionPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/browser-vault/session`;
}
