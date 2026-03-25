import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";

export interface HostedPasskeyDescriptor {
  counter: number;
  credentialId: string;
  publicKey: Uint8Array | Buffer;
  transports: string[];
}

export function createHostedRegistrationOptions(input: {
  challenge: string;
  memberLabel: string;
  passkeys: HostedPasskeyDescriptor[];
  rpId: string;
  rpName: string;
  userId: string;
}) {
  return generateRegistrationOptions({
    attestationType: "none",
    challenge: input.challenge,
    excludeCredentials: input.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as never,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
    rpID: input.rpId,
    rpName: input.rpName,
    timeout: 60_000,
    userDisplayName: input.memberLabel,
    userID: isoUint8Array.fromUTF8String(input.userId),
    userName: input.memberLabel,
  });
}

export function createHostedAuthenticationOptions(input: {
  challenge: string;
  passkeys: HostedPasskeyDescriptor[];
  rpId: string;
}) {
  return generateAuthenticationOptions({
    allowCredentials: input.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as never,
    })),
    challenge: input.challenge,
    rpID: input.rpId,
    timeout: 60_000,
    userVerification: "preferred",
  });
}

export async function verifyHostedRegistration(input: {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  response: unknown;
}) {
  return verifyRegistrationResponse({
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRpId,
    requireUserVerification: true,
    response: input.response as never,
  });
}

export async function verifyHostedAuthentication(input: {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  passkey: HostedPasskeyDescriptor;
  response: unknown;
}) {
  return verifyAuthenticationResponse({
    credential: {
      id: input.passkey.credentialId,
      publicKey: new Uint8Array(input.passkey.publicKey),
      counter: input.passkey.counter,
      transports: input.passkey.transports as never,
    },
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRpId,
    requireUserVerification: true,
    response: input.response as never,
  });
}
