export function buildCloudflareHostedControlUserCryptoContextPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/crypto-context`;
}

export function buildCloudflareHostedControlUserDispatchPayloadPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/dispatch-payload`;
}

export function buildCloudflareHostedControlUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
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
