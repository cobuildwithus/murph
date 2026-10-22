/** Account-wide public variants bypass requireSignedURLs on every hosted image.
 * Check the actual account before uploading or activating this Worker version.
 * This is read-only and uses the existing hosted deployment credential.
 */
export async function assertPrivateGameImageVariants(
  source: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const accountId = source.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = source.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) throw new Error("Game Images admission requires hosted Cloudflare credentials.");
  let payload: unknown;
  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/images/v1/variants`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Unavailable");
    payload = await response.json();
  } catch {
    // Provider messages/URLs must not enter deploy logs.
    throw new Error("Game Images admission failed: cannot read account variants; verify Images Read permission.");
  }
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.result)
    || !isRecord(payload.result.variants)) {
    throw new Error("Game Images admission failed: invalid variants response.");
  }
  const variants = payload.result.variants;
  for (const variant of Object.values(variants)) {
    if (!isRecord(variant) || (variant.neverRequireSignedURLs !== undefined && variant.neverRequireSignedURLs !== false)) {
      throw new Error("Game Images admission failed: account variant bypasses private delivery.");
    }
  }
  for (const [id, pixels] of [["game-avatar", 600], ["game-photo", 1600]] as const) {
    const variant = variants[id];
    if (!isRecord(variant) || variant.id !== id || !isRecord(variant.options)
      || variant.options.width !== pixels || variant.options.height !== pixels
      || variant.options.fit !== "scale-down" || variant.options.metadata !== "none") {
      throw new Error("Game Images admission failed: required private renditions are missing or misconfigured.");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
