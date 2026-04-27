import { Buffer } from "node:buffer";
import { createCipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const TEST_AUTOMATION_RECIPIENT_KEY_ID = "automation:v1";
export const TEST_RECOVERY_RECIPIENT_KEY_ID = "recovery:v1";
export const TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID = "tee-automation:v1";
export const TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION = "v1";
export const TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES = Buffer.alloc(32, 5);
export const TEST_HOSTED_WAKE_ENCRYPTION_KEY =
  TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES.toString("base64url");
export const TEST_HOSTED_WAKE_FETCH_PROOF_KEY_ID = "v1";
export const TEST_HOSTED_WAKE_FETCH_PROOF_KEY_BYTES = Buffer.alloc(32, 6);
export const TEST_HOSTED_WAKE_FETCH_PROOF_KEY =
  TEST_HOSTED_WAKE_FETCH_PROOF_KEY_BYTES.toString("base64url");

export const TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK = {
  crv: "P-256",
  ext: true,
  key_ops: [] as string[],
  kty: "EC",
  x: "xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao",
  y: "8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY",
} as const;
export const TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK =
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK;

export const TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK = {
  ...TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  d: "HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ",
  key_ops: ["deriveBits"] as string[],
} as const;

export const TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK_JSON = JSON.stringify(
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
);
export const TEST_RECOVERY_RECIPIENT_PUBLIC_JWK_JSON = JSON.stringify(
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
);
export const TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK_JSON = JSON.stringify(
  TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
);

export const TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON = JSON.stringify(
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
);
export const TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON = JSON.stringify(
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
);
export const TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON = JSON.stringify(
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
);

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;
const HOSTED_WAKE_SCOPE_SALT = Buffer.from("murph.hosted.device-sync.secret.v1", "utf8");
const HOSTED_WAKE_FETCH_PROOF_CONTEXT = "murph.hosted-mailbox.fetch-proof.v1:";
const TEST_HOSTED_WAKE_FETCH_PROOF_NOW = new Date("2026-03-26T12:00:00.000Z");
const TEST_HOSTED_WAKE_FETCH_PROOF_TTL_SECONDS = 5 * 60;

type TestHostedWakeCursorState = {
  committedSeq: string;
  version: string;
};

interface TestHostedWakeFetchProofClaims {
  exp: number;
  fetchedCommittedSeq: string;
  fetchedCursorVersion: string;
  iat: number;
  kind: "hosted-mailbox-fetch-proof";
  userId: string;
  wakeEventId: string;
  wakeId: string;
  wakeSeq: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTestHostedWakeFetchProofClaims(value: unknown): value is TestHostedWakeFetchProofClaims {
  if (!isRecord(value)) {
    return false;
  }

  return value.kind === "hosted-mailbox-fetch-proof"
    && typeof value.userId === "string"
    && typeof value.wakeEventId === "string"
    && typeof value.wakeId === "string"
    && typeof value.wakeSeq === "string"
    && typeof value.fetchedCommittedSeq === "string"
    && typeof value.fetchedCursorVersion === "string"
    && typeof value.iat === "number"
    && typeof value.exp === "number";
}

export function createHostedExecutionTestEnv(
  overrides: Partial<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID: TEST_AUTOMATION_RECIPIENT_KEY_ID,
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK:
      TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK:
      TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK_JSON,
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID: TEST_RECOVERY_RECIPIENT_KEY_ID,
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      TEST_RECOVERY_RECIPIENT_PUBLIC_JWK_JSON,
    HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID:
      TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
    HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK:
      TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK_JSON,
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WAKE_ENCRYPTION_KEY: TEST_HOSTED_WAKE_ENCRYPTION_KEY,
    HOSTED_WAKE_ENCRYPTION_KEY_VERSION: TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    ...overrides,
  };
}

export function issueTestHostedWakeFetchProof(input: {
  cursor: TestHostedWakeCursorState;
  now?: Date;
  wake: {
    eventId: string;
    id: string;
    seq: string;
    userId: string;
  };
}): string {
  const now = input.now ?? TEST_HOSTED_WAKE_FETCH_PROOF_NOW;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const claims: TestHostedWakeFetchProofClaims = {
    exp: nowSeconds + TEST_HOSTED_WAKE_FETCH_PROOF_TTL_SECONDS,
    fetchedCommittedSeq: input.cursor.committedSeq,
    fetchedCursorVersion: input.cursor.version,
    iat: nowSeconds,
    kind: "hosted-mailbox-fetch-proof",
    userId: input.wake.userId,
    wakeEventId: input.wake.eventId,
    wakeId: input.wake.id,
    wakeSeq: input.wake.seq,
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signTestHostedWakeFetchProof(encodedClaims);

  return `${TEST_HOSTED_WAKE_FETCH_PROOF_KEY_ID}.${encodedClaims}.${signature}`;
}

export function verifyTestHostedWakeFetchProof(input: {
  cursor: TestHostedWakeCursorState;
  proof: string;
  wake: {
    eventId: string;
    id: string;
    seq: string;
    userId: string;
  };
}): boolean {
  const [keyId, encodedClaims, signature, ...rest] = input.proof.split(".");

  if (
    keyId !== TEST_HOSTED_WAKE_FETCH_PROOF_KEY_ID
    || !encodedClaims
    || !signature
    || rest.length > 0
  ) {
    return false;
  }

  const expectedSignature = signTestHostedWakeFetchProof(encodedClaims);

  if (!secureEqual(expectedSignature, signature)) {
    return false;
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (!isTestHostedWakeFetchProofClaims(claims)) {
    return false;
  }

  return claims.userId === input.wake.userId
    && claims.wakeEventId === input.wake.eventId
    && claims.wakeId === input.wake.id
    && claims.wakeSeq === input.wake.seq
    && claims.fetchedCommittedSeq === input.cursor.committedSeq
    && claims.fetchedCursorVersion === input.cursor.version;
}

export function encryptTestHostedMailboxPayload(input: {
  field?: "hosted-mailbox-inline-payload" | "hosted-mailbox-ref-payload";
  userId: string;
  value: unknown;
}): { payloadBytes: number; payloadCiphertext: string } {
  const plaintext = Buffer.from(JSON.stringify(input.value), "utf8");
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv(
    AES_256_GCM,
    deriveHostedSecretScopeKey(
      TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
      `hosted-mailbox-payload:${input.field ?? "hosted-mailbox-ref-payload"}`,
    ),
    iv,
  );
  cipher.setAAD(buildHostedWakeFieldAad({
    field: input.field ?? "hosted-mailbox-ref-payload",
    userId: input.userId,
  }));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    payloadBytes: plaintext.byteLength,
    payloadCiphertext: [
      ENCRYPTED_SECRET_PREFIX,
      TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":"),
  };
}

function buildHostedWakeFieldAad(input: {
  field: string;
  userId: string;
}): Buffer {
  return Buffer.from(JSON.stringify({
    field: input.field,
    memberId: input.userId,
    purpose: "hosted-mailbox-payload",
  }), "utf8");
}

function deriveHostedSecretScopeKey(rootKey: Buffer, scope: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      HOSTED_WAKE_SCOPE_SALT,
      Buffer.from(scope, "utf8"),
      32,
    ),
  );
}

function signTestHostedWakeFetchProof(encodedClaims: string): string {
  return createHmac("sha256", TEST_HOSTED_WAKE_FETCH_PROOF_KEY_BYTES)
    .update(HOSTED_WAKE_FETCH_PROOF_CONTEXT)
    .update(encodedClaims)
    .digest("base64url");
}

function secureEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}
