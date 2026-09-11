import { generateKeyPairSync, sign } from "node:crypto";

// Privy's documented identity-token wire shape, signed with a fresh test-only key.
// The consumer must still run the installed SDK's verification and claim parser.
// https://docs.privy.io/user-management/users/identity-tokens
export function createHostedPrivyTokenFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const appId = "privy-contract-test-app";
  return {
    appId,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign(claims: Record<string, unknown> = {}): string {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({
        aud: appId,
        cr: String(now - 60),
        exp: now + 300,
        iat: now,
        iss: "privy.io",
        sub: "did:privy:synthetic-contract-member",
        linked_accounts: JSON.stringify([{
          type: "email",
          address: "auth-contract@example.test",
          lv: now - 30,
        }]),
        ...claims,
      })).toString("base64url");
      const input = `${header}.${payload}`;
      const signature = sign("sha256", Buffer.from(input), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      return `${input}.${signature}`;
    },
  };
}
