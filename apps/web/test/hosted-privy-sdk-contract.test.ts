import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  requireHostedPrivyIdentity,
  verifyHostedPrivyIdentityToken,
} from "@/src/lib/hosted-onboarding/privy";

import { createHostedPrivyTokenFixture } from "./support/hosted-privy-token-fixture";

describe("hosted Privy installed SDK contract", () => {
  let issuer: ReturnType<typeof createHostedPrivyTokenFixture>;

  beforeEach(() => {
    issuer = createHostedPrivyTokenFixture();
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", issuer.appId);
    vi.stubEnv("PRIVY_VERIFICATION_KEY", issuer.publicKeyPem);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("verifies an ES256 signature and maps compressed email and phone claims into Murph identity", async () => {
    const verifiedAt = Math.floor(Date.now() / 1000) - 30;
    const token = issuer.sign({
      linked_accounts: JSON.stringify([
        { type: "email", address: "auth-contract@example.test", lv: verifiedAt },
        { type: "phone", phone_number: "+15550100123", lv: verifiedAt },
      ]),
    });

    await expect(requireHostedPrivyIdentity(token)).resolves.toMatchObject({
      userId: "did:privy:synthetic-contract-member",
      email: { address: "auth-contract@example.test", verifiedAt },
      phone: { number: "+15550100123", verifiedAt },
      telegram: null,
    });
  });

  it("accepts the configured escaped PEM form through the actual verifier", async () => {
    vi.stubEnv("PRIVY_VERIFICATION_KEY", issuer.publicKeyPem.replace(/\n/gu, "\\n"));
    await expect(verifyHostedPrivyIdentityToken(issuer.sign())).resolves.toMatchObject({
      id: "did:privy:synthetic-contract-member",
    });
  });

  it("rejects a changed identity payload with the original valid signature", async () => {
    const [header, encoded, signature] = issuer.sign().split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.sub = "did:privy:different-synthetic-member";
    const tampered = `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    await expect(verifyHostedPrivyIdentityToken(tampered)).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED", httpStatus: 401,
    });
  });

  it.each([
    ["wrong app", { aud: "another-test-app" }],
    ["expired token", { exp: 1 }],
    ["wrong issuer", { iss: "https://untrusted.example.test" }],
    ["non-array linked accounts", { linked_accounts: "{}" }],
    ["missing linked accounts", { linked_accounts: undefined }],
    ["missing subject", { sub: undefined }],
  ])("rejects %s through SDK verification and parsing", async (_, claims) => {
    await expect(verifyHostedPrivyIdentityToken(issuer.sign(claims))).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED", httpStatus: 401,
    });
  });

  it("rejects a correctly signed account without a verified supported login method", async () => {
    await expect(requireHostedPrivyIdentity(issuer.sign({ linked_accounts: "[]" })))
      .rejects.toMatchObject({ code: "PRIVY_ACCOUNT_REQUIRED" });
  });

  it("rejects a token signed by a different key for the same app", async () => {
    const otherIssuer = createHostedPrivyTokenFixture();
    await expect(verifyHostedPrivyIdentityToken(otherIssuer.sign())).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED", httpStatus: 401,
    });
  });
});
