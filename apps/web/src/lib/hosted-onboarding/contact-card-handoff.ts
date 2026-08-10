import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { findMurphContactAvatarOption } from "../murph-contact-avatars";
import { isRecord } from "../primitives";
import { readHostedContactPrivacyKeyring } from "./env";
import { hostedOnboardingError } from "./errors";

const MURPH_CONTACT_CARD_HANDOFF_TOKEN_PREFIX =
  "murph-contact-card-handoff-v1";
const MURPH_CONTACT_CARD_HANDOFF_HMAC_CONTEXT =
  "hosted-murph-contact-card-handoff-v1";
const MURPH_CONTACT_CARD_HANDOFF_TTL_SECONDS = 5 * 60;
const MURPH_CONTACT_CARD_HANDOFF_CLOCK_SKEW_SECONDS = 30;
const MURPH_CONTACT_CARD_HANDOFF_ID_MAX_LENGTH = 256;
export const MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID =
  "native-companion";
const MURPH_CONTACT_CARD_HANDOFF_TOKEN_PATTERN =
  /^murph-contact-card-handoff-v1\.(v[0-9]+)\.([A-Za-z0-9_-]{1,1366})\.([A-Za-z0-9_-]{43})$/u;

interface MurphContactCardHandoffPayload {
  avatarId: string;
  exp: number;
  iat: number;
  memberId: string;
  sessionId: string;
}

export interface MurphContactCardHandoffClaim {
  avatarId: string;
  memberId: string;
  sessionId: string;
}

class MurphContactCardHandoffInvalidError extends Error {
  constructor() {
    super("Murph contact-card handoff is invalid.");
    this.name = "MurphContactCardHandoffInvalidError";
  }
}

export function issueMurphContactCardHandoffClaim(input: {
  avatarId: string;
  memberId: string;
  now?: Date;
  sessionId: string;
}): string {
  const issuedAt = toUnixSeconds(input.now ?? new Date());
  const payload = encodePayload({
    avatarId: requireAvatarId(input.avatarId),
    exp: issuedAt + MURPH_CONTACT_CARD_HANDOFF_TTL_SECONDS,
    iat: issuedAt,
    memberId: requireClaimId(input.memberId),
    sessionId: requireClaimId(input.sessionId),
  });
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const keyVersion = keyring.currentVersion;
  const sourceKey = keyring.keysByVersion[keyVersion];

  if (!sourceKey) {
    throw new TypeError(
      `Hosted contact privacy keyring is missing ${keyVersion}.`,
    );
  }

  const signingInput = buildSigningInput(keyVersion, payload);
  return `${signingInput}.${signMurphContactCardHandoff(signingInput, sourceKey)}`;
}

export function requireMurphContactCardHandoffClaim(
  value: string | null | undefined,
  options: { now?: Date } = {},
): MurphContactCardHandoffClaim {
  try {
    return readMurphContactCardHandoffClaim(value, options.now ?? new Date());
  } catch (error) {
    if (error instanceof MurphContactCardHandoffInvalidError) {
      throw hostedOnboardingError({
        code: "MURPH_CONTACT_CARD_HANDOFF_INVALID",
        httpStatus: 401,
        message: "This contact-card handoff is invalid or expired. Try again from Murph.",
        retryable: true,
      });
    }

    throw error;
  }
}

function readMurphContactCardHandoffClaim(
  value: string | null | undefined,
  now: Date,
): MurphContactCardHandoffClaim {
  const match = typeof value === "string"
    ? MURPH_CONTACT_CARD_HANDOFF_TOKEN_PATTERN.exec(value)
    : null;
  const keyVersion = match?.[1];
  const payloadEncoded = match?.[2];
  const signature = match?.[3];
  if (!keyVersion || !payloadEncoded || !signature) {
    throw new MurphContactCardHandoffInvalidError();
  }

  const keyring = readHostedContactPrivacyKeyring(process.env);
  const sourceKey = keyring.keysByVersion[keyVersion];
  if (!sourceKey) {
    throw new MurphContactCardHandoffInvalidError();
  }

  const signingInput = buildSigningInput(keyVersion, payloadEncoded);
  const expectedSignature = signMurphContactCardHandoff(signingInput, sourceKey);
  if (!secureEqual(signature, expectedSignature)) {
    throw new MurphContactCardHandoffInvalidError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(payloadEncoded, "base64url").toString("utf8"),
    );
  } catch {
    throw new MurphContactCardHandoffInvalidError();
  }

  const payload = requirePayload(parsed);
  const nowSeconds = toUnixSeconds(now);
  if (
    payload.exp <= payload.iat
    || payload.exp - payload.iat > MURPH_CONTACT_CARD_HANDOFF_TTL_SECONDS
    || payload.iat > nowSeconds + MURPH_CONTACT_CARD_HANDOFF_CLOCK_SKEW_SECONDS
    || payload.exp <= nowSeconds
  ) {
    throw new MurphContactCardHandoffInvalidError();
  }

  return {
    avatarId: payload.avatarId,
    memberId: payload.memberId,
    sessionId: payload.sessionId,
  };
}

function requirePayload(value: unknown): MurphContactCardHandoffPayload {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join("|") !==
      "avatarId|exp|iat|memberId|sessionId"
    || typeof value.iat !== "number"
    || typeof value.exp !== "number"
    || !Number.isSafeInteger(value.iat)
    || !Number.isSafeInteger(value.exp)
  ) {
    throw new MurphContactCardHandoffInvalidError();
  }

  return {
    avatarId: requireAvatarId(value.avatarId),
    exp: value.exp,
    iat: value.iat,
    memberId: requireClaimId(value.memberId),
    sessionId: requireClaimId(value.sessionId),
  };
}

function encodePayload(payload: MurphContactCardHandoffPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function buildSigningInput(keyVersion: string, payload: string): string {
  return `${MURPH_CONTACT_CARD_HANDOFF_TOKEN_PREFIX}.${keyVersion}.${payload}`;
}

function signMurphContactCardHandoff(
  signingInput: string,
  sourceKey: Buffer,
): string {
  const signingKey = createHash("sha256")
    .update(MURPH_CONTACT_CARD_HANDOFF_HMAC_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(sourceKey)
    .digest();

  return createHmac("sha256", signingKey)
    .update(signingInput, "utf8")
    .digest("base64url");
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAvatarId(value: unknown): string {
  if (typeof value !== "string") {
    throw new MurphContactCardHandoffInvalidError();
  }

  const avatar = findMurphContactAvatarOption(value);
  if (avatar.id !== value) {
    throw new MurphContactCardHandoffInvalidError();
  }

  return avatar.id;
}

function requireClaimId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MURPH_CONTACT_CARD_HANDOFF_ID_MAX_LENGTH
    || value !== value.trim()
  ) {
    throw new MurphContactCardHandoffInvalidError();
  }

  return value;
}

function toUnixSeconds(value: Date): number {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("Murph contact-card handoff time is invalid.");
  }

  return Math.floor(timestamp / 1_000);
}
