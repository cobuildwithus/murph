import { Prisma, type PrismaClient } from "@prisma/client";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  createHostedDomainRootKeyId,
  findHostedDomainRootWrap,
  generateHostedDomainRootKey,
  parseHostedDomainRootKeyEnvelope,
  serializeAdditionalAuthenticatedData,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedCryptoDomain,
  type HostedCryptoKmsRecipientKind,
  type HostedCryptoRecipientKind,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
  type HostedDomainRootKeyWrap,
  type HostedEcdhWrappedDomainRootKey,
  type HostedGcpKmsWrappedDomainRootKey,
} from "@murphai/runtime-state";

import { getPrisma } from "../prisma";
import { getHostedWebCryptoConfig } from "./env";

type HostedCryptoTx = Prisma.TransactionClient;
type HostedCryptoClient = PrismaClient | Prisma.TransactionClient;
type HostedCryptoTransactionRoot = {
  $transaction<T>(fn: (tx: HostedCryptoTx) => Promise<T>): Promise<T>;
};

const ALL_DOMAINS: readonly HostedCryptoDomain[] = ["control", "device", "ingress", "runtime"];
const WEB_UNWRAP_DOMAINS = new Set<HostedCryptoDomain>(["control", "device", "ingress"]);

interface HostedUserCryptoEnvelopeRow {
  id: string;
  userId: string;
  domain: HostedCryptoDomain;
  rootKeyId: string;
  status: string;
  signedEnvelopeJson: unknown;
}

export interface UnwrappedHostedDomainRoot {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
}

export async function provisionHostedCryptoDomainRootsForUser(input: {
  prisma?: PrismaClient;
  reason?: string;
  userId: string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  await prisma.$transaction(async (tx) => {
    for (const domain of ALL_DOMAINS) {
      await getOrCreateActiveHostedDomainRootEnvelopeTx({
        domain,
        reason: input.reason ?? "hosted-crypto.provision",
        tx,
        userId: input.userId,
      });
    }
  });
}

export async function getOrCreateActiveHostedDomainRootEnvelope(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  reason?: string;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const prisma = input.prisma ?? getPrisma();
  if (hasPrismaTransactionRoot(prisma)) {
    return prisma.$transaction((tx) =>
      getOrCreateActiveHostedDomainRootEnvelopeTx({
        domain: input.domain,
        reason: input.reason ?? "hosted-crypto.get-or-create",
        tx,
        userId: input.userId,
      }),
    );
  }
  return getOrCreateActiveHostedDomainRootEnvelopeTx({
    domain: input.domain,
    reason: input.reason ?? "hosted-crypto.get-or-create",
    tx: prisma,
    userId: input.userId,
  });
}

export async function unwrapHostedDomainRootForWeb(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<UnwrappedHostedDomainRoot> {
  if (!WEB_UNWRAP_DOMAINS.has(input.domain)) {
    throw new Error(`Web is not allowed to unwrap hosted ${input.domain} domain roots.`);
  }
  const envelope = await getOrCreateActiveHostedDomainRootEnvelope({
    domain: input.domain,
    prisma: input.prisma,
    reason: "hosted-crypto.web-unwrap",
    userId: input.userId,
  });
  const rootKey = await unwrapEnvelopeForWeb({ envelope });
  return { envelope, rootKey };
}

export async function readHostedRuntimeCryptoContextForWorker(input: {
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<{
  envelopes: {
    ingress: HostedDomainRootKeyEnvelopeV1;
    runtime: HostedDomainRootKeyEnvelopeV1;
  };
  schema: "murph.hosted-runtime-crypto-context.v1";
  userId: string;
}> {
  const prisma = input.prisma ?? getPrisma();
  const ingress = await getOrCreateActiveHostedDomainRootEnvelope({
    domain: "ingress",
    prisma,
    reason: "hosted-crypto.worker-context",
    userId: input.userId,
  });
  const runtime = await getOrCreateActiveHostedDomainRootEnvelope({
    domain: "runtime",
    prisma,
    reason: "hosted-crypto.worker-context",
    userId: input.userId,
  });
  return {
    envelopes: { ingress, runtime },
    schema: "murph.hosted-runtime-crypto-context.v1",
    userId: input.userId,
  };
}

async function getOrCreateActiveHostedDomainRootEnvelopeTx(input: {
  domain: HostedCryptoDomain;
  reason: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.userId}), hashtext(${input.domain}))
  `;

  const existing = await readActiveHostedDomainRootEnvelopeRow({
    domain: input.domain,
    tx: input.tx,
    userId: input.userId,
  });
  if (existing) {
    return parseAssertAndVerifyEnvelope(existing, input);
  }

  const created = await createSignedHostedDomainRootEnvelope({
    domain: input.domain,
    userId: input.userId,
  });
  const id = crypto.randomUUID();
  await input.tx.$executeRaw`
    INSERT INTO hosted_user_crypto_envelope (
      id,
      user_id,
      domain,
      root_key_id,
      status,
      signed_envelope_json,
      activated_at,
      updated_at
    ) VALUES (
      ${id},
      ${input.userId},
      ${input.domain}::hosted_crypto_domain,
      ${created.envelope.rootKeyId},
      'active'::hosted_crypto_envelope_status,
      ${JSON.stringify(created.envelope)}::jsonb,
      NOW(),
      NOW()
    )
  `;
  await recordHostedCryptoAuditTx({
    action: "domain-root.provisioned",
    actor: "web",
    domain: input.domain,
    reason: input.reason,
    recipientKinds: created.envelope.wraps.map((wrap) => wrap.recipient),
    rootKeyId: created.envelope.rootKeyId,
    tx: input.tx,
    userId: input.userId,
  });
  return created.envelope;
}

async function createSignedHostedDomainRootEnvelope(input: {
  domain: HostedCryptoDomain;
  userId: string;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  const config = getHostedWebCryptoConfig();
  const rootKey = generateHostedDomainRootKey();
  const rootKeyId = createHostedDomainRootKeyId(input.domain);
  const nowIso = new Date().toISOString();
  const wraps: HostedDomainRootKeyWrap[] = [];

  const kmsRecipient = kmsRecipientForDomain(input.domain);
  if (kmsRecipient) {
    const encryptionContext = buildHostedDomainRootWrapContext({
      domain: input.domain,
      env: config.env,
      recipient: kmsRecipient,
      rootKeyId,
      userId: input.userId,
    });
    const additionalAuthenticatedData = serializeAdditionalAuthenticatedData(encryptionContext);
    const encrypted = await config.gcpKms.encrypt({
      additionalAuthenticatedData,
      keyName: config.webWrapKmsKeyName,
      plaintext: rootKey,
    });
    wraps.push({
      additionalAuthenticatedData,
      ciphertextBlob: encrypted.ciphertext,
      encryptionContext,
      kind: "gcp-kms",
      kmsKeyName: config.webWrapKmsKeyName,
      recipient: kmsRecipient,
    });
  }

  if (input.domain === "ingress" || input.domain === "runtime") {
    wraps.push(
      await createEcdhWrap({
        domain: input.domain,
        publicJwk: config.cloudflareAutomationPublicJwk,
        recipient: "cloudflare-automation-secret",
        recipientKeyId: config.cloudflareAutomationRecipientKeyId,
        rootKey,
        rootKeyId,
        userId: input.userId,
      }),
    );
  }

  if (
    (input.domain === "ingress" || input.domain === "runtime") &&
    config.teeRuntimePublicJwk &&
    config.teeRuntimeRecipientKeyId &&
    config.teeRuntimeAttestedPolicyId
  ) {
    wraps.push(
      await createEcdhWrap({
        domain: input.domain,
        publicJwk: config.teeRuntimePublicJwk,
        recipient: "tee-runtime-attested",
        recipientKeyId: config.teeRuntimeRecipientKeyId,
        rootKey,
        rootKeyId,
        teePolicyId: config.teeRuntimeAttestedPolicyId,
        userId: input.userId,
      }),
    );
  }

  if (config.recoveryPublicJwk && config.recoveryRecipientKeyId) {
    wraps.push(
      await createEcdhWrap({
        domain: input.domain,
        publicJwk: config.recoveryPublicJwk,
        recipient: "recovery-offline",
        recipientKeyId: config.recoveryRecipientKeyId,
        rootKey,
        rootKeyId,
        userId: input.userId,
      }),
    );
  }

  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: nowIso,
    domain: input.domain,
    generation: 1,
    rootKeyId,
    schema: "murph.hosted-domain-root-key-envelope.v1",
    updatedAt: nowIso,
    userId: input.userId,
    wraps,
  };
  const signature = await config.gcpKms.asymmetricSign({
    keyVersionName: config.authoritySignKeyVersionName,
    message: buildHostedDomainRootEnvelopeSigningPayload(body),
  });
  return {
    envelope: attachHostedDomainRootEnvelopeSignature({
      body,
      keyVersionName: signature.keyVersionName,
      signature: signature.signature,
      signedAt: nowIso,
    }),
    rootKey,
  };
}

async function createEcdhWrap(input: {
  domain: HostedCryptoDomain;
  publicJwk: JsonWebKey;
  recipient: "cloudflare-automation-secret" | "tee-runtime-attested" | "recovery-offline";
  recipientKeyId: string;
  rootKey: Uint8Array;
  rootKeyId: string;
  teePolicyId?: string | null;
  userId: string;
}): Promise<HostedEcdhWrappedDomainRootKey> {
  const config = getHostedWebCryptoConfig();
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: input.domain,
    env: config.env,
    recipient: input.recipient,
    rootKeyId: input.rootKeyId,
    userId: input.userId,
  });
  return wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext,
    recipient: input.recipient,
    recipientKeyId: input.recipientKeyId,
    recipientPublicJwk: input.publicJwk,
    rootKey: input.rootKey,
    teePolicyId: input.teePolicyId ?? null,
  });
}

async function unwrapEnvelopeForWeb(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
}): Promise<Uint8Array> {
  const config = getHostedWebCryptoConfig();
  await verifyEnvelopeAuthoritySignature(input.envelope);
  const recipient = kmsRecipientForDomain(input.envelope.domain);
  if (!recipient) {
    throw new Error(`Web has no KMS recipient for hosted ${input.envelope.domain} roots.`);
  }
  const wrap = findHostedDomainRootWrap({ envelope: input.envelope, recipient });
  if (!wrap || wrap.kind !== "gcp-kms") {
    throw new Error(`Hosted ${input.envelope.domain} root envelope is missing ${recipient} wrap.`);
  }
  assertExpectedGcpKmsWrap({ envelope: input.envelope, recipient, wrap });
  const decrypted = await config.gcpKms.decrypt({
    additionalAuthenticatedData: wrap.additionalAuthenticatedData,
    ciphertext: wrap.ciphertextBlob,
    keyName: wrap.kmsKeyName,
  });
  if (decrypted.plaintext.byteLength !== 32) {
    throw new Error(`Hosted ${input.envelope.domain} root GCP KMS decrypt returned invalid root length.`);
  }
  return decrypted.plaintext;
}

async function verifyEnvelopeAuthoritySignature(envelope: HostedDomainRootKeyEnvelopeV1): Promise<void> {
  const config = getHostedWebCryptoConfig();
  if (envelope.authoritySignature.keyVersionName !== config.authoritySignKeyVersionName) {
    throw new Error("Hosted domain root envelope is signed by an unexpected GCP KMS key version.");
  }
  const valid = await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
    envelope,
    publicKeyPem: config.authoritySignPublicKeyPem,
  });
  if (!valid) {
    throw new Error("Hosted domain root envelope authority signature verification failed.");
  }
}

function assertExpectedGcpKmsWrap(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
  recipient: HostedCryptoKmsRecipientKind;
  wrap: HostedGcpKmsWrappedDomainRootKey;
}): void {
  const config = getHostedWebCryptoConfig();
  if (input.wrap.kmsKeyName !== config.webWrapKmsKeyName) {
    throw new Error(`Hosted ${input.envelope.domain} root envelope uses an unexpected GCP KMS key.`);
  }
  const expectedContext = buildHostedDomainRootWrapContext({
    domain: input.envelope.domain,
    env: config.env,
    recipient: input.recipient,
    rootKeyId: input.envelope.rootKeyId,
    userId: input.envelope.userId,
  });
  const expectedAad = serializeAdditionalAuthenticatedData(expectedContext);
  if (input.wrap.additionalAuthenticatedData !== expectedAad) {
    throw new Error("Hosted domain root KMS AAD mismatch.");
  }
  if (
    serializeAdditionalAuthenticatedData(input.wrap.encryptionContext)
    !== serializeAdditionalAuthenticatedData(expectedContext)
  ) {
    throw new Error("Hosted domain root KMS encryption context mismatch.");
  }
}

async function readActiveHostedDomainRootEnvelopeRow(input: {
  domain: HostedCryptoDomain;
  tx: HostedCryptoClient;
  userId: string;
}): Promise<HostedUserCryptoEnvelopeRow | null> {
  const rows = await input.tx.$queryRaw<HostedUserCryptoEnvelopeRow[]>`
    SELECT
      id,
      user_id AS "userId",
      domain::text AS domain,
      root_key_id AS "rootKeyId",
      status::text AS status,
      signed_envelope_json AS "signedEnvelopeJson"
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND domain = ${input.domain}::hosted_crypto_domain
      AND status = 'active'::hosted_crypto_envelope_status
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function parseAssertAndVerifyEnvelope(
  row: HostedUserCryptoEnvelopeRow,
  expected: { domain: HostedCryptoDomain; userId: string },
): Promise<HostedDomainRootKeyEnvelopeV1> {
  const envelope = parseHostedDomainRootKeyEnvelope(row.signedEnvelopeJson);
  if (envelope.userId !== expected.userId || envelope.domain !== expected.domain) {
    throw new Error("Hosted domain root envelope row does not match requested user/domain.");
  }
  if (envelope.rootKeyId !== row.rootKeyId) {
    throw new Error("Hosted domain root envelope row rootKeyId mismatch.");
  }
  await verifyEnvelopeAuthoritySignature(envelope);
  return envelope;
}

async function recordHostedCryptoAuditTx(input: {
  action: string;
  actor: string;
  domain: HostedCryptoDomain;
  reason: string;
  recipientKinds: readonly HostedCryptoRecipientKind[];
  rootKeyId: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<void> {
  await input.tx.$executeRaw`
    INSERT INTO hosted_user_crypto_audit (
      id,
      user_id,
      domain,
      root_key_id,
      action,
      actor,
      reason,
      recipient_kinds_json
    ) VALUES (
      ${crypto.randomUUID()},
      ${input.userId},
      ${input.domain}::hosted_crypto_domain,
      ${input.rootKeyId},
      ${input.action},
      ${input.actor},
      ${input.reason},
      ${JSON.stringify(input.recipientKinds)}::jsonb
    )
  `;
}

function kmsRecipientForDomain(domain: HostedCryptoDomain): HostedCryptoKmsRecipientKind | null {
  switch (domain) {
    case "control":
      return "web-control-kms";
    case "device":
      return "web-device-kms";
    case "ingress":
      return "web-ingress-kms";
    case "runtime":
      return null;
  }
}

function hasPrismaTransactionRoot(
  value: HostedCryptoClient,
): value is HostedCryptoClient & HostedCryptoTransactionRoot {
  const record = value as Record<string, unknown>;
  return typeof record.$transaction === "function";
}
