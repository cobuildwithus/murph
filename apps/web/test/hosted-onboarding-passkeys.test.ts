import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticationGetOptions,
  authenticationVerify,
  registrationGetOptions,
  registrationVerify,
} = vi.hoisted(() => ({
  authenticationGetOptions: vi.fn(),
  authenticationVerify: vi.fn(),
  registrationGetOptions: vi.fn(),
  registrationVerify: vi.fn(),
}));

vi.mock("webauthx/server", () => ({
  Authentication: {
    getOptions: authenticationGetOptions,
    verify: authenticationVerify,
  },
  Registration: {
    getOptions: registrationGetOptions,
    verify: registrationVerify,
  },
}));

import {
  createHostedAuthenticationOptions,
  createHostedRegistrationOptions,
  verifyHostedAuthentication,
} from "@/src/lib/hosted-onboarding/passkeys";

describe("hosted onboarding passkey adapter", () => {
  beforeEach(() => {
    authenticationGetOptions.mockReset();
    authenticationVerify.mockReset();
    registrationGetOptions.mockReset();
    registrationVerify.mockReset();
  });

  it("forwards strict registration defaults and exclude ids to webauthx", () => {
    const options = { publicKey: { challenge: "0xdeadbeef" } };
    registrationGetOptions.mockReturnValue({ options });

    expect(
      createHostedRegistrationOptions({
        challenge: "0xdeadbeef",
        memberLabel: "+61400111222",
        passkeys: [
          {
            credentialId: "cred-existing",
            publicKey: Uint8Array.from([1, 2, 3]),
          },
        ],
        rpId: "join.example.test",
        rpName: "Healthy Bob",
        userId: "member-webauthn-id",
      }),
    ).toBe(options);

    expect(registrationGetOptions).toHaveBeenCalledWith({
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      challenge: "0xdeadbeef",
      excludeCredentialIds: ["cred-existing"],
      rp: {
        id: "join.example.test",
        name: "Healthy Bob",
      },
      timeout: 60_000,
      user: {
        displayName: "+61400111222",
        id: new TextEncoder().encode("member-webauthn-id"),
        name: "+61400111222",
      },
    });
  });

  it("encodes stored passkey bytes as hex before authentication verify", () => {
    authenticationVerify.mockReturnValue(true);

    expect(
      verifyHostedAuthentication({
        expectedChallenge: "0xabc123",
        expectedOrigin: "https://join.example.test",
        expectedRpId: "join.example.test",
        passkey: {
          credentialId: "cred-existing",
          publicKey: Uint8Array.from([1, 2, 3, 4]),
        },
        response: {
          id: "cred-existing",
        },
      }),
    ).toBe(true);

    expect(authenticationVerify).toHaveBeenCalledWith(
      {
        id: "cred-existing",
      },
      {
        challenge: "0xabc123",
        origin: "https://join.example.test",
        publicKey: "0x01020304",
        rpId: "join.example.test",
      },
    );
  });
});
