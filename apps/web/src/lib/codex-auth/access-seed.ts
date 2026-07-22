import "server-only";

import type { Prisma } from "@prisma/client";
import {
  HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH,
  HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH,
} from "@murphai/hosted-execution/runtime-control";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";

export const HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION = 1 as const;
export const HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS = 5 * 60 * 1_000;
export const HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS = 2 * 60 * 60 * 1_000;
export const HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH =
  HOSTED_CODEX_AUTH_SEED_ACCESS_TOKEN_MAX_LENGTH;
export const HOSTED_CODEX_AUTH_ACCOUNT_ID_MAX_LENGTH =
  HOSTED_CODEX_AUTH_SEED_CHATGPT_ACCOUNT_ID_MAX_LENGTH;

const HOSTED_CODEX_AUTH_ACCESS_SEED_SCOPE = "hosted-codex-auth:access-seed:v1";
const HOSTED_CODEX_AUTH_ACCESS_SEED_PURPOSE = "hosted-codex-auth-access-seed";
const HOSTED_CODEX_AUTH_ACCESS_SEED_TABLE = "hosted_codex_auth_connection";
const HOSTED_CODEX_AUTH_ACCESS_SEED_FIELD = "access_seed_encrypted";
const HOSTED_CODEX_AUTH_ACCESS_SEED_KEYS = new Set([
  "accessToken",
  "chatgptAccountId",
  "expiresAt",
  "schemaVersion",
]);
const HOSTED_CODEX_AUTH_ACCESS_SEED_PLAINTEXT_KEYS = new Set([
  "accessToken",
  "chatgptAccountId",
  "schemaVersion",
]);
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

export interface HostedCodexAuthAccessSeed {
  accessToken: string;
  chatgptAccountId: string;
  schemaVersion: typeof HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION;
}

export interface HostedCodexAuthAccessSeedSubmission extends HostedCodexAuthAccessSeed {
  expiresAt: Date;
}

export interface HostedCodexAuthAccessSeedCryptoInput {
  attemptId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}

export interface HostedCodexAuthAccessSeedCrypto {
  decrypt(
    input: HostedCodexAuthAccessSeedCryptoInput & { value: string },
  ): Promise<HostedCodexAuthAccessSeed>;
  encrypt(
    input: HostedCodexAuthAccessSeedCryptoInput & { value: HostedCodexAuthAccessSeed },
  ): Promise<string>;
}

export class HostedCodexAuthAccessSeedPayloadError extends Error {
  constructor() {
    super("Hosted Codex auth access seed plaintext is invalid.");
    this.name = "HostedCodexAuthAccessSeedPayloadError";
  }
}

export function isHostedCodexAuthAccessSeedPayloadError(
  error: unknown,
): error is HostedCodexAuthAccessSeedPayloadError {
  return error instanceof HostedCodexAuthAccessSeedPayloadError;
}

export const hostedCodexAuthAccessSeedCrypto: HostedCodexAuthAccessSeedCrypto = {
  async decrypt(input) {
    const plaintext = await openHostedUserSecureBoxString({
      aad: hostedCodexAuthAccessSeedAad(input.attemptId, input.memberId),
      lane: "hosted-member-private-field",
      prisma: input.prisma,
      scope: HOSTED_CODEX_AUTH_ACCESS_SEED_SCOPE,
      userId: input.memberId,
      value: input.value,
    });
    if (!plaintext) {
      throw new HostedCodexAuthAccessSeedPayloadError();
    }

    return parseHostedCodexAuthAccessSeedPlaintext(plaintext);
  },

  async encrypt(input) {
    const ciphertext = await sealHostedUserSecureBoxString({
      aad: hostedCodexAuthAccessSeedAad(input.attemptId, input.memberId),
      lane: "hosted-member-private-field",
      prisma: input.prisma,
      scope: HOSTED_CODEX_AUTH_ACCESS_SEED_SCOPE,
      userId: input.memberId,
      value: JSON.stringify(input.value),
    });
    if (!ciphertext) {
      throw new Error("Hosted Codex auth access seed encryption failed.");
    }

    return ciphertext;
  },
};

export function parseHostedCodexAuthAccessSeedSubmission(
  value: Record<string, unknown>,
  now: Date = new Date(),
): HostedCodexAuthAccessSeedSubmission {
  assertExactKeys(value, HOSTED_CODEX_AUTH_ACCESS_SEED_KEYS);
  if (value.schemaVersion !== HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION) {
    throw invalidHostedCodexAuthAccessSeedError();
  }

  const accessToken = parseVisibleBoundedString(
    value.accessToken,
    HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH,
  );
  const chatgptAccountId = parseVisibleBoundedString(
    value.chatgptAccountId,
    HOSTED_CODEX_AUTH_ACCOUNT_ID_MAX_LENGTH,
  );
  const expiresAt = parseBoundedExpiry(value.expiresAt, now);

  return {
    accessToken,
    chatgptAccountId,
    expiresAt,
    schemaVersion: HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION,
  };
}

export function hostedCodexAuthAccessSeedHasUsableLifetime(
  expiresAt: Date,
  now: Date,
): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  return Number.isFinite(remainingMs)
    && remainingMs >= HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS
    && remainingMs <= HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS;
}

export function assertHostedCodexAuthAccessSeedHasUsableLifetime(
  expiresAt: Date,
  now: Date,
): void {
  if (!hostedCodexAuthAccessSeedHasUsableLifetime(expiresAt, now)) {
    throw invalidHostedCodexAuthAccessSeedError();
  }
}

function parseHostedCodexAuthAccessSeedPlaintext(
  plaintext: string,
): HostedCodexAuthAccessSeed {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new HostedCodexAuthAccessSeedPayloadError();
  }
  if (!isPlainRecord(value)) {
    throw new HostedCodexAuthAccessSeedPayloadError();
  }

  try {
    assertExactKeys(value, HOSTED_CODEX_AUTH_ACCESS_SEED_PLAINTEXT_KEYS);
    if (value.schemaVersion !== HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION) {
      throw new TypeError("Hosted Codex auth access seed schema is invalid.");
    }
    return {
      accessToken: parseVisibleBoundedString(
        value.accessToken,
        HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH,
      ),
      chatgptAccountId: parseVisibleBoundedString(
        value.chatgptAccountId,
        HOSTED_CODEX_AUTH_ACCOUNT_ID_MAX_LENGTH,
      ),
      schemaVersion: HOSTED_CODEX_AUTH_ACCESS_SEED_SCHEMA_VERSION,
    };
  } catch {
    throw new HostedCodexAuthAccessSeedPayloadError();
  }
}

function hostedCodexAuthAccessSeedAad(attemptId: string, memberId: string) {
  return {
    field: HOSTED_CODEX_AUTH_ACCESS_SEED_FIELD,
    purpose: HOSTED_CODEX_AUTH_ACCESS_SEED_PURPOSE,
    rowId: memberId,
    sequence: attemptId,
    table: HOSTED_CODEX_AUTH_ACCESS_SEED_TABLE,
  } as const;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    throw invalidHostedCodexAuthAccessSeedError();
  }
}

function parseVisibleBoundedString(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || !VISIBLE_ASCII_PATTERN.test(value)
  ) {
    throw invalidHostedCodexAuthAccessSeedError();
  }
  return value;
}

function parseBoundedExpiry(value: unknown, now: Date): Date {
  if (typeof value !== "string") {
    throw invalidHostedCodexAuthAccessSeedError();
  }
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    throw invalidHostedCodexAuthAccessSeedError();
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.slice(0, 3).padEnd(3, "0"));
  const expiresAt = new Date(0);
  expiresAt.setUTCFullYear(year, month - 1, day);
  expiresAt.setUTCHours(hour, minute, second, millisecond);
  if (
    expiresAt.getUTCFullYear() !== year
    || expiresAt.getUTCMonth() !== month - 1
    || expiresAt.getUTCDate() !== day
    || expiresAt.getUTCHours() !== hour
    || expiresAt.getUTCMinutes() !== minute
    || expiresAt.getUTCSeconds() !== second
    || expiresAt.getUTCMilliseconds() !== millisecond
  ) {
    throw invalidHostedCodexAuthAccessSeedError();
  }

  assertHostedCodexAuthAccessSeedHasUsableLifetime(expiresAt, now);
  return expiresAt;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function invalidHostedCodexAuthAccessSeedError() {
  return hostedOnboardingError({
    code: "HOSTED_CODEX_AUTH_ACCESS_SEED_INVALID",
    httpStatus: 400,
    message: "ChatGPT credential is invalid.",
  });
}
