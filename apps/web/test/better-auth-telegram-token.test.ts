import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, createRemoteJWKSet, customFetch, exportJWK, generateKeyPair, SignJWT, type FetchImplementation, type JWK, type JWTPayload } from "jose";
import { verifyHostedTelegramIdToken } from "../src/lib/better-auth/telegram-token";

const nonce = Buffer.alloc(32, 11).toString("base64url");
let key: CryptoKey;
let publicKey: JWK;
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  key = pair.privateKey;
  publicKey = { ...await exportJWK(pair.publicKey), kid: "synthetic-key" };
  keys = createLocalJWKSet({ keys: [publicKey] });
});

function remoteKeys(fetch: FetchImplementation) {
  return createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"), { [customFetch]: fetch, timeoutDuration: 50 });
}

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

  it("normalizes a signed decimal-string profile ID without substituting the OIDC subject", async () => {
    const result = await verifyHostedTelegramIdToken({ token: await token({ id: "1234567890" }), nonce, clientId: "123456789" }, keys);
    expect(result.telegramUserId).toBe("1234567890");
  });

  it.each([
    { iss: "https://example.test" }, { aud: "other-client" }, { nonce: "other-nonce" },
    { exp: 1 }, { iat: 1 }, { id: undefined }, { id: "0123456789" }, { id: "1e9" }, { id: " 1234567890" }, { id: "123.0" }, { id: "0" }, { id: "9007199254740992" }, { id: null }, { id: 9007199254740992 },
  ])("rejects invalid provider authority %j", async (changes) => {
    await expect(verifyHostedTelegramIdToken({ token: await token(changes), nonce, clientId: "123456789" }, keys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID" });
  });

  it("reports only a bounded verification reason without provider claims", async () => {
    await expect(verifyHostedTelegramIdToken({ token: await token({ aud: "private-provider-value" }), nonce, clientId: "123456789" }, keys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID", details: { code: "telegram_claim_aud" } });
    await expect(verifyHostedTelegramIdToken({ token: await token({ nonce: "untrusted-nonce" }), nonce, clientId: "123456789" }, keys))
      .rejects.toMatchObject({ details: { code: "telegram_nonce_mismatch" } });
  });

  it("rejects a token signed by another key", async () => {
    const pair = await generateKeyPair("ES256");
    const wrongKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "synthetic-key" }] });
    await expect(verifyHostedTelegramIdToken({ token: await token(), nonce, clientId: "123456789" }, wrongKeys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID" });
  });

  it("verifies through Telegram's key service and still rejects a bad token as the caller's", async () => {
    await expect(verifyHostedTelegramIdToken({ token: await token(), nonce, clientId: "123456789" }, remoteKeys(async () => Response.json({ keys: [publicKey] }))))
      .resolves.toMatchObject({ telegramUserId: "1234567890" });
    const other = await generateKeyPair("ES256");
    const wrongKeys = remoteKeys(async () => Response.json({ keys: [{ ...await exportJWK(other.publicKey), kid: "synthetic-key" }] }));
    await expect(verifyHostedTelegramIdToken({ token: await token(), nonce, clientId: "123456789" }, wrongKeys))
      .rejects.toMatchObject({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 401, retryable: false, details: { code: "telegram_ERR_JWS_SIGNATURE_VERIFICATION_FAILED" } });
  });

  it.each<[string, FetchImplementation]>([
    ["a failed request", async () => { throw new TypeError("fetch failed"); }],
    ["an error response", async () => new Response("unavailable", { status: 503 })],
    ["an unreadable response", async () => new Response("not json", { status: 200 })],
    ["a malformed key set", async () => Response.json({ keys: "none" })],
    ["a timeout", (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)))],
  ])("answers %s from Telegram's key service as a retryable outage, not a bad token", async (_case, fetch) => {
    await expect(verifyHostedTelegramIdToken({ token: await token(), nonce, clientId: "123456789" }, remoteKeys(fetch)))
      .rejects.toMatchObject({ code: "AUTH_VERIFICATION_UNAVAILABLE", httpStatus: 503, retryable: true, details: { code: "telegram_verification_unavailable" } });
  });
});
