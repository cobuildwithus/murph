import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { n, e } = publicKey.export({ format: "jwk" });
export const sandboxPublicKey = { alg: "RS384", use: "sig", kty: "RSA", kid: "fixture-key", n, e };
export const signerPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
