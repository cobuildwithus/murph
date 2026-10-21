import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes,
} from "node:crypto";
import {
  buildHostedStorageAad, decryptHostedStoragePayload, deriveHostedStorageKey,
  parseHostedCipherEnvelope,
} from "@murphai/runtime-state";
import { hostedArtifactObjectKey } from "@murphai/hosted-execution/storage-paths";

const REQUEST_CONTEXT = Buffer.from("murph.checkpoint-recovery-assessment.v1");
export interface RecoveryAssessmentRequest {
  schema: "murph.checkpoint-recovery-assessment.v1";
  userId: string;
  expectedWorkspaceVersion: string;
  before: string;
  expiresAt: string;
  partialRecovery?: { timezone: string; completedOnboarding: boolean };
}

export function recoveryPublicJwk(privateJwkJson: string): JsonWebKey {
  const key = createPrivateKey({ key: JSON.parse(privateJwkJson), format: "jwk" });
  if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("invalid_recovery_key");
  return createPublicKey(key).export({ format: "jwk" });
}

// The caller needs only this public key. Member selectors never appear in
// workflow inputs, logs, files, or command-line arguments in plaintext.
export function sealRecoveryAssessmentRequest(request: RecoveryAssessmentRequest, publicJwk: JsonWebKey): string {
  const ephemeral = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey({ key: publicJwk, format: "jwk" }) });
  const key = Buffer.from(hkdfSync("sha256", shared, REQUEST_CONTEXT, REQUEST_CONTEXT, 32));
  shared.fill(0);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(REQUEST_CONTEXT);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final(), cipher.getAuthTag()]);
    return Buffer.from(JSON.stringify({
      schema: request.schema, ephemeral: ephemeral.publicKey.export({ format: "jwk" }),
      iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"),
    })).toString("base64url");
  } finally { key.fill(0); }
}

export function openRecoveryAssessmentRequest(sealed: string, privateJwkJson: string, now = Date.now()): RecoveryAssessmentRequest {
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(sealed)) throw new Error("invalid_recovery_request");
  const envelope = JSON.parse(Buffer.from(sealed, "base64url").toString("utf8"));
  if (envelope.schema !== REQUEST_CONTEXT.toString()) throw new Error("invalid_recovery_request");
  const ephemeral = createPublicKey({ key: envelope.ephemeral, format: "jwk" });
  if (ephemeral.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("invalid_recovery_request");
  const shared = diffieHellman({ privateKey: createPrivateKey({ key: JSON.parse(privateJwkJson), format: "jwk" }), publicKey: ephemeral });
  const key = Buffer.from(hkdfSync("sha256", shared, REQUEST_CONTEXT, REQUEST_CONTEXT, 32));
  shared.fill(0);
  const iv = Buffer.from(envelope.iv, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  if (iv.length !== 12 || ciphertext.length < 16) { key.fill(0); throw new Error("invalid_recovery_request"); }
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(REQUEST_CONTEXT);
    decipher.setAuthTag(ciphertext.subarray(-16));
    plaintext = decipher.update(ciphertext.subarray(0, -16));
    decipher.final();
    return validateRequest(JSON.parse(plaintext.toString("utf8")), now);
  } finally { key.fill(0); plaintext?.fill(0); }
}

function validateRequest(request: RecoveryAssessmentRequest, now: number): RecoveryAssessmentRequest {
    if (request.schema !== REQUEST_CONTEXT.toString() || typeof request.userId !== "string"
      || request.userId.length < 1 || request.userId.length > 256
      || typeof request.expectedWorkspaceVersion !== "string" || !/^[0-9]{1,20}$/.test(request.expectedWorkspaceVersion)
      || typeof request.before !== "string" || !Number.isFinite(Date.parse(request.before)) || Date.parse(request.before) > now
      || typeof request.expiresAt !== "string" || !Number.isFinite(Date.parse(request.expiresAt))
      || Date.parse(request.expiresAt) <= now || Date.parse(request.expiresAt) > now + 60 * 60_000) {
      throw new Error("invalid_recovery_request");
    }
    validatePartialRecoveryInstruction(request.partialRecovery);
    return request;
}

function validatePartialRecoveryInstruction(partial: RecoveryAssessmentRequest["partialRecovery"]): void {
    if (partial !== undefined) {
      if (!partial || typeof partial !== "object" || typeof partial.timezone !== "string" || partial.timezone.length > 100
        || typeof partial.completedOnboarding !== "boolean"
        || Object.keys(partial).some(key => key !== "timezone" && key !== "completedOnboarding")) throw new Error("invalid_recovery_request");
      try { new Intl.DateTimeFormat("en", { timeZone: partial.timezone }).format(); }
      catch { throw new Error("invalid_recovery_request"); }
    }
}

// Artifact object names hide the content hash needed for their AAD. Derive a
// candidate hash from GCM's provisional bytes, discard those bytes, then use
// the canonical authenticated decryptor. Nothing parses, returns, persists,
// or reports provisional plaintext. A valid tag AND exact member-scoped object
// name are required before any recovered content can leave this function.
export async function authenticateUnindexedArtifact(input: {
  serialized: Uint8Array; objectKey: string; rootKey: Uint8Array; userId: string;
}): Promise<{ sha256: string; plaintext: Uint8Array }> {
  const envelope = parseHostedCipherEnvelope(JSON.parse(new TextDecoder().decode(input.serialized)));
  if (envelope.scope !== "artifact") throw new Error("invalid_artifact_scope");
  const key = await deriveHostedStorageKey(input.rootKey, "artifact");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  if (iv.length !== 12 || ciphertext.length < 16) { key.fill(0); throw new Error("invalid_artifact_envelope"); }
  let candidate: Buffer | undefined;
  let sha256: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    candidate = decipher.update(ciphertext.subarray(0, -16));
    sha256 = createHash("sha256").update(candidate).digest("hex");
  } finally { key.fill(0); candidate?.fill(0); }
  if (await hostedArtifactObjectKey({ sha256, userId: input.userId }) !== input.objectKey) {
    throw new Error("artifact_ownership_or_hash_mismatch");
  }
  const plaintext = await decryptHostedStoragePayload({
    envelope, key: input.rootKey, expectedKeyId: envelope.keyId, scope: "artifact",
    aad: buildHostedStorageAad({ key: input.objectKey, purpose: "artifact", sha256, userId: input.userId }),
  });
  return { sha256, plaintext };
}
