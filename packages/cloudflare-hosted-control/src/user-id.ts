export function requireCloudflareHostedControlUserId(
  value: string,
  label = "Cloudflare hosted control userId",
): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}
