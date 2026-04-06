/**
 * Hosted email route crypto owns alias-token signing plus verified-sender hash
 * derivation. Keeping these HMAC helpers separate lets routing code reuse them
 * without also depending on storage layout details.
 */

export async function createHostedEmailRouteToken(input: {
  aliasKey: string;
  secret: string;
}): Promise<string> {
  const signature = await createHostedEmailRouteSignature({
    payload: `u:${input.aliasKey}`,
    secret: input.secret,
  });
  return `u-${input.aliasKey}-${signature}`;
}

export async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<{ aliasKey: string } | null> {
  const match = /^u-(?<aliasKey>[A-Za-z0-9]+)-(?<signature>[0-9a-f]+)$/u.exec(input.token.trim());
  if (!match?.groups) {
    return null;
  }

  const payload = `u:${match.groups.aliasKey}`;
  const expected = await createHostedEmailRouteSignature({
    payload,
    secret: input.secret,
  });
  if (expected !== match.groups.signature.toLowerCase()) {
    return null;
  }

  return {
    aliasKey: match.groups.aliasKey,
  };
}

export async function deriveStableHostedEmailKey(secret: string, payload: string): Promise<string> {
  return (await createHostedEmailRouteSignature({ payload, secret })).slice(0, 16);
}

export async function deriveHostedEmailVerifiedSenderKey(
  secret: string,
  verifiedEmailAddress: string,
): Promise<string> {
  return deriveStableHostedEmailKey(secret, `verified-sender:${verifiedEmailAddress}`);
}

export async function deriveHostedEmailVerifiedSenderHash(
  secret: string,
  verifiedEmailAddress: string,
): Promise<string> {
  return createHostedEmailRouteHash({
    payload: `verified-owner:${verifiedEmailAddress}`,
    secret,
  });
}

async function createHostedEmailRouteHash(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input.payload)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createHostedEmailRouteSignature(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  return (await createHostedEmailRouteHash(input)).slice(0, 32);
}
