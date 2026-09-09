import "server-only";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createHash } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

export const MAX_APPROVAL_PASSKEYS = 8;

export interface ApprovalPasskey {
  id: string;
  publicKey: string;
  counter: number;
}

// The signed challenge message already binds the action, member/session,
// application origin and expiry. Use all of it as the WebAuthn challenge.
export function approvalWebAuthnChallenge(message: string): string {
  return createHash("sha256")
    .update("murph.approval.webauthn.v1\n")
    .update(message)
    .digest("base64url");
}

export function approvalPasskeyRegistrationOptions(input: {
  credentials: readonly ApprovalPasskey[];
  memberId: string;
  message: string;
  origin: string;
}) {
  if (input.credentials.length >= MAX_APPROVAL_PASSKEYS) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_PASSKEY_LIMIT", httpStatus: 409, message: "This account already has eight approval passkeys." });
  }
  return generateRegistrationOptions({
    rpID: new URL(input.origin).hostname,
    rpName: "Murph",
    userID: createHash("sha256").update(input.memberId).digest(),
    userName: "Murph",
    userDisplayName: "Murph",
    challenge: approvalWebAuthnChallenge(input.message),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: input.credentials.map(({ id }) => ({ id })),
  });
}

export async function verifyApprovalPasskeyRegistration(input: {
  message: string;
  origin: string;
  response: RegistrationResponseJSON;
}): Promise<ApprovalPasskey> {
  const result = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: approvalWebAuthnChallenge(input.message),
    expectedOrigin: input.origin,
    expectedRPID: new URL(input.origin).hostname,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new Error("Passkey registration could not be verified.");
  }
  const credential = result.registrationInfo.credential;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
  };
}

export function approvalPasskeyAuthenticationOptions(input: {
  credentials: readonly ApprovalPasskey[];
  message: string;
  origin: string;
}) {
  if (input.credentials.length === 0) {
    throw new Error("Set up a passkey before approving this action.");
  }
  return generateAuthenticationOptions({
    rpID: new URL(input.origin).hostname,
    challenge: approvalWebAuthnChallenge(input.message),
    userVerification: "required",
    allowCredentials: input.credentials.map(({ id }) => ({ id })),
  });
}

export async function verifyApprovalPasskeyAssertion(input: {
  credentials: readonly ApprovalPasskey[];
  message: string;
  origin: string;
  response: AuthenticationResponseJSON;
}): Promise<ApprovalPasskey[]> {
  const credential = input.credentials.find(({ id }) => id === input.response.id);
  if (!credential) {
    throw new Error("This passkey is no longer available for this account.");
  }
  const result = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: approvalWebAuthnChallenge(input.message),
    expectedOrigin: input.origin,
    expectedRPID: new URL(input.origin).hostname,
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey, "base64url"),
      counter: credential.counter,
    },
  });
  if (!result.verified || !result.authenticationInfo.userVerified) {
    throw new Error("Your passkey approval could not be verified.");
  }
  return input.credentials.map((entry) => entry.id === credential.id
    ? { ...entry, counter: result.authenticationInfo.newCounter }
    : entry);
}

export function parseApprovalPasskeys(value: string): ApprovalPasskey[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_APPROVAL_PASSKEYS) {
    throw new TypeError("Approval credentials are invalid.");
  }
  const ids = new Set<string>();
  return parsed.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      throw new TypeError("Approval credential is invalid.");
    }
    const id: unknown = Reflect.get(entry, "id");
    const publicKey: unknown = Reflect.get(entry, "publicKey");
    const counter: unknown = Reflect.get(entry, "counter");
    if (
      !isBase64Url(id, 2048)
      || !isBase64Url(publicKey, 4096)
      || typeof counter !== "number"
      || !Number.isSafeInteger(counter)
      || counter < 0
      || counter > 0xffff_ffff
      || ids.has(id)
    ) {
      throw new TypeError("Approval credential is invalid.");
    }
    ids.add(id);
    return { id, publicKey, counter };
  });
}

function isBase64Url(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9_-]+$/u.test(value)
    && Buffer.from(value, "base64url").toString("base64url") === value;
}
