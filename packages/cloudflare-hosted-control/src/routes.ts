export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildCloudflareHostedControlUserWakePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/wake`;
}

export function buildCloudflareHostedControlBrowserVaultSessionPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/browser-vault/session`;
}
