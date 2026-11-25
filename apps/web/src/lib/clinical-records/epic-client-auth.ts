import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";

export type EpicClientAuth =
  | { method: "public"; clientId: string }
  | { method: "basic"; clientId: string; clientSecret: string }
  | { method: "private_key_jwt"; clientId: string; key: KeyObject; kid: string };

export function epicAssertionSigner(clientId: string, pem: string, keys: readonly {
  kty: string; alg: string; use: string; kid: string; n: string; e: string;
}[]): Extract<EpicClientAuth, { method: "private_key_jwt" }> {
  const key = createPrivateKey(pem);
  const jwk = createPublicKey(key).export({ format: "jwk" });
  const matches = keys.filter(k => k.kty === "RSA" && k.use === "sig" && k.alg === "RS384"
    && k.n === jwk.n && k.e === jwk.e);
  if (key.asymmetricKeyType !== "rsa" || matches.length !== 1) {
    throw new Error("Epic signer does not match the registered public key set.");
  }
  return { method: "private_key_jwt", clientId, key, kid: matches[0]!.kid };
}

export async function epicTokenRequest(auth: EpicClientAuth, tokenEndpoint: string, fields: Record<string, string>): Promise<RequestInit> {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
  switch (auth.method) {
    case "public":
      body.set("client_id", auth.clientId);
      break;
    case "basic": {
      const encoded = (value: string) => new URLSearchParams({ value }).toString().slice(6);
      headers.Authorization = `Basic ${Buffer.from(`${encoded(auth.clientId)}:${encoded(auth.clientSecret)}`).toString("base64")}`;
      break;
    }
    case "private_key_jwt": {
      const now = Math.floor(Date.now() / 1000);
      const assertion = await new SignJWT({})
        .setProtectedHeader({ alg: "RS384", typ: "JWT", kid: auth.kid })
        .setIssuer(auth.clientId).setSubject(auth.clientId).setAudience(tokenEndpoint)
        .setJti(randomUUID()).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120)
        .sign(auth.key);
      body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
      body.set("client_assertion", assertion);
      break;
    }
  }
  return { method: "POST", redirect: "manual", headers, body };
}
