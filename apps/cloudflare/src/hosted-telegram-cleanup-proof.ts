import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import {
  HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET_ENV,
} from "./hosted-provider-egress-credential.js";

const PREFIX = "murph_telegram_cleanup_v1";
const SCHEMA = "murph.hosted-telegram-cleanup-proof.v1";
const SCOPE = "hosted_telegram_message_cleanup";
const SIGNING_CONTEXT = "murph:hosted-telegram-cleanup-proof:v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface HostedTelegramCleanupProofClaims {
  botId: string;
  deliveryTarget: string;
  messageId: string;
  schema: typeof SCHEMA;
  scope: typeof SCOPE;
  userId: string;
}

export async function createHostedTelegramCleanupProof(input: {
  botId: string;
  deliveryTarget: string;
  messageId: string;
  source: Readonly<Record<string, unknown>>;
  userId: string;
}): Promise<string> {
  const claims = normalizeClaims({
    ...input,
    schema: SCHEMA,
    scope: SCOPE,
  });
  if (!claims) {
    throw new TypeError("Hosted Telegram cleanup proof claims are invalid.");
  }
  const payload = bytesToBase64Url(textEncoder.encode(JSON.stringify(claims)));
  const signingInput = `${PREFIX}.${payload}`;
  const signature = await sign(signingInput, input.source);
  return `${signingInput}.${signature}`;
}

export async function verifyHostedTelegramCleanupProof(input: {
  proof: string;
  source: Readonly<Record<string, unknown>>;
}): Promise<HostedTelegramCleanupProofClaims | null> {
  const segments = input.proof.split(".");
  if (segments.length !== 3 || segments[0] !== PREFIX) {
    return null;
  }
  const [prefix, payload, signature] = segments;
  if (!payload || !signature) {
    return null;
  }
  const expected = await sign(`${prefix}.${payload}`, input.source);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  const decoded = base64UrlToBytes(payload);
  if (!decoded) {
    return null;
  }
  try {
    return normalizeClaims(JSON.parse(textDecoder.decode(decoded)));
  } catch {
    return null;
  }
}

function normalizeClaims(value: unknown): HostedTelegramCleanupProofClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const botId = normalizeToken(record.botId, /^[0-9]{1,32}$/u);
  const deliveryTarget = normalizeToken(record.deliveryTarget);
  const messageId = normalizeToken(record.messageId, /^[0-9]{1,32}$/u);
  const userId = normalizeToken(record.userId);
  const target = deliveryTarget ? parseTelegramThreadTarget(deliveryTarget) : null;
  if (
    record.schema !== SCHEMA
    || record.scope !== SCOPE
    || !botId
    || !deliveryTarget
    || !messageId
    || !userId
    || !target
    || (target.botId != null && target.botId !== botId)
  ) {
    return null;
  }
  return {
    botId,
    deliveryTarget,
    messageId,
    schema: SCHEMA,
    scope: SCOPE,
    userId,
  };
}

function normalizeToken(value: unknown, pattern?: RegExp): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 4_096 || (pattern && !pattern.test(normalized))) {
    return null;
  }
  return normalized;
}

async function sign(
  signingInput: string,
  source: Readonly<Record<string, unknown>>,
): Promise<string> {
  const secretValue = source[HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET_ENV];
  const secret = typeof secretValue === "string" ? secretValue.trim() : "";
  if (!secret) {
    throw new Error("Hosted Telegram cleanup proof signing secret is unavailable.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = textEncoder.encode(`${SIGNING_CONTEXT}\0${signingInput}`);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, payload)));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  const remainder = value.length % 4;
  if (remainder === 1) {
    return null;
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    remainder === 0 ? "" : "=".repeat(4 - remainder)
  }`;
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
