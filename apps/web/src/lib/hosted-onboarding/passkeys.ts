import { Authentication, Registration } from "webauthx/server";

export interface HostedPasskeyDescriptor {
  counter?: number;
  credentialId: string;
  publicKey: Uint8Array | Buffer;
  transports?: string[];
}

export function createHostedRegistrationOptions(input: {
  challenge: string;
  memberLabel: string;
  passkeys: HostedPasskeyDescriptor[];
  rpId: string;
  rpName: string;
  userId: string;
}) {
  const { options } = Registration.getOptions({
    attestation: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    challenge: normalizeChallenge(input.challenge),
    excludeCredentialIds: input.passkeys.map((passkey) => passkey.credentialId),
    rp: {
      id: input.rpId,
      name: input.rpName,
    },
    timeout: 60_000,
    user: {
      displayName: input.memberLabel,
      id: new TextEncoder().encode(input.userId),
      name: input.memberLabel,
    },
  });

  return options;
}

export function createHostedAuthenticationOptions(input: {
  challenge: string;
  passkeys: HostedPasskeyDescriptor[];
  rpId: string;
}) {
  const { options } = Authentication.getOptions({
    challenge: normalizeChallenge(input.challenge),
    credentialId: input.passkeys.map((passkey) => passkey.credentialId),
    rpId: input.rpId,
    userVerification: "required",
  });

  return options;
}

export function verifyHostedRegistration(input: {
  credential: unknown;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
}) {
  return Registration.verify(input.credential as Registration.Credential, {
    challenge: normalizeChallenge(input.expectedChallenge),
    origin: input.expectedOrigin,
    rpId: input.expectedRpId,
    userVerification: "required",
  });
}

export function verifyHostedAuthentication(input: {
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  passkey: HostedPasskeyDescriptor;
  response: unknown;
}) {
  return Authentication.verify(input.response as Authentication.Response, {
    challenge: normalizeChallenge(input.expectedChallenge),
    origin: input.expectedOrigin,
    publicKey: encodeHostedPasskeyPublicKey(input.passkey.publicKey),
    rpId: input.expectedRpId,
  });
}

export function decodeHostedPasskeyPublicKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const normalized = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
  return new Uint8Array(Array.from(Buffer.from(normalized, "hex"))) as Uint8Array<ArrayBuffer>;
}

function encodeHostedPasskeyPublicKey(publicKey: Uint8Array | Buffer): `0x${string}` {
  const bytes = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  return `0x${bytes.toString("hex")}`;
}

function normalizeChallenge(challenge: string): `0x${string}` {
  return challenge.startsWith("0x")
    ? challenge as `0x${string}`
    : `0x${challenge}`;
}
