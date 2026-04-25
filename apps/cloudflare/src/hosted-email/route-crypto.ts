/**
 * Hosted email route crypto owns reply-alias token signing. Keeping these HMAC
 * helpers separate lets routing code reuse them without also depending on
 * storage layout details.
 */

const CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH = 32;
const CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH = 25;
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const CURRENT_HOSTED_EMAIL_ALIAS_KEY_PATTERN = new RegExp(
  `^[0-9a-f]{${CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH}}$`,
  "u",
);
const CURRENT_HOSTED_EMAIL_BASE36_SEGMENT_PATTERN = new RegExp(
  `^[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}}$`,
  "u",
);
const CURRENT_HOSTED_EMAIL_ROUTE_TOKEN_PATTERN = new RegExp(
  [
    "^u2-",
    `(?<aliasKey>[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}})`,
    "-",
    `(?<signature>[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}})`,
    "$",
  ].join(""),
  "u",
);

export async function createHostedEmailRouteToken(input: {
  aliasKey: string;
  secret: string;
}): Promise<string> {
  const aliasKey = input.aliasKey.trim().toLowerCase();
  const encodedAliasKey = encodeFixedBase36Hex(aliasKey);
  const signature = await createHostedEmailRouteSignature({
    aliasKey,
    secret: input.secret,
  });
  return `u2-${encodedAliasKey}-${signature}`;
}

export async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<{ aliasKey: string } | null> {
  const token = input.token.trim().toLowerCase();
  const currentMatch = CURRENT_HOSTED_EMAIL_ROUTE_TOKEN_PATTERN.exec(token);
  if (currentMatch?.groups) {
    const aliasKey = decodeFixedBase36Hex(currentMatch.groups.aliasKey);
    if (!aliasKey) {
      return null;
    }

    const expected = await createHostedEmailRouteSignature({
      aliasKey,
      secret: input.secret,
    });
    if (!constantTimeStringEqual(
      expected,
      currentMatch.groups.signature,
      CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH,
    )) {
      return null;
    }

    return {
      aliasKey,
    };
  }
  return null;
}

export async function deriveStableHostedEmailKey(secret: string, payload: string): Promise<string> {
  return (await createHostedEmailRouteHash({ payload, secret })).slice(
    0,
    CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH,
  );
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
  aliasKey: string;
  secret: string;
}): Promise<string> {
  const signatureHex = (await createHostedEmailRouteHash({
    payload: `u2:${input.aliasKey}`,
    secret: input.secret,
  })).slice(0, CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH);

  return encodeFixedBase36Hex(signatureHex);
}

function isCurrentHostedEmailAliasKey(value: string): boolean {
  return CURRENT_HOSTED_EMAIL_ALIAS_KEY_PATTERN.test(value);
}

function encodeFixedBase36Hex(hex: string): string {
  const normalized = hex.toLowerCase();
  if (!isCurrentHostedEmailAliasKey(normalized)) {
    throw new TypeError("Hosted email route value must be 128-bit lowercase hex.");
  }

  return BigInt(`0x${normalized}`)
    .toString(36)
    .padStart(CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH, "0");
}

function decodeFixedBase36Hex(value: string): string | null {
  if (!CURRENT_HOSTED_EMAIL_BASE36_SEGMENT_PATTERN.test(value)) {
    return null;
  }

  let parsed = 0n;
  for (const character of value) {
    const digit = BASE36_ALPHABET.indexOf(character);
    if (digit < 0) {
      return null;
    }
    parsed = parsed * 36n + BigInt(digit);
  }

  if (parsed >= 2n ** BigInt((CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH / 2) * 8)) {
    return null;
  }

  return parsed
    .toString(16)
    .padStart(CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH, "0");
}

function constantTimeStringEqual(left: string, right: string, expectedLength: number): boolean {
  if (left.length !== expectedLength || right.length !== expectedLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
