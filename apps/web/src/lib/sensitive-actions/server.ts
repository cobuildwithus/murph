import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { isAddressEqual, recoverMessageAddress } from "viem";

import {
  hasOnlyHostedPrivyPasskeyMfa,
  selectHostedPrivyEmbeddedEthereumWallet,
} from "@/src/lib/hosted-onboarding/privy-wallet-mfa";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";
import { resolveHostedPublicOrigin } from "@/src/lib/hosted-web/public-url";

import {
  isSensitiveActionToken,
  parseSensitiveActionAuthorization,
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
  type SettingsSensitiveActionKind,
} from "./shared";

const SENSITIVE_ACTION_BINDING_VERSION = "murph-sensitive-action-binding-v1";
const SENSITIVE_ACTION_MESSAGE_VERSION = "1";
const SENSITIVE_ACTION_TOKEN_PREFIX = "sac_";
const SENSITIVE_ACTION_TOKEN_BYTES = 24;
const SENSITIVE_ACTION_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export async function createSensitiveActionChallenge(input: {
  bindingHash: string;
  kind: SensitiveActionKind;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
}): Promise<SensitiveActionChallengeResponse> {
  assertBindingHash(input.bindingHash);
  const origin = requireSensitiveActionOrigin();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SENSITIVE_ACTION_CHALLENGE_TTL_MS);
  const challenge = createSensitiveActionChallengeMaterial({
    bindingHash: input.bindingHash,
    expiresAt,
    kind: input.kind,
    origin,
  });

  await input.prisma.hostedSensitiveActionChallenge.create({
    data: {
      bindingHash: input.bindingHash,
      createdAt: now,
      expiresAt,
      kind: input.kind,
      memberId: input.memberId,
      tokenHash: challenge.tokenHash,
    },
  });

  return challenge.response;
}

export interface SensitiveActionChallengeMaterial {
  response: SensitiveActionChallengeResponse;
  tokenHash: string;
}

export function createSensitiveActionChallengeMaterial(input: {
  bindingHash: string;
  expiresAt: Date;
  kind: SensitiveActionKind;
  origin?: string;
}): SensitiveActionChallengeMaterial {
  assertBindingHash(input.bindingHash);
  const token = `${SENSITIVE_ACTION_TOKEN_PREFIX}${randomBytes(SENSITIVE_ACTION_TOKEN_BYTES).toString("base64url")}`;

  return {
    response: {
      expiresAt: input.expiresAt.toISOString(),
      message: buildSensitiveActionMessage({
        bindingHash: input.bindingHash,
        expiresAt: input.expiresAt,
        kind: input.kind,
        origin: input.origin ?? requireSensitiveActionOrigin(),
        token,
      }),
      token,
    },
    tokenHash: sha256Hex(token),
  };
}

export interface VerifiedSensitiveActionChallenge {
  bindingHash: string;
  expiresAt: Date;
  kind: SensitiveActionKind;
  memberId: string;
  tokenHash: string;
}

export async function verifySensitiveActionChallenge(input: {
  authorization: SensitiveActionAuthorization | unknown;
  bindingHash: string;
  kind: SensitiveActionKind;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  privyUserId: string;
}): Promise<VerifiedSensitiveActionChallenge> {
  assertBindingHash(input.bindingHash);
  const authorization = parseSensitiveActionAuthorization(input.authorization);
  if (!authorization) {
    throw sensitiveActionAuthorizationRequired();
  }

  const now = input.now ?? new Date();
  const tokenHash = sha256Hex(authorization.token);
  const challenge = await input.prisma.hostedSensitiveActionChallenge.findUnique({
    where: { tokenHash },
  });

  if (
    !challenge
    || challenge.memberId !== input.memberId
    || challenge.kind !== input.kind
    || challenge.bindingHash !== input.bindingHash
    || challenge.expiresAt <= now
  ) {
    throw sensitiveActionUnavailable();
  }

  let privyUser: unknown;
  try {
    privyUser = await readHostedPrivyUserById(input.privyUserId);
  } catch {
    throw sensitiveActionProviderUnavailable();
  }

  if (
    !privyUser
    || typeof privyUser !== "object"
    || Reflect.get(privyUser, "id") !== input.privyUserId
    || !hasOnlyHostedPrivyPasskeyMfa(privyUser)
  ) {
    throw sensitiveActionSetupRequired();
  }

  const walletSelection = selectHostedPrivyEmbeddedEthereumWallet(privyUser);
  if (walletSelection.status !== "ready") {
    throw sensitiveActionSetupRequired();
  }

  let recoveredAddress: `0x${string}`;
  try {
    recoveredAddress = await recoverMessageAddress({
      message: buildSensitiveActionMessage({
        bindingHash: challenge.bindingHash,
        expiresAt: challenge.expiresAt,
        kind: input.kind,
        origin: requireSensitiveActionOrigin(),
        token: authorization.token,
      }),
      signature: authorization.signature,
    });
  } catch {
    throw sensitiveActionInvalidSignature();
  }

  if (!isAddressEqual(recoveredAddress, walletSelection.wallet.address)) {
    throw sensitiveActionInvalidSignature();
  }

  return {
    bindingHash: challenge.bindingHash,
    expiresAt: challenge.expiresAt,
    kind: challenge.kind as SensitiveActionKind,
    memberId: challenge.memberId,
    tokenHash,
  };
}

export async function consumeSensitiveActionChallenge(input: {
  challenge: VerifiedSensitiveActionChallenge;
  now?: Date;
  prisma: Pick<PrismaClient, "hostedSensitiveActionChallenge">;
}): Promise<void> {
  const consumedAt = input.now ?? new Date();
  if (input.challenge.expiresAt <= consumedAt) {
    throw sensitiveActionUnavailable();
  }

  const consumed = await input.prisma.hostedSensitiveActionChallenge.deleteMany({
    where: {
      bindingHash: input.challenge.bindingHash,
      expiresAt: { gt: consumedAt },
      kind: input.challenge.kind,
      memberId: input.challenge.memberId,
      tokenHash: input.challenge.tokenHash,
    },
  });

  if (consumed.count !== 1) {
    throw sensitiveActionUnavailable();
  }
}

export async function verifyAndConsumeSensitiveActionChallenge(input: {
  authorization: SensitiveActionAuthorization | unknown;
  bindingHash: string;
  kind: SensitiveActionKind;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  privyUserId: string;
}): Promise<void> {
  const challenge = await verifySensitiveActionChallenge(input);
  await consumeSensitiveActionChallenge({
    challenge,
    now: input.now,
    prisma: input.prisma,
  });
}

export function buildSettingsSensitiveActionBinding(input: {
  kind: SettingsSensitiveActionKind;
  memberId: string;
  sessionId: string;
}): string {
  return sha256Hex([
    SENSITIVE_ACTION_BINDING_VERSION,
    input.kind,
    input.memberId,
    input.sessionId,
  ].join("\n"));
}

export function buildSensitiveActionMessage(input: {
  bindingHash: string;
  expiresAt: Date;
  kind: SensitiveActionKind;
  origin: string;
  token: string;
}): string {
  assertBindingHash(input.bindingHash);
  if (!isSensitiveActionToken(input.token)) {
    throw new TypeError("Sensitive-action challenge token is invalid.");
  }

  return [
    "Murph sensitive action authorization",
    `Version: ${SENSITIVE_ACTION_MESSAGE_VERSION}`,
    `Origin: ${input.origin}`,
    `Action: ${input.kind}`,
    `Binding: sha256:${input.bindingHash}`,
    `Challenge: ${input.token}`,
    `Expires At: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

function requireSensitiveActionOrigin(): string {
  const origin = resolveHostedPublicOrigin();
  if (!origin) {
    throw sensitiveActionProviderUnavailable();
  }
  return origin;
}

function assertBindingHash(value: string): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new TypeError("Sensitive-action binding must be a SHA-256 hex digest.");
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sensitiveActionAuthorizationRequired() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED",
    httpStatus: 400,
    message: "Secure approval is required to continue.",
  });
}

function sensitiveActionSetupRequired() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_SETUP_REQUIRED",
    httpStatus: 409,
    message: "Set up a passkey-protected Murph wallet before continuing.",
  });
}

function sensitiveActionInvalidSignature() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_INVALID_SIGNATURE",
    httpStatus: 403,
    message: "Your secure approval could not be verified. Try again.",
  });
}

function sensitiveActionUnavailable() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_UNAVAILABLE",
    httpStatus: 410,
    message: "This secure approval is expired, already used, or no longer available.",
  });
}

function sensitiveActionProviderUnavailable() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_PROVIDER_UNAVAILABLE",
    httpStatus: 503,
    message: "Secure approval is temporarily unavailable.",
    retryable: true,
  });
}
