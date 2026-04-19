import { createHmac, timingSafeEqual } from "node:crypto";

import {
  decodeHostedEncryptionKey,
  decodeHostedEncryptionKeyring,
} from "../device-sync/crypto";
import { normalizeNullableString } from "../device-sync/shared";

const HOSTED_WAKE_FETCH_PROOF_CONTEXT = "murph.hosted-wake.fetch-proof.v1:";
const HOSTED_WAKE_FETCH_PROOF_MAX_TTL_SECONDS = 5 * 60;
const HOSTED_WAKE_FETCH_PROOF_CLOCK_SKEW_SECONDS = 60;

interface HostedWakeFetchProofClaims {
  exp: number;
  fetchedCommittedSeq: string;
  fetchedCursorVersion: string;
  iat: number;
  kind: "hosted-wake-fetch-proof";
  userId: string;
  wakeId: string;
  wakeSeq: string;
}

interface HostedWakeFetchProofKeyring {
  currentKey: Buffer;
  currentKeyId: string;
  keysById: Readonly<Record<string, Buffer>>;
}

type HostedWakeFetchProofEnvSource = Readonly<Record<string, string | undefined>>;

export function issueHostedWakeFetchProof(input: {
  fetchedCommittedSeq: bigint;
  fetchedCursorVersion: bigint;
  now?: Date;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): string {
  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const claims: HostedWakeFetchProofClaims = {
    exp: nowSeconds + HOSTED_WAKE_FETCH_PROOF_MAX_TTL_SECONDS,
    fetchedCommittedSeq: input.fetchedCommittedSeq.toString(),
    fetchedCursorVersion: input.fetchedCursorVersion.toString(),
    iat: nowSeconds,
    kind: "hosted-wake-fetch-proof",
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq.toString(),
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const keyring = readHostedWakeFetchProofKeyring();
  const signature = signHostedWakeFetchProof(encodedClaims, keyring.currentKey);

  return `${keyring.currentKeyId}.${encodedClaims}.${signature}`;
}

export function verifyHostedWakeFetchProof(input: {
  now?: Date;
  proof: string;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): HostedWakeFetchProofClaims {
  const proof = normalizeNullableString(input.proof);

  if (!proof) {
    throw new TypeError("Hosted wake fetch proof must not be blank.");
  }

  const [keyId, encodedClaims, signature, ...rest] = proof.split(".");

  if (!keyId || !encodedClaims || !signature || rest.length > 0) {
    throw new TypeError("Hosted wake fetch proof must use keyId.payload.signature format.");
  }

  const keyring = readHostedWakeFetchProofKeyring();
  const key = keyring.keysById[keyId];

  if (!key) {
    throw new TypeError(`Hosted wake fetch proof keyId ${keyId} is not configured.`);
  }

  const expectedSignature = signHostedWakeFetchProof(encodedClaims, key);

  if (!secureEqual(expectedSignature, signature)) {
    throw new TypeError("Hosted wake fetch proof signature is invalid.");
  }

  const claims = parseHostedWakeFetchProofClaims(encodedClaims);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (claims.kind !== "hosted-wake-fetch-proof") {
    throw new TypeError("Hosted wake fetch proof kind is invalid.");
  }

  if (claims.userId !== input.userId) {
    throw new TypeError("Hosted wake fetch proof userId does not match the requested user.");
  }

  if (claims.wakeId !== input.wakeId) {
    throw new TypeError("Hosted wake fetch proof wakeId does not match the requested wake.");
  }

  if (claims.wakeSeq !== input.wakeSeq.toString()) {
    throw new TypeError("Hosted wake fetch proof wakeSeq does not match the requested seq.");
  }

  if (claims.exp <= claims.iat) {
    throw new TypeError("Hosted wake fetch proof timestamps are invalid.");
  }

  if (claims.exp - claims.iat > HOSTED_WAKE_FETCH_PROOF_MAX_TTL_SECONDS) {
    throw new TypeError("Hosted wake fetch proof lifetime is too long.");
  }

  if (nowSeconds < claims.iat - HOSTED_WAKE_FETCH_PROOF_CLOCK_SKEW_SECONDS) {
    throw new TypeError("Hosted wake fetch proof is not valid yet.");
  }

  if (nowSeconds > claims.exp + HOSTED_WAKE_FETCH_PROOF_CLOCK_SKEW_SECONDS) {
    throw new TypeError("Hosted wake fetch proof has expired.");
  }

  return claims;
}

function parseHostedWakeFetchProofClaims(encodedClaims: string): HostedWakeFetchProofClaims {
  let decoded = "";

  try {
    decoded = Buffer.from(encodedClaims, "base64url").toString("utf8");
  } catch {
    throw new TypeError("Hosted wake fetch proof payload is not valid base64url JSON.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new TypeError("Hosted wake fetch proof payload is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted wake fetch proof payload must be a JSON object.");
  }

  const {
    exp,
    fetchedCommittedSeq,
    fetchedCursorVersion,
    iat,
    kind,
    userId,
    wakeId,
    wakeSeq,
  } = parsed as Record<string, unknown>;

  if (
    kind !== "hosted-wake-fetch-proof"
    || typeof userId !== "string"
    || typeof wakeId !== "string"
    || typeof wakeSeq !== "string"
    || typeof fetchedCommittedSeq !== "string"
    || typeof fetchedCursorVersion !== "string"
    || typeof iat !== "number"
    || typeof exp !== "number"
  ) {
    throw new TypeError("Hosted wake fetch proof payload is missing required claims.");
  }

  return {
    exp,
    fetchedCommittedSeq,
    fetchedCursorVersion,
    iat,
    kind,
    userId,
    wakeId,
    wakeSeq,
  };
}

function signHostedWakeFetchProof(encodedClaims: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update(HOSTED_WAKE_FETCH_PROOF_CONTEXT)
    .update(encodedClaims)
    .digest("base64url");
}

function readHostedWakeFetchProofKeyring(
  source: HostedWakeFetchProofEnvSource = process.env,
): HostedWakeFetchProofKeyring {
  const currentKeyId = normalizeNullableString(source.HOSTED_WAKE_FETCH_PROOF_KEY_ID) ?? "v1";
  const currentKeyValue = normalizeNullableString(source.HOSTED_WAKE_FETCH_PROOF_KEY);

  if (!currentKeyValue) {
    throw new TypeError(
      "HOSTED_WAKE_FETCH_PROOF_KEY is required for hosted wake fetch proofing.",
    );
  }

  const currentKey = decodeHostedEncryptionKey(currentKeyValue);
  const keysById = decodeHostedEncryptionKeyring({
    currentKey,
    currentKeyVersion: currentKeyId,
    keyringJson: normalizeNullableString(source.HOSTED_WAKE_FETCH_PROOF_KEYRING_JSON),
    label: "HOSTED_WAKE_FETCH_PROOF_KEYRING_JSON",
  });

  return {
    currentKey,
    currentKeyId,
    keysById,
  };
}

function secureEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}
