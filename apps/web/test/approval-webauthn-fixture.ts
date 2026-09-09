import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { approvalWebAuthnChallenge, type ApprovalPasskey } from "@/src/lib/sensitive-actions/webauthn";

export function authenticator(message = "Synthetic member/session/action-bound approval challenge", origin = "https://www.withmurph.ai") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Test key is missing coordinates.");
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")],
    [-3, Buffer.from(jwk.y, "base64url")],
  ]));
  const id = randomBytes(32).toString("base64url");
  const credential: ApprovalPasskey = { id, publicKey: Buffer.from(cose).toString("base64url"), counter: 0 };

  function clientData(type: string, customMessage = message, customOrigin = origin) {
    return Buffer.from(JSON.stringify({
      type, challenge: approvalWebAuthnChallenge(customMessage), origin: customOrigin, crossOrigin: false,
    }));
  }
  function authData(flags: number, counter: number) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      createHash("sha256").update(new URL(origin).hostname).digest(), Buffer.from([flags]), count,
    ]);
  }
  function assertion(options: { uv?: boolean; counter?: number; customMessage?: string; customOrigin?: string } = {}): AuthenticationResponseJSON {
    const data = clientData("webauthn.get", options.customMessage, options.customOrigin);
    const auth = authData(options.uv === false ? 1 : 5, options.counter ?? 1);
    const signature = sign("sha256", Buffer.concat([
      auth, createHash("sha256").update(data).digest(),
    ]), privateKey);
    return {
      id, rawId: id, type: "public-key", clientExtensionResults: {},
      response: {
        authenticatorData: auth.toString("base64url"),
        clientDataJSON: data.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
  function registration(uv = true): RegistrationResponseJSON {
    const idBytes = Buffer.from(id, "base64url");
    const length = Buffer.alloc(2);
    length.writeUInt16BE(idBytes.length);
    const auth = Buffer.concat([
      authData(uv ? 0x45 : 0x41, 0), Buffer.alloc(16), length, idBytes, cose,
    ]);
    const attestation = isoCBOR.encode(new Map<string, string | Map<string, never> | Uint8Array>([
      ["fmt", "none"], ["attStmt", new Map<string, never>()], ["authData", auth],
    ]));
    return {
      id, rawId: id, type: "public-key", clientExtensionResults: {},
      response: {
        attestationObject: Buffer.from(attestation).toString("base64url"),
        clientDataJSON: clientData("webauthn.create").toString("base64url"),
      },
    };
  }
  return { assertion, credential, registration };
}

