import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  approvalPasskeyAuthenticationOptions,
  approvalPasskeyRegistrationOptions,
  parseApprovalPasskeys,
  verifyApprovalPasskeyAssertion,
  verifyApprovalPasskeyRegistration,
} from "@/src/lib/sensitive-actions/webauthn";

import { authenticator } from "./approval-webauthn-fixture";

const origin = "https://www.withmurph.ai";
const message = "Synthetic member/session/action-bound approval challenge";


describe("WebAuthn action approval cryptographic boundary", () => {
  it("requires UV and restricts authentication to enrolled credentials", async () => {
    const { credential } = authenticator();
    const options = await approvalPasskeyAuthenticationOptions({ credentials: [credential], message, origin });
    expect(options).toMatchObject({
      rpId: "www.withmurph.ai", userVerification: "required", allowCredentials: [{ id: credential.id }],
    });
    const registration = await approvalPasskeyRegistrationOptions({ credentials: [credential], memberId: "synthetic-member", message, origin });
    expect(registration.authenticatorSelection?.userVerification).toBe("required");
    expect(registration.excludeCredentials).toMatchObject([{ id: credential.id }]);
    expect(registration.user.name).toBe("Murph");
  });

  it("verifies a real registration and signed assertion, retaining the counter", async () => {
    const fixture = authenticator();
    const credential = await verifyApprovalPasskeyRegistration({ response: fixture.registration(), message, origin });
    expect(credential).toEqual(fixture.credential);
    await expect(verifyApprovalPasskeyAssertion({ credentials: [credential], response: fixture.assertion(), message, origin }))
      .resolves.toEqual([{ ...credential, counter: 1 }]);
  });

  it("rejects registration and a valid signature without user verification", async () => {
    const fixture = authenticator();
    await expect(verifyApprovalPasskeyRegistration({ response: fixture.registration(false), message, origin })).rejects.toThrow();
    await expect(verifyApprovalPasskeyAssertion({ credentials: [fixture.credential], response: fixture.assertion({ uv: false }), message, origin })).rejects.toThrow();
  });

  it.each([
    { customMessage: "Another member/session/action" },
    { customOrigin: "https://untrusted.example" },
  ])("rejects a signed assertion for another binding or origin: %j", async (options) => {
    const fixture = authenticator();
    await expect(verifyApprovalPasskeyAssertion({ credentials: [fixture.credential], response: fixture.assertion(options), message, origin })).rejects.toThrow();
  });

  it("rejects removed credentials and replayed increasing counters", async () => {
    const fixture = authenticator();
    const response = fixture.assertion();
    await expect(verifyApprovalPasskeyAssertion({ credentials: [], response, message, origin })).rejects.toThrow();
    await expect(verifyApprovalPasskeyAssertion({ credentials: [{ ...fixture.credential, counter: 1 }], response, message, origin })).rejects.toThrow();
  });

  it("accepts counterless synced passkeys without treating counters as the replay owner", async () => {
    const fixture = authenticator();
    await expect(verifyApprovalPasskeyAssertion({ credentials: [fixture.credential], response: fixture.assertion({ counter: 0 }), message, origin }))
      .resolves.toEqual([fixture.credential]);
    // The composed service must consume the bound challenge once even when
    // the authenticator intentionally reports a zero signature counter.
  });

  it("bounds persisted credentials and rejects duplicate or malformed state", () => {
    const { credential } = authenticator();
    expect(parseApprovalPasskeys(JSON.stringify([credential]))).toEqual([credential]);
    for (const invalid of [[], [credential, credential], [{ ...credential, counter: -1 }], [{ ...credential, publicKey: "not base64!" }]]) {
      expect(() => parseApprovalPasskeys(JSON.stringify(invalid))).toThrow();
    }
  });
});
