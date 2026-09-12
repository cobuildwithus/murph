import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { verifyHostedTelegramIdToken } from "../src/lib/better-auth/telegram-token";

const nonce = Buffer.alloc(32, 11).toString("base64url");
let key: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  key = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "synthetic-key" }] });
});

async function token(changes: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    iss: "https://oauth.telegram.org", aud: "123456789", sub: "999999999999999999",
    id: 1234567890, nonce, iat: now, exp: now + 300, ...changes,
  }).setProtectedHeader({ alg: "ES256", kid: "synthetic-key" }).sign(key);
}

describe("verified Telegram login identity", () => {
  it("uses the signed numeric profile ID and discards unrelated provider claims", async () => {
    const result = await verifyHostedTelegramIdToken({ token: await token({ email: "untrusted@example.test", phone_number: "12025550100" }), nonce, clientId: "123456789" }, keys);
    expect(result.telegramUserId).toBe("1234567890");
    expect(Object.keys(result).sort()).toEqual(["authenticatedAt", "expiresAt", "telegramUserId"]);
  });

  it.each([
    { iss: "https://example.test" }, { aud: "other-client" }, { nonce: "other-nonce" },
    { exp: 1 }, { iat: 1 }, { id: undefined }, { id: "1234567890" }, { id: 9007199254740992 },
  ])("rejects invalid provider authority %j", async (changes) => {
    await expect(verifyHostedTelegramIdToken({ token: await token(changes), nonce, clientId: "123456789" }, keys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID" });
  });

  it("rejects a token signed by another key", async () => {
    const pair = await generateKeyPair("ES256");
    const wrongKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "synthetic-key" }] });
    await expect(verifyHostedTelegramIdToken({ token: await token(), nonce, clientId: "123456789" }, wrongKeys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID" });
  });
});
