import { Buffer } from "node:buffer";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";

export const TEST_AUTOMATION_RECIPIENT_KEY_ID = "automation:v1";
export const TEST_RECOVERY_RECIPIENT_KEY_ID = "recovery:v1";
export const TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID = "tee-automation:v1";
export const TEST_MAILBOX_PAYLOAD_KEY_VERSION = "v1";
export const TEST_MAILBOX_PAYLOAD_KEY_BYTES = Buffer.alloc(32, 5);

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
export const TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION =
  "projects/murph-test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
export const TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExSelVJv6r6LPUS8GCNgj1T/7z5GX",
  "OrhgY1cCdzGb5arweFyJLVwA8qz989+BmdvVRJ1G0Ff7g2+nxeIEe4xyZg==",
  "-----END PUBLIC KEY-----",
].join("\\n");
export const TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID =
  "cloudflare-automation:v1";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;
const HOSTED_WAKE_SCOPE_SALT = Buffer.from("murph.hosted.device-sync.secret.v1", "utf8");

export function createHostedExecutionTestEnv(
  overrides: Partial<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
      TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
      TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    ...overrides,
  };
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
      TEST_MAILBOX_PAYLOAD_KEY_BYTES,
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
      TEST_MAILBOX_PAYLOAD_KEY_VERSION,
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
