import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getPrisma, createPrismaClient } from "@/src/lib/prisma";
import { admitClinicalDailySync, runClinicalDailySyncSweep } from "@/src/lib/clinical-records/daily-sync";
import { buildEpicBetaRetrievalPlan } from "@/src/lib/clinical-records/epic-policy";
import * as cryptoEnv from "@/src/lib/hosted-crypto/env";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithFreshHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import * as runtimeSignal from "@/src/lib/hosted-orchestration/signal-runtime";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!url.protocol.startsWith("postgres") || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) throw new Error("Clinical proof requires a local murph_test database.");
}
const now = new Date("2026-11-01T12:00:00Z");
const daily = 24 * 60 * 60_000;
const retry = 14 * 60_000;

describe.skipIf(!enabled)("daily clinical admission PostgreSQL", () => {
  let client: PrismaClient;
  let restoreCrypto: () => void;
  const members: string[] = [];
  beforeAll(() => { restoreCrypto = configureLocalCryptoForTest(); client = getPrisma(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await client.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });
  afterAll(async () => { await client.$disconnect(); restoreCrypto(); });

  async function fixture({ consent = true, access = true } = {}) {
    const memberId = `clinical-budget-${randomUUID()}`;
    const connectionId = `crc-${randomUUID()}`;
    members.push(memberId);
    await client.hostedMember.create({ data: { id: memberId, billingStatus: access ? "active" : "canceled" } });
    if (consent) for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: client, now });
    }
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "ingress", prisma: client, reason: "synthetic-test", userId: memberId });
    await client.clinicalRecordConnection.create({ data: {
      id: connectionId, memberId, providerDirectoryEntryId: "synthetic-epic", sourceSystem: "epic", displayName: "Synthetic hospital",
      fhirBaseUrlEncrypted: "synthetic-sealed", fhirBaseHash: "synthetic-hash", requestedScopesJson: [], connectedAt: now,
      refreshTokenEncrypted: "synthetic-refresh", patientIdEncrypted: "synthetic-patient", retrievalGeneration: 1, nextSyncAt: now,
      retrievalRuns: { create: { id: `crr-${randomUUID()}`, memberId, generation: 1, status: "complete", completedAt: now,
        retrievalPlanJson: buildEpicBetaRetrievalPlan({ frozenAt: now, pageCount: "100", resourceTypes: ["Patient", "DocumentReference"] }),
        grantedScopesJson: ["patient/Patient.r", "patient/DocumentReference.s", "offline_access"],
      } },
    } });
    const config = cryptoEnv.getHostedWebCryptoConfig();
    vi.spyOn(cryptoEnv, "getHostedWebCryptoConfig").mockReturnValue(config);
    const originalDecrypt = config.gcpKms.decrypt.bind(config.gcpKms);
    const decrypt = vi.spyOn(config.gcpKms, "decrypt");
    const signal = vi.spyOn(runtimeSignal, "signalHostedMailboxAppendRuntime")
      .mockResolvedValue({ signalAccepted: true, workflowId: "synthetic" });
    const row = () => client.clinicalRecordConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const runs = () => client.clinicalRecordRetrievalRun.findMany({ where: { connectionId, generation: { gt: 1 } } });
    const mailbox = () => client.hostedMailboxItem.count({ where: { userId: memberId } });
    return { memberId, connectionId, decrypt, originalDecrypt, signal, row, runs, mailbox };
  }

  it("short-retries a precommit unwrap failure without durable admission", async () => {
    const f = await fixture();
    f.decrypt.mockRejectedValueOnce(new Error("Synthetic KMS failure"));
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 1 });
    expect(await f.runs()).toHaveLength(0);
    expect(await f.mailbox()).toBe(0);
    expect(await f.row()).toMatchObject({ retrievalGeneration: 1, nextSyncAt: new Date(now.getTime() + retry) });
  });

  it.each(["access", "consent", "suspended"] as const)("gives conclusive %s denial the daily date", async (denial) => {
    const f = await fixture({ access: denial !== "access", consent: denial !== "consent" });
    if (denial === "suspended") {
      // Suspension wins after selection, before locked admission.
      const decrypt = f.originalDecrypt;
      f.decrypt.mockImplementationOnce(async (input) => {
        await client.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: now } });
        return decrypt(input);
      });
    }
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 0 });
    expect((await f.row()).nextSyncAt).toEqual(new Date(now.getTime() + daily));
    expect(await f.runs()).toHaveLength(0);
    expect(await f.mailbox()).toBe(0);
  });

  it("keeps committed admission after a failed signal and does not enqueue twice", async () => {
    const f = await fixture();
    f.signal.mockRejectedValue(new Error("Synthetic signal unavailable"));
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 1, failed: 0 });
    expect(await f.runs()).toMatchObject([{ status: "queued", generation: 2 }]);
    expect(await f.mailbox()).toBe(1);
    expect((await f.row()).nextSyncAt).toEqual(new Date(now.getTime() + daily));
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 0, queued: 0, failed: 0 });
    expect(await f.mailbox()).toBe(1);
    expect(f.signal.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("preserves a concurrent admission's date when the earlier unwrap fails", async () => {
    const f = await fixture();
    const admittedAt = new Date(now.getTime() + 1_000);
    f.decrypt.mockImplementationOnce(async () => {
      expect(await runWithFreshHostedDomainRootUnwrapCache(() => admitClinicalDailySync({
        connectionId: f.connectionId, memberId: f.memberId, now: admittedAt,
      }))).toBe(true);
      throw new Error("Synthetic earlier unwrap failure");
    });
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 1 });
    expect(await f.runs()).toHaveLength(1);
    expect((await f.row()).nextSyncAt).toEqual(new Date(admittedAt.getTime() + daily));
  });

  it("bounds a real member lock wait and admits exactly once after release", async () => {
    const f = await fixture();
    const locker = createPrismaClient({ databaseUrl, poolMax: 1 });
    let unlock!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const lock = locker.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${f.memberId} FOR UPDATE`;
      locked(); await held;
    }, { timeout: 30_000 });
    try {
      await ready;
      const start = performance.now();
      expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 1 });
      expect(performance.now() - start).toBeGreaterThanOrEqual(900);
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(await f.runs()).toHaveLength(0);
      expect((await f.row()).nextSyncAt).toEqual(new Date(now.getTime() + retry));
    } finally { unlock(); await lock; await locker.$disconnect(); }
    expect(await runClinicalDailySyncSweep({ now: new Date(now.getTime() + retry) })).toEqual({ checked: 1, queued: 1, failed: 0 });
    expect(await f.runs()).toHaveLength(1);
  });

  it("leaves an unstarted row due at an expired deadline for a later sweep", async () => {
    const f = await fixture();
    expect(await runClinicalDailySyncSweep({ now, deadlineMs: Date.now() - 1 })).toEqual({ checked: 1, queued: 0, failed: 0 });
    expect((await f.row()).nextSyncAt).toEqual(now);
    expect(await f.runs()).toHaveLength(0);
    expect(await f.mailbox()).toBe(0);
    expect(f.decrypt).not.toHaveBeenCalled();
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 1, failed: 0 });
  });
});

const LOCAL_CRYPTO_ENV_KEYS = [
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

function configureLocalCryptoForTest(): () => void {
  const previous = new Map(
    LOCAL_CRYPTO_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  Object.assign(process.env, {
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "scheduled-wake-test-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
      "projects/murph-test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/murph-test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 23).toString("base64"),
  });
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
