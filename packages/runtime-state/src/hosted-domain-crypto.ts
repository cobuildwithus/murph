const HOSTED_DOMAIN_ROOT_KEY_BYTES = 32;
const HOSTED_SECURE_BOX_IV_BYTES = 12;
const HOSTED_ECDH_WRAP_IV_BYTES = 12;
const HOSTED_SECURE_BOX_HKDF_SALT = toArrayBuffer(
  utf8("murph.hosted-domain-secure-box.v1"),
);
const HOSTED_ECDH_WRAP_HKDF_SALT = toArrayBuffer(
  utf8("murph.hosted-domain-root-ecdh-wrap.v1"),
);

export const HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA =
  "murph.hosted-domain-root-key-envelope.v1";
export const HOSTED_SECURE_BOX_ENVELOPE_SCHEMA = "murph.hosted-secure-box.v1";

export const HOSTED_CRYPTO_DOMAINS = [
  "control",
  "device",
  "ingress",
  "runtime",
] as const;

export type HostedCryptoDomain = (typeof HOSTED_CRYPTO_DOMAINS)[number];

export const HOSTED_CRYPTO_LANES = [
  "hosted-member-private-field",
  "hosted-inference-connection",
  "clinical-records-oauth",
  "clinical-records-page-cursor",
  "clinical-records-patient-id",
  "clinical-records-token",
  "device-sync-token",
  "device-sync-provider-application",
  "device-sync-external-account-id",
  "device-sync-payload",
  "mailbox-payload",
  "email-raw",
  "meal-photo",
  "bundle",
  "workspace-snapshot",
  "artifact",
  "runner-secrets",
  "browser-vault-replica",
] as const;

export type HostedCryptoLane = (typeof HOSTED_CRYPTO_LANES)[number];

export const HOSTED_CRYPTO_LANE_DOMAINS: Record<
  HostedCryptoLane,
  HostedCryptoDomain
> = {
  artifact: "runtime",
  "browser-vault-replica": "runtime",
  bundle: "runtime",
  "clinical-records-oauth": "control",
  "clinical-records-page-cursor": "device",
  "clinical-records-patient-id": "device",
  "clinical-records-token": "device",
  "device-sync-external-account-id": "device",
  "device-sync-payload": "device",
  "device-sync-provider-application": "device",
  "device-sync-token": "device",
  "email-raw": "ingress",
  "hosted-member-private-field": "control",
  "hosted-inference-connection": "control",
  "mailbox-payload": "ingress",
  "meal-photo": "ingress",
  "runner-secrets": "runtime",
  "workspace-snapshot": "runtime",
};

export const HOSTED_CRYPTO_KMS_RECIPIENT_KINDS = [
  "web-control-kms",
  "web-device-kms",
  "web-ingress-kms",
] as const;

export type HostedCryptoKmsRecipientKind =
  (typeof HOSTED_CRYPTO_KMS_RECIPIENT_KINDS)[number];

export const HOSTED_CRYPTO_ECDH_RECIPIENT_KINDS = [
  "cloudflare-automation-secret",
  "tee-runtime-attested",
  "recovery-offline",
] as const;

export type HostedCryptoEcdhRecipientKind =
  (typeof HOSTED_CRYPTO_ECDH_RECIPIENT_KINDS)[number];

export type HostedCryptoRecipientKind =
  | HostedCryptoKmsRecipientKind
  | HostedCryptoEcdhRecipientKind;

export const HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS: Record<
  HostedCryptoDomain,
  readonly HostedCryptoRecipientKind[]
> = {
  control: ["web-control-kms", "recovery-offline"],
  device: ["web-device-kms", "recovery-offline"],
  ingress: [
    "web-ingress-kms",
    "cloudflare-automation-secret",
    "tee-runtime-attested",
    "recovery-offline",
  ],
  runtime: ["cloudflare-automation-secret", "tee-runtime-attested", "recovery-offline"],
} as const;

export function isHostedCryptoRecipientAllowedForDomain(input: {
  domain: HostedCryptoDomain;
  recipient: HostedCryptoRecipientKind;
}): boolean {
  return HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS[input.domain].includes(input.recipient);
}

export interface HostedGcpKmsWrappedDomainRootKey {
  additionalAuthenticatedData: string;
  ciphertextBlob: string;
  encryptionContext: Record<string, string>;
  kind: "gcp-kms";
  kmsKeyName: string;
  recipient: HostedCryptoKmsRecipientKind;
}

export interface HostedEcdhWrappedDomainRootKey {
  ciphertext: string;
  encryptionContext: Record<string, string>;
  ephemeralPublicJwk: JsonWebKey;
  iv: string;
  kind: "p256-ecdh-aesgcm";
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  teePolicyId?: string;
}

export type HostedDomainRootKeyWrap =
  | HostedGcpKmsWrappedDomainRootKey
  | HostedEcdhWrappedDomainRootKey;

export interface HostedDomainRootKeyEnvelopeBodyV1 {
  createdAt: string;
  domain: HostedCryptoDomain;
  generation: number;
  rootKeyId: string;
  schema: typeof HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA;
  updatedAt: string;
  userId: string;
  wraps: HostedDomainRootKeyWrap[];
}

export interface HostedDomainRootKeyAuthoritySignatureV1 {
  alg: "GCP-KMS-EC-P256-SHA256";
  keyVersionName: string;
  signedAt: string;
  signature: string;
}

export interface HostedDomainRootKeyEnvelopeV1
  extends HostedDomainRootKeyEnvelopeBodyV1 {
  authoritySignature: HostedDomainRootKeyAuthoritySignatureV1;
}

export interface HostedSecureBoxEnvelopeV1 {
  alg: "AES-256-GCM-HKDF-SHA256";
  ciphertext: string;
  domain: HostedCryptoDomain;
  iv: string;
  lane: HostedCryptoLane;
  rootKeyId: string;
  schema: typeof HOSTED_SECURE_BOX_ENVELOPE_SCHEMA;
  scope: string;
}

export interface HostedSecureBoxAadFields {
  domain: HostedCryptoDomain;
  field?: string | null;
  lane: HostedCryptoLane;
  objectKey?: string | null;
  purpose: string;
  rowId?: string | null;
  scope: string;
  sequence?: bigint | number | string | null;
  table?: string | null;
  tenant?: "murph-hosted";
  userId: string;
}

export interface HostedDomainRootWrapContextInput {
  domain: HostedCryptoDomain;
  env: string;
  recipient: HostedCryptoRecipientKind;
  rootKeyId: string;
  userId: string;
}

export function getHostedCryptoDomainForLane(
  lane: HostedCryptoLane,
): HostedCryptoDomain {
  return HOSTED_CRYPTO_LANE_DOMAINS[lane];
}

export function isHostedCryptoDomain(value: string): value is HostedCryptoDomain {
  return (HOSTED_CRYPTO_DOMAINS as readonly string[]).includes(value);
}

export function isHostedCryptoLane(value: string): value is HostedCryptoLane {
  return (HOSTED_CRYPTO_LANES as readonly string[]).includes(value);
}

export function createHostedDomainRootKeyId(domain: HostedCryptoDomain): string {
  return `udrk:${domain}:${crypto.randomUUID()}`;
}

export function generateHostedDomainRootKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(HOSTED_DOMAIN_ROOT_KEY_BYTES));
}

export function buildHostedDomainRootWrapContext(
  input: HostedDomainRootWrapContextInput,
): Record<string, string> {
  const domain = requireHostedCryptoDomain(
    input.domain,
    "Hosted domain root wrap context domain",
  );
  const recipient = requireHostedCryptoRecipientKind(
    input.recipient,
    "Hosted domain root wrap context recipient",
  );
  assertHostedCryptoRecipientAllowedForDomain({
    domain,
    label: "Hosted domain root wrap context recipient",
    recipient,
  });
  return {
    app: "murph",
    domain,
    env: requireNonEmptyString(input.env, "Hosted domain root wrap context env"),
    purpose: "hosted-domain-root-wrap",
    recipient,
    rootKeyId: requireNonEmptyString(
      input.rootKeyId,
      "Hosted domain root wrap context rootKeyId",
    ),
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    userId: requireNonEmptyString(
      input.userId,
      "Hosted domain root wrap context userId",
    ),
  };
}

export function serializeAdditionalAuthenticatedData(
  encryptionContext: Record<string, string>,
): string {
  return canonicalJson(encryptionContext);
}

export function buildHostedDomainRootEnvelopeSigningPayload(
  envelope: HostedDomainRootKeyEnvelopeBodyV1,
): Uint8Array {
  return utf8(canonicalJson(envelope));
}

export function attachHostedDomainRootEnvelopeSignature(input: {
  body: HostedDomainRootKeyEnvelopeBodyV1;
  keyVersionName: string;
  signature: string;
  signedAt?: string;
}): HostedDomainRootKeyEnvelopeV1 {
  return {
    ...input.body,
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: requireNonEmptyString(
        input.keyVersionName,
        "Hosted domain root authority signature keyVersionName",
      ),
      signedAt: input.signedAt ?? new Date().toISOString(),
      signature: requireNonEmptyString(
        input.signature,
        "Hosted domain root authority signature signature",
      ),
    },
  };
}

export function parseHostedDomainRootKeyEnvelope(
  value: unknown,
  label = "Hosted domain root key envelope",
): HostedDomainRootKeyEnvelopeV1 {
  const record = requireRecord(value, label);
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: requireNonEmptyString(record.createdAt, `${label}.createdAt`),
    domain: requireHostedCryptoDomain(record.domain, `${label}.domain`),
    generation: requirePositiveInteger(record.generation, `${label}.generation`),
    rootKeyId: requireNonEmptyString(record.rootKeyId, `${label}.rootKeyId`),
    schema: requireDomainRootEnvelopeSchema(record.schema, `${label}.schema`),
    updatedAt: requireNonEmptyString(record.updatedAt, `${label}.updatedAt`),
    userId: requireNonEmptyString(record.userId, `${label}.userId`),
    wraps: requireArray(record.wraps, `${label}.wraps`).map((entry, index) =>
      parseHostedDomainRootKeyWrap(entry, `${label}.wraps[${index}]`),
    ),
  };
  assertUniqueHostedRecipients(body.wraps, `${label}.wraps`);
  assertHostedDomainRootEnvelopeWrapPolicy(body, `${label}.wraps`);
  const signatureRecord = requireRecord(
    record.authoritySignature,
    `${label}.authoritySignature`,
  );
  const alg = requireNonEmptyString(
    signatureRecord.alg,
    `${label}.authoritySignature.alg`,
  );
  if (alg !== "GCP-KMS-EC-P256-SHA256") {
    throw new TypeError(
      `${label}.authoritySignature.alg must be GCP-KMS-EC-P256-SHA256.`,
    );
  }
  return {
    ...body,
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: requireNonEmptyString(
        signatureRecord.keyVersionName,
        `${label}.authoritySignature.keyVersionName`,
      ),
      signedAt: requireNonEmptyString(
        signatureRecord.signedAt,
        `${label}.authoritySignature.signedAt`,
      ),
      signature: requireNonEmptyString(
        signatureRecord.signature,
        `${label}.authoritySignature.signature`,
      ),
    },
  };
}

export function getHostedDomainRootEnvelopeBody(
  envelope: HostedDomainRootKeyEnvelopeV1,
): HostedDomainRootKeyEnvelopeBodyV1 {
  return {
    createdAt: envelope.createdAt,
    domain: envelope.domain,
    generation: envelope.generation,
    rootKeyId: envelope.rootKeyId,
    schema: envelope.schema,
    updatedAt: envelope.updatedAt,
    userId: envelope.userId,
    wraps: envelope.wraps,
  };
}

export function findHostedDomainRootWrap(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
  recipient: HostedCryptoRecipientKind;
}): HostedDomainRootKeyWrap | null {
  return input.envelope.wraps.find((wrap) => wrap.recipient === input.recipient) ?? null;
}

export function buildHostedSecureBoxAad(fields: HostedSecureBoxAadFields): Uint8Array {
  const domain = requireHostedCryptoDomain(fields.domain, "Hosted secure-box AAD domain");
  const lane = requireHostedCryptoLane(fields.lane, "Hosted secure-box AAD lane");
  const expectedDomain = getHostedCryptoDomainForLane(lane);
  if (expectedDomain !== domain) {
    throw new TypeError(
      `Hosted secure-box AAD lane ${lane} belongs to ${expectedDomain}, not ${domain}.`,
    );
  }
  return utf8(
    canonicalJson({
      domain,
      field: normalizeOptionalString(fields.field),
      lane,
      objectKey: normalizeOptionalString(fields.objectKey),
      purpose: requireNonEmptyString(fields.purpose, "Hosted secure-box AAD purpose"),
      rowId: normalizeOptionalString(fields.rowId),
      scope: requireNonEmptyString(fields.scope, "Hosted secure-box AAD scope"),
      sequence:
        fields.sequence === null || fields.sequence === undefined
          ? null
          : String(fields.sequence),
      table: normalizeOptionalString(fields.table),
      tenant: fields.tenant ?? "murph-hosted",
      userId: requireNonEmptyString(fields.userId, "Hosted secure-box AAD userId"),
    }),
  );
}

export async function sealHostedSecureBox(input: {
  aad: Uint8Array;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  plaintext: Uint8Array;
  rootKey: Uint8Array;
  rootKeyId: string;
  scope: string;
}): Promise<HostedSecureBoxEnvelopeV1> {
  const domain = requireHostedCryptoDomain(input.domain, "Hosted secure-box domain");
  const lane = requireHostedCryptoLane(input.lane, "Hosted secure-box lane");
  const expectedDomain = getHostedCryptoDomainForLane(lane);
  if (expectedDomain !== domain) {
    throw new TypeError(`Hosted crypto lane ${lane} belongs to ${expectedDomain}, not ${domain}.`);
  }
  const scope = requireNonEmptyString(input.scope, "Hosted secure-box scope");
  const key = await deriveHostedSecureBoxKey({
    domain,
    lane,
    rootKey: input.rootKey,
    rootKeyId: input.rootKeyId,
    scope,
  });
  const iv = crypto.getRandomValues(new Uint8Array(HOSTED_SECURE_BOX_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { additionalData: toArrayBuffer(input.aad), iv, name: "AES-GCM" },
      key,
      toArrayBuffer(input.plaintext),
    ),
  );
  return {
    alg: "AES-256-GCM-HKDF-SHA256",
    ciphertext: encodeBase64(ciphertext),
    domain,
    iv: encodeBase64(iv),
    lane,
    rootKeyId: requireNonEmptyString(input.rootKeyId, "Hosted secure-box rootKeyId"),
    schema: HOSTED_SECURE_BOX_ENVELOPE_SCHEMA,
    scope,
  };
}

export async function openHostedSecureBox(input: {
  aad: Uint8Array;
  envelope: HostedSecureBoxEnvelopeV1;
  expectedDomain: HostedCryptoDomain;
  expectedLane: HostedCryptoLane;
  expectedRootKeyId?: string | null;
  expectedScope?: string | null;
  rootKey: Uint8Array;
}): Promise<Uint8Array> {
  const envelope = parseHostedSecureBoxEnvelope(input.envelope);
  if (envelope.domain !== input.expectedDomain) {
    throw new Error(`Hosted secure-box domain mismatch: expected ${input.expectedDomain}.`);
  }
  if (envelope.lane !== input.expectedLane) {
    throw new Error(`Hosted secure-box lane mismatch: expected ${input.expectedLane}.`);
  }
  if (input.expectedRootKeyId && envelope.rootKeyId !== input.expectedRootKeyId) {
    throw new Error("Hosted secure-box rootKeyId mismatch.");
  }
  if (input.expectedScope && envelope.scope !== input.expectedScope) {
    throw new Error("Hosted secure-box scope mismatch.");
  }
  const key = await deriveHostedSecureBoxKey({
    domain: envelope.domain,
    lane: envelope.lane,
    rootKey: input.rootKey,
    rootKeyId: envelope.rootKeyId,
    scope: envelope.scope,
  });
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        additionalData: toArrayBuffer(input.aad),
        iv: toArrayBuffer(
          decodeFixedBase64(
            envelope.iv,
            HOSTED_SECURE_BOX_IV_BYTES,
            "Hosted secure-box IV",
          ),
        ),
        name: "AES-GCM",
      },
      key,
      toArrayBuffer(decodeBase64(envelope.ciphertext)),
    ),
  );
}

export function serializeHostedSecureBoxEnvelope(
  envelope: HostedSecureBoxEnvelopeV1,
): string {
  return JSON.stringify(envelope);
}

export function parseSerializedHostedSecureBoxEnvelope(
  value: string,
): HostedSecureBoxEnvelopeV1 {
  return parseHostedSecureBoxEnvelope(JSON.parse(value));
}

export function parseHostedSecureBoxEnvelope(
  value: unknown,
  label = "Hosted secure-box envelope",
): HostedSecureBoxEnvelopeV1 {
  const record = requireRecord(value, label);
  const envelope: HostedSecureBoxEnvelopeV1 = {
    alg: requireLiteral(record.alg, "AES-256-GCM-HKDF-SHA256", `${label}.alg`),
    ciphertext: requireNonEmptyString(record.ciphertext, `${label}.ciphertext`),
    domain: requireHostedCryptoDomain(record.domain, `${label}.domain`),
    iv: requireNonEmptyString(record.iv, `${label}.iv`),
    lane: requireHostedCryptoLane(record.lane, `${label}.lane`),
    rootKeyId: requireNonEmptyString(record.rootKeyId, `${label}.rootKeyId`),
    schema: requireLiteral(record.schema, HOSTED_SECURE_BOX_ENVELOPE_SCHEMA, `${label}.schema`),
    scope: requireNonEmptyString(record.scope, `${label}.scope`),
  };
  const expectedDomain = getHostedCryptoDomainForLane(envelope.lane);
  if (expectedDomain !== envelope.domain) {
    throw new TypeError(`${label}.lane belongs to ${expectedDomain}, not ${envelope.domain}.`);
  }
  return envelope;
}

export async function wrapHostedDomainRootKeyWithP256Ecdh(input: {
  encryptionContext: Record<string, string>;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  recipientPublicJwk: JsonWebKey;
  rootKey: Uint8Array;
  teePolicyId?: string | null;
}): Promise<HostedEcdhWrappedDomainRootKey> {
  const recipient = requireHostedCryptoEcdhRecipientKind(input.recipient, "ECDH wrap recipient");
  const recipientKeyId = requireNonEmptyString(input.recipientKeyId, "ECDH wrap recipientKeyId");
  const rootKey = requireRootKey(input.rootKey, "ECDH wrap rootKey");
  const teePolicyId = normalizeHostedTeePolicyId(
    input.teePolicyId ?? null,
    recipient,
    "ECDH wrap teePolicyId",
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const recipientPublicJwk = normalizeP256PublicJwk(
    input.recipientPublicJwk,
    "ECDH wrap recipientPublicJwk",
  );
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    recipientPublicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: recipientPublicKey },
      ephemeral.privateKey,
      256,
    ),
  );
  let wrapKey: CryptoKey;
  const ephemeralPublicJwk = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
  const wrapAad = buildHostedEcdhWrapAad({
    encryptionContext: input.encryptionContext,
    ephemeralPublicJwk,
    recipient,
    recipientKeyId,
    teePolicyId,
  });
  try {
    wrapKey = await deriveHostedEcdhWrapKey({
      encryptionContext: input.encryptionContext,
      recipient,
      recipientKeyId,
      sharedSecret,
      teePolicyId,
    });
  } finally {
    sharedSecret.fill(0);
  }
  const iv = crypto.getRandomValues(new Uint8Array(HOSTED_ECDH_WRAP_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { additionalData: toArrayBuffer(wrapAad), iv, name: "AES-GCM" },
      wrapKey,
      toArrayBuffer(rootKey),
    ),
  );
  return {
    ciphertext: encodeBase64(ciphertext),
    encryptionContext: normalizeStringRecord(input.encryptionContext, "ECDH wrap encryptionContext"),
    ephemeralPublicJwk: normalizePublicJwkForEnvelope(ephemeralPublicJwk),
    iv: encodeBase64(iv),
    kind: "p256-ecdh-aesgcm",
    recipient,
    recipientKeyId,
    ...(teePolicyId ? { teePolicyId } : {}),
  };
}

export async function unwrapHostedDomainRootKeyWithP256Ecdh(input: {
  privateJwk: JsonWebKey;
  wrap: HostedEcdhWrappedDomainRootKey;
}): Promise<Uint8Array> {
  const wrap = parseHostedEcdhWrappedDomainRootKey(input.wrap, "ECDH domain root wrap");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    normalizeP256PrivateJwk(input.privateJwk, "ECDH unwrap privateJwk"),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "jwk",
    wrap.ephemeralPublicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: ephemeralPublicKey },
      privateKey,
      256,
    ),
  );
  const teePolicyId = normalizeHostedTeePolicyId(
    wrap.teePolicyId ?? null,
    wrap.recipient,
    "ECDH unwrap teePolicyId",
  );
  const wrapAad = buildHostedEcdhWrapAad({
    encryptionContext: wrap.encryptionContext,
    ephemeralPublicJwk: wrap.ephemeralPublicJwk,
    recipient: wrap.recipient,
    recipientKeyId: wrap.recipientKeyId,
    teePolicyId,
  });
  let wrapKey: CryptoKey;
  try {
    wrapKey = await deriveHostedEcdhWrapKey({
      encryptionContext: wrap.encryptionContext,
      recipient: wrap.recipient,
      recipientKeyId: wrap.recipientKeyId,
      sharedSecret,
      teePolicyId,
    });
  } finally {
    sharedSecret.fill(0);
  }
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        additionalData: toArrayBuffer(wrapAad),
        iv: toArrayBuffer(
          decodeFixedBase64(wrap.iv, HOSTED_ECDH_WRAP_IV_BYTES, "ECDH root wrap IV"),
        ),
        name: "AES-GCM",
      },
      wrapKey,
      toArrayBuffer(decodeBase64(wrap.ciphertext)),
    ),
  );
}

export async function verifyHostedDomainRootEnvelopeSignatureWithPublicKey(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
  publicKeyPem: string;
}): Promise<boolean> {
  const publicKey = await importP256PublicKeyFromPem(input.publicKeyPem);
  const signature = tryNormalizeHostedDomainRootEnvelopeAuthoritySignature(
    input.envelope.authoritySignature.signature,
  );
  if (!signature) {
    return false;
  }
  return crypto.subtle.verify(
    { hash: "SHA-256", name: "ECDSA" },
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(
      buildHostedDomainRootEnvelopeSigningPayload(getHostedDomainRootEnvelopeBody(input.envelope)),
    ),
  );
}

export function hasValidHostedDomainRootEnvelopeAuthoritySignatureEncoding(
  envelope: Pick<HostedDomainRootKeyEnvelopeV1, "authoritySignature">,
): boolean {
  return tryNormalizeHostedDomainRootEnvelopeAuthoritySignature(
    envelope.authoritySignature.signature,
  ) !== null;
}

export async function assertHostedAuthorityVerifyPublicKeyPem(
  publicKeyPem: string,
): Promise<void> {
  await importP256PublicKeyFromPem(publicKeyPem);
}

async function deriveHostedSecureBoxKey(input: {
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  rootKey: Uint8Array;
  rootKeyId: string;
  scope: string;
}): Promise<CryptoKey> {
  const root = requireRootKey(input.rootKey, "Hosted secure-box rootKey");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(root),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: toArrayBuffer(utf8(
        canonicalJson({
          alg: "AES-256-GCM-HKDF-SHA256",
          domain: input.domain,
          lane: input.lane,
          rootKeyId: input.rootKeyId,
          scope: input.scope,
          schema: HOSTED_SECURE_BOX_ENVELOPE_SCHEMA,
        }),
      )),
      name: "HKDF",
      salt: HOSTED_SECURE_BOX_HKDF_SALT,
    },
    keyMaterial,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

async function deriveHostedEcdhWrapKey(input: {
  encryptionContext: Record<string, string>;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  sharedSecret: Uint8Array;
  teePolicyId: string | null;
}): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(input.sharedSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: toArrayBuffer(utf8(
        canonicalJson({
          encryptionContext: normalizeStringRecord(
            input.encryptionContext,
            "ECDH wrap encryptionContext",
          ),
          recipient: input.recipient,
          recipientKeyId: input.recipientKeyId,
          schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
          teePolicyId: input.teePolicyId,
          wrapAlg: "P-256-ECDH-HKDF-SHA256-AES-GCM",
        }),
      )),
      name: "HKDF",
      salt: HOSTED_ECDH_WRAP_HKDF_SALT,
    },
    keyMaterial,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function buildHostedEcdhWrapAad(input: {
  encryptionContext: Record<string, string>;
  ephemeralPublicJwk: JsonWebKey;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  teePolicyId: string | null;
}): Uint8Array {
  return utf8(
    canonicalJson({
      encryptionContext: normalizeStringRecord(
        input.encryptionContext,
        "ECDH wrap encryptionContext",
      ),
      ephemeralPublicJwk: normalizePublicJwkForEnvelope(input.ephemeralPublicJwk),
      recipient: input.recipient,
      recipientKeyId: input.recipientKeyId,
      teePolicyId: input.teePolicyId,
      wrapAlg: "P-256-ECDH-HKDF-SHA256-AES-GCM",
    }),
  );
}

function parseHostedDomainRootKeyWrap(
  value: unknown,
  label: string,
): HostedDomainRootKeyWrap {
  const record = requireRecord(value, label);
  const kind = requireNonEmptyString(record.kind, `${label}.kind`);
  if (kind === "gcp-kms") {
    return parseHostedGcpKmsWrappedDomainRootKey(record, label);
  }
  if (kind === "p256-ecdh-aesgcm") {
    return parseHostedEcdhWrappedDomainRootKey(record, label);
  }
  throw new TypeError(`${label}.kind must be gcp-kms or p256-ecdh-aesgcm.`);
}

function parseHostedGcpKmsWrappedDomainRootKey(
  value: Record<string, unknown>,
  label: string,
): HostedGcpKmsWrappedDomainRootKey {
  return {
    additionalAuthenticatedData: requireNonEmptyString(
      value.additionalAuthenticatedData,
      `${label}.additionalAuthenticatedData`,
    ),
    ciphertextBlob: requireNonEmptyString(value.ciphertextBlob, `${label}.ciphertextBlob`),
    encryptionContext: requireStringRecord(value.encryptionContext, `${label}.encryptionContext`),
    kind: requireLiteral(value.kind, "gcp-kms", `${label}.kind`),
    kmsKeyName: requireNonEmptyString(value.kmsKeyName, `${label}.kmsKeyName`),
    recipient: requireHostedCryptoKmsRecipientKind(value.recipient, `${label}.recipient`),
  };
}

function parseHostedEcdhWrappedDomainRootKey(
  value: unknown,
  label: string,
): HostedEcdhWrappedDomainRootKey {
  const record = requireRecord(value, label);
  const recipient = requireHostedCryptoEcdhRecipientKind(record.recipient, `${label}.recipient`);
  if ("teePolicyId" in record && typeof record.teePolicyId !== "string") {
    throw new TypeError(`${label}.teePolicyId must be a string when present.`);
  }
  const teePolicyId = normalizeHostedTeePolicyId(
    "teePolicyId" in record ? (record.teePolicyId as string) : null,
    recipient,
    `${label}.teePolicyId`,
  );
  return {
    ciphertext: requireNonEmptyString(record.ciphertext, `${label}.ciphertext`),
    encryptionContext: requireStringRecord(record.encryptionContext, `${label}.encryptionContext`),
    ephemeralPublicJwk: normalizeP256PublicJwk(
      requireRecord(record.ephemeralPublicJwk, `${label}.ephemeralPublicJwk`) as JsonWebKey,
      `${label}.ephemeralPublicJwk`,
    ),
    iv: requireNonEmptyString(record.iv, `${label}.iv`),
    kind: requireLiteral(record.kind, "p256-ecdh-aesgcm", `${label}.kind`),
    recipient,
    recipientKeyId: requireNonEmptyString(record.recipientKeyId, `${label}.recipientKeyId`),
    ...(teePolicyId ? { teePolicyId } : {}),
  };
}

function assertUniqueHostedRecipients(
  wraps: readonly HostedDomainRootKeyWrap[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const wrap of wraps) {
    const key = wrap.recipient;
    if (seen.has(key)) {
      throw new TypeError(`${label} contains duplicate recipient ${key}.`);
    }
    seen.add(key);
  }
}

function assertHostedDomainRootEnvelopeWrapPolicy(
  body: HostedDomainRootKeyEnvelopeBodyV1,
  label: string,
): void {
  if (body.wraps.length === 0) {
    throw new TypeError(`${label} must contain at least one recipient wrap.`);
  }
  for (const wrap of body.wraps) {
    assertHostedCryptoRecipientAllowedForDomain({
      domain: body.domain,
      label: `${label}.${wrap.recipient}`,
      recipient: wrap.recipient,
    });
    assertHostedDomainRootWrapContextMatchesEnvelope({ body, label, wrap });
  }
}

function assertHostedCryptoRecipientAllowedForDomain(input: {
  domain: HostedCryptoDomain;
  label: string;
  recipient: HostedCryptoRecipientKind;
}): void {
  if (!isHostedCryptoRecipientAllowedForDomain(input)) {
    throw new TypeError(
      `${input.label} ${input.recipient} is not allowed for hosted ${input.domain} domain roots.`,
    );
  }
}

function assertHostedDomainRootWrapContextMatchesEnvelope(input: {
  body: HostedDomainRootKeyEnvelopeBodyV1;
  label: string;
  wrap: HostedDomainRootKeyWrap;
}): void {
  const context = input.wrap.encryptionContext;
  const expected = {
    app: "murph",
    domain: input.body.domain,
    purpose: "hosted-domain-root-wrap",
    recipient: input.wrap.recipient,
    rootKeyId: input.body.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    userId: input.body.userId,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (context[key] !== value) {
      throw new TypeError(
        `${input.label}.${input.wrap.recipient}.encryptionContext.${key} mismatch.`,
      );
    }
  }
  requireNonEmptyString(
    context.env,
    `${input.label}.${input.wrap.recipient}.encryptionContext.env`,
  );
  if (
    input.wrap.kind === "gcp-kms"
    && input.wrap.additionalAuthenticatedData !== serializeAdditionalAuthenticatedData(context)
  ) {
    throw new TypeError(`${input.label}.${input.wrap.recipient}.additionalAuthenticatedData mismatch.`);
  }
}

function requireDomainRootEnvelopeSchema(value: unknown, label: string) {
  return requireLiteral(value, HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA, label);
}

function requireHostedCryptoDomain(value: unknown, label: string): HostedCryptoDomain {
  const text = requireNonEmptyString(value, label);
  if (!isHostedCryptoDomain(text)) {
    throw new TypeError(`${label} must be a hosted crypto domain.`);
  }
  return text;
}

function requireHostedCryptoLane(value: unknown, label: string): HostedCryptoLane {
  const text = requireNonEmptyString(value, label);
  if (!isHostedCryptoLane(text)) {
    throw new TypeError(`${label} must be a hosted crypto lane.`);
  }
  return text;
}

function requireHostedCryptoRecipientKind(value: unknown, label: string): HostedCryptoRecipientKind {
  const text = requireNonEmptyString(value, label);
  if (
    ![...HOSTED_CRYPTO_KMS_RECIPIENT_KINDS, ...HOSTED_CRYPTO_ECDH_RECIPIENT_KINDS].includes(
      text as HostedCryptoRecipientKind,
    )
  ) {
    throw new TypeError(`${label} must be a hosted crypto recipient.`);
  }
  return text as HostedCryptoRecipientKind;
}

function requireHostedCryptoKmsRecipientKind(
  value: unknown,
  label: string,
): HostedCryptoKmsRecipientKind {
  const text = requireNonEmptyString(value, label);
  if (!(HOSTED_CRYPTO_KMS_RECIPIENT_KINDS as readonly string[]).includes(text)) {
    throw new TypeError(`${label} must be a hosted KMS recipient.`);
  }
  return text as HostedCryptoKmsRecipientKind;
}

function requireHostedCryptoEcdhRecipientKind(
  value: unknown,
  label: string,
): HostedCryptoEcdhRecipientKind {
  const text = requireNonEmptyString(value, label);
  if (!(HOSTED_CRYPTO_ECDH_RECIPIENT_KINDS as readonly string[]).includes(text)) {
    throw new TypeError(`${label} must be a hosted ECDH recipient.`);
  }
  return text as HostedCryptoEcdhRecipientKind;
}

function requireRootKey(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== HOSTED_DOMAIN_ROOT_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_DOMAIN_ROOT_KEY_BYTES} bytes.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function requireStringRecord(value: unknown, label: string): Record<string, string> {
  return normalizeStringRecord(requireRecord(value, label), label);
}

function normalizeStringRecord(value: Record<string, unknown>, label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError(`${label}.${key} must be a non-empty string.`);
    }
    out[key] = entry;
  }
  return out;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value as number;
}

function requireLiteral<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
  }
  return expected;
}

function normalizePublicJwkForEnvelope(jwk: JsonWebKey): JsonWebKey {
  return normalizeP256PublicJwk(jwk, "P-256 public JWK");
}

function normalizeP256PublicJwk(jwk: JsonWebKey, label: string): JsonWebKey {
  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || jwk.x.length === 0
    || jwk.y.length === 0
    || "d" in jwk
  ) {
    throw new TypeError(`${label} must be a public P-256 EC JWK.`);
  }
  return {
    crv: "P-256",
    ext: true,
    key_ops: [],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function normalizeP256PrivateJwk(jwk: JsonWebKey, label: string): JsonWebKey {
  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.d !== "string"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || jwk.d.length === 0
    || jwk.x.length === 0
    || jwk.y.length === 0
  ) {
    throw new TypeError(`${label} must be a private P-256 EC JWK with d, x, and y.`);
  }
  return {
    crv: "P-256",
    d: jwk.d,
    ext: false,
    key_ops: ["deriveBits"],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function normalizeHostedTeePolicyId(
  value: string | null,
  recipient: HostedCryptoEcdhRecipientKind,
  label: string,
): string | null {
  const normalized = typeof value === "string" && value.length > 0 ? value : null;
  if (recipient === "tee-runtime-attested") {
    return requireNonEmptyString(normalized, label);
  }
  if (normalized !== null) {
    throw new TypeError(`${label} is only valid for tee-runtime-attested recipients.`);
  }
  return null;
}

async function importP256PublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey(
    "spki",
    toArrayBuffer(decodeBase64(base64)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function normalizeP256EcdsaSignature(signature: Uint8Array): Uint8Array {
  if (signature.byteLength === 64) {
    return signature;
  }
  if (signature[0] !== 0x30) {
    throw new TypeError("ECDSA signature must be DER sequence or P-1363 raw signature.");
  }
  let offset = 1;
  const sequenceLength = readDerLength(signature, offset);
  offset = sequenceLength.nextOffset;
  if (sequenceLength.length + offset !== signature.byteLength) {
    throw new TypeError("ECDSA DER signature has invalid length.");
  }
  const r = readDerInteger(signature, offset);
  offset = r.nextOffset;
  const s = readDerInteger(signature, offset);
  if (s.nextOffset !== signature.byteLength) {
    throw new TypeError("ECDSA DER signature contains trailing bytes.");
  }
  return concatBytes(leftPadTo32(r.value), leftPadTo32(s.value));
}

function tryNormalizeHostedDomainRootEnvelopeAuthoritySignature(
  signature: string,
): Uint8Array | null {
  try {
    return normalizeP256EcdsaSignature(decodeBase64(signature));
  } catch {
    return null;
  }
}

function readDerLength(bytes: Uint8Array, offset: number): { length: number; nextOffset: number } {
  const first = bytes[offset];
  if (first === undefined) {
    throw new TypeError("Missing DER length.");
  }
  if ((first & 0x80) === 0) {
    return { length: first, nextOffset: offset + 1 };
  }
  const count = first & 0x7f;
  if (count <= 0 || count > 2) {
    throw new TypeError("Unsupported DER length encoding.");
  }
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = bytes[offset + 1 + index];
    if (byte === undefined) {
      throw new TypeError("Truncated DER length.");
    }
    length = (length << 8) | byte;
  }
  return { length, nextOffset: offset + 1 + count };
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: Uint8Array; nextOffset: number } {
  if (bytes[offset] !== 0x02) {
    throw new TypeError("Expected DER integer.");
  }
  const length = readDerLength(bytes, offset + 1);
  const start = length.nextOffset;
  const end = start + length.length;
  if (end > bytes.byteLength) {
    throw new TypeError("Truncated DER integer.");
  }
  let value = bytes.slice(start, end);
  while (value.byteLength > 0 && value[0] === 0x00) {
    value = value.slice(1);
  }
  return { nextOffset: end, value };
}

function leftPadTo32(value: Uint8Array): Uint8Array {
  if (value.byteLength > 32) {
    throw new TypeError("ECDSA integer is larger than P-256 size.");
  }
  const out = new Uint8Array(32);
  out.set(value, 32 - value.byteLength);
  return out;
}

function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Cannot canonicalize unsupported JSON value.");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function decodeFixedBase64(value: string, expectedBytes: number, label: string): Uint8Array {
  const decoded = decodeBase64(value);
  if (decoded.byteLength !== expectedBytes) {
    throw new TypeError(`${label} must decode to ${expectedBytes} bytes.`);
  }
  return decoded;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.byteLength + second.byteLength);
  out.set(first, 0);
  out.set(second, first.byteLength);
  return out;
}
