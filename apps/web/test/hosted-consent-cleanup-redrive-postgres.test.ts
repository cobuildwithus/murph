import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/public-ingress";
import {
  DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import type { DeviceSyncProvider, DeviceSyncAccount } from "@murphai/device-syncd/types";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import * as providers from "@/src/lib/device-sync/providers";
import { decodeHostedDeviceRoutingIndexKey } from "@/src/lib/device-sync/routing-index";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import * as runtimeSignal from "@/src/lib/hosted-orchestration/signal-runtime";
import { redriveHostedHealthDataConsentCleanups } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  recordHostedLaunchRequiredConsent,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import * as prismaModule from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Consent cleanup proof requires a loopback PostgreSQL database.");
  }
}

const hour = 60 * 60 * 1000;
const residueKinds = ["device", "clinical", "run", "reauthRun", "oauth", "intent", "meal"] as const;
type Residue = typeof residueKinds[number];

describe.skipIf(!enabled)("Postgres consent cleanup redrive", () => {
  let prisma: PrismaClient;
  let now: Date;
  const members = new Set<string>();
  const accounts = new Set<string>();
  const failedAccounts = new Set<string>();
  const request = new Request("https://app.example.test/api/internal/hosted-execution/retention/external/cron");
  const revokeAccess = vi.fn(async (account: DeviceSyncAccount) => {
    if (!accounts.has(account.externalAccountId)) throw new Error("Synthetic provider only owns its fixtures.");
    if (failedAccounts.has(account.externalAccountId)) throw new Error("Synthetic provider revoke failure.");
  });
  const provider: DeviceSyncProvider = {
    provider: "oura",
    descriptor: {
      provider: "oura", displayName: "Synthetic provider",
      connection: { kind: "external_link", callbackPath: "/connect/oura/callback" },
      normalization: { metricFamilies: ["activity"], snapshotParser: "schema" },
      sourcePriorityHints: { defaultPriority: 50, metricFamilies: { activity: 50 } },
      transportModes: ["external_link"],
    },
    connectionHandler: {
      beginConnection: async () => { throw new Error("Unused synthetic provider boundary."); },
      completeConnection: async () => { throw new Error("Unused synthetic provider boundary."); },
      revokeAccess,
    },
  };
  const tick = (at = now) => redriveHostedHealthDataConsentCleanups({ now: at, prisma, request });
  const grant = (memberId: string, at: Date) => recordHostedLaunchRequiredConsent({
    memberId, now: at, prisma, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  });
  const revoke = (memberId: string, at: Date) => revokeHostedConsentScope({
    memberId, now: at, prisma, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  });
  const providerCalls = (accountId: string) => revokeAccess.mock.calls.filter(([account]) => account.externalAccountId === accountId);

  beforeAll(() => { prisma = prismaModule.createPrismaClient({ databaseUrl, poolMax: 2 }); });
  beforeEach(() => {
    now = new Date();
    revokeAccess.mockClear();
    // The fixture and the real service both read this, and CI's shared value is not a valid key.
    vi.stubEnv("HOSTED_DEVICE_ROUTING_INDEX_KEY", Buffer.alloc(32, 7).toString("base64url"));
    vi.spyOn(prismaModule, "getPrisma").mockReturnValue(prisma);
    vi.spyOn(providers, "createHostedDeviceSyncRegistry").mockReturnValue(createDeviceSyncRegistry([
      provider,
      { ...provider, provider: "junction", descriptor: { ...provider.descriptor, provider: "junction" } },
    ]));
    vi.spyOn(runtimeSignal, "signalHostedDeviceSyncMailboxRuntime")
      .mockResolvedValue({ signalAccepted: true, workflowId: "synthetic-cleanup" });
    setHostedSecureBoxStringTestCodecForTests({ encrypt: ({ value }) => value, decrypt: ({ value }) => value });
  });
  afterEach(async () => {
    const ids = [...members];
    await prisma.deviceConnection.deleteMany({ where: { userId: { in: ids } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
    members.clear();
    accounts.clear();
    failedAccounts.clear();
    setHostedSecureBoxStringTestCodecForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function device(memberId: string, accountId = memberId, provider = "oura") {
    const old = new Date(now.getTime() - 2 * hour);
    const store = new PrismaDeviceSyncControlPlaneStore({ prisma,
      providerAccountBlindIndexKey: decodeHostedDeviceRoutingIndexKey(process.env.HOSTED_DEVICE_ROUTING_INDEX_KEY!) });
    accounts.add(accountId);
    const connection = await store.upsertConnection({ ownerId: memberId, provider, externalAccountId: accountId,
      existingAccountPolicy: "replace", connectedAt: old.toISOString(),
      ...(provider === "junction"
        ? { credential: { kind: "provider_config", providerConfigKey: "junction" } as const }
        : { tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", accessTokenExpiresAt: null } }),
    });
    return prisma.deviceConnection.update({ where: { id: connection.id }, data: { updatedAt: old } });
  }

  async function clinical(memberId: string, active: boolean) {
    return prisma.clinicalRecordConnection.create({ data: {
      id: randomUUID(), memberId, providerDirectoryEntryId: "synthetic-provider",
      sourceSystem: "synthetic", displayName: "Synthetic portal", fhirBaseHash: "synthetic-hash",
      fhirBaseUrlEncrypted: "synthetic-fhir", requestedScopesJson: [],
      connectedAt: new Date(now.getTime() - 3 * hour), status: active ? "active" : "disconnected",
      disconnectedAt: active ? null : new Date(now.getTime() - 2 * hour),
      ...(active ? {
        accessTokenEncrypted: "synthetic-access", refreshTokenEncrypted: "synthetic-refresh",
        patientIdEncrypted: "synthetic-patient", accessTokenExpiresAt: now,
        refreshLeaseId: "synthetic-lease", refreshLeaseExpiresAt: now, nextSyncAt: now,
      } : {}),
    } });
  }

  async function fixture(kinds: readonly Residue[], consent: "revoked" | "granted" | "regranted" | "recent" = "revoked") {
    const memberId = `consent_cleanup_proof_${randomUUID()}`;
    const old = new Date(now.getTime() - 2 * hour);
    members.add(memberId);
    await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    await grant(memberId, new Date(old.getTime() - hour));
    if (kinds.includes("device")) await device(memberId);
    if (kinds.some(kind => ["clinical", "run", "reauthRun"].includes(kind))) {
      const connection = await clinical(memberId, kinds.includes("clinical"));
      for (const [generation, kind] of ["run", "reauthRun"].entries()) {
        if (!kinds.includes(kind as Residue)) continue;
        await prisma.clinicalRecordRetrievalRun.create({ data: {
          id: randomUUID(), memberId, connectionId: connection.id, generation, grantedScopesJson: [],
          status: kind === "run" ? "running" : "needs_reauth",
          completedAt: kind === "run" ? null : old,
        } });
      }
    }
    if (kinds.includes("oauth")) await prisma.clinicalRecordOauthSession.create({ data: {
      stateHash: randomUUID(), memberId, webSessionId: "synthetic-session", connectIntentClaimHash: "synthetic-claim",
      providerDirectoryEntryId: "synthetic-provider", fhirBaseHash: "synthetic-hash",
      tokenEndpoint: "https://provider.example.test/token", clientId: "synthetic-client",
      redirectUri: "https://app.example.test/callback", requestedScopesJson: [],
      codeVerifierEncrypted: "synthetic-verifier", expiresAt: now,
    } });
    if (kinds.includes("intent")) await prisma.clinicalRecordConnectIntent.create({ data: {
      claimHash: randomUUID(), memberId, expiresAt: now,
    } });
    if (kinds.includes("meal")) await prisma.hostedMealPhotoCaptureEnrollment.create({ data: {
      id: randomUUID(), memberId, installationIdHash: "synthetic-installation", uploadTokenHash: randomUUID(),
      idempotencySecretEncrypted: "synthetic-secret", activatedAt: old, expiresAt: new Date(now.getTime() + hour),
    } });
    if (consent !== "granted") await revoke(memberId, consent === "recent" ? new Date(now.getTime() - hour + 1) : old);
    if (consent === "regranted") await grant(memberId, now);
    return memberId;
  }

  async function snapshot(memberId: string) {
    return {
      devices: await prisma.deviceConnection.findMany({ where: { userId: memberId }, orderBy: { id: "asc" } }),
      clinical: await prisma.clinicalRecordConnection.findMany({ where: { memberId }, orderBy: { id: "asc" } }),
      runs: await prisma.clinicalRecordRetrievalRun.findMany({ where: { memberId }, orderBy: { id: "asc" } }),
      oauth: await prisma.clinicalRecordOauthSession.findMany({ where: { memberId } }),
      intents: await prisma.clinicalRecordConnectIntent.findMany({ where: { memberId } }),
      meals: await prisma.hostedMealPhotoCaptureEnrollment.findMany({ where: { memberId } }),
      signals: await prisma.deviceSyncSignal.findMany({ where: { userId: memberId }, orderBy: { id: "asc" } }),
      mailbox: await prisma.hostedMailboxItem.findMany({ where: { userId: memberId }, orderBy: { id: "asc" } }),
    };
  }

  async function expectCleared(memberId: string) {
    const rows = await snapshot(memberId);
    for (const device of rows.devices) expect(device).toMatchObject({
      status: "disconnected", credentialKind: "none", accessTokenEncrypted: null, refreshTokenEncrypted: null,
    });
    for (const connection of rows.clinical) expect(connection).toMatchObject({
      status: "disconnected", disconnectedAt: expect.any(Date), accessTokenEncrypted: null,
      refreshTokenEncrypted: null, patientIdEncrypted: null, accessTokenExpiresAt: null,
      refreshLeaseId: null, refreshLeaseExpiresAt: null, nextSyncAt: null,
    });
    for (const run of rows.runs) expect(run).toMatchObject({ status: "canceled", completedAt: expect.any(Date) });
    expect(rows.oauth).toEqual([]);
    expect(rows.intents).toEqual([]);
    for (const meal of rows.meals) expect(meal).toMatchObject({
      revokedAt: expect.any(Date), revokeReason: "health_data_consent_withdrawn",
      uploadTokenHash: null, idempotencySecretEncrypted: null, activatedAt: null, expiresAt: null,
    });
  }

  it("recovers a committed withdrawal whose after cleanup never ran", async () => {
    const memberId = await fixture(residueKinds);
    await tick();
    await expectCleared(memberId);
    expect(providerCalls(memberId)).toHaveLength(1);
    expect(providerCalls(memberId)[0]?.[0].credential).toMatchObject({
      kind: "oauth_tokens", tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    });
    const cleaned = await snapshot(memberId);
    await tick(new Date(now.getTime() + 2 * hour));
    expect(providerCalls(memberId)).toHaveLength(1);
    expect(await snapshot(memberId)).toEqual(cleaned);
  });

  it.each(residueKinds)("nominates and clears %s residue alone", async kind => {
    const memberId = await fixture([kind]);
    await tick();
    await expectCleared(memberId);
    expect(providerCalls(memberId)).toHaveLength(kind === "device" ? 1 : 0);
  });

  it.each(["granted", "regranted", "recent"] as const)("leaves %s consent and all its rows unchanged", async consent => {
    const memberId = await fixture(residueKinds, consent);
    const before = await snapshot(memberId);
    await tick();
    expect(await snapshot(memberId)).toEqual(before);
    expect(providerCalls(memberId)).toHaveLength(0);
  });

  it("makes a nominated cleanup a no-op when consent is regranted after selection", async () => {
    const memberId = await fixture(residueKinds);
    const before = await snapshot(memberId);
    const regrantAfterSelection = new Proxy(prisma, { get: (target, key) => key === "$queryRaw"
      ? async (...query: Parameters<PrismaClient["$queryRaw"]>) => {
          const rows = await target.$queryRaw(...query);
          await grant(memberId, now);
          return rows;
        }
      : Reflect.get(target, key) });
    const { selected } = await redriveHostedHealthDataConsentCleanups({ now, prisma: regrantAfterSelection, request });
    expect(selected).toBeGreaterThan(0);
    expect(await snapshot(memberId)).toEqual(before);
    expect(providerCalls(memberId)).toHaveLength(0);
  });

  it("leaves a revoked member with no residue unchanged", async () => {
    const memberId = await fixture([]);
    await clinical(memberId, false);
    const before = await snapshot(memberId);
    await tick();
    expect(await snapshot(memberId)).toEqual(before);
    expect(providerCalls(memberId)).toHaveLength(0);
  });

  it("spaces failed provider revocation and preserves the first clinical disconnect fence", async () => {
    const memberId = await fixture(["device", "clinical"]);
    failedAccounts.add(memberId);
    await tick();
    const failed = await snapshot(memberId);
    expect(providerCalls(memberId)).toHaveLength(1);
    expect(failed.devices[0]).toMatchObject({
      status: "reauthorization_required", credentialKind: "oauth_tokens",
      accessTokenEncrypted: expect.any(String), refreshTokenEncrypted: expect.any(String),
      lastErrorCode: DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE,
    });
    expect(failed.signals).toHaveLength(1);
    expect(failed.signals[0]).toMatchObject({ kind: "reauthorization_required", revokeWarningCode: "PROVIDER_REVOKE_FAILED" });
    expect(failed.mailbox).toHaveLength(1);
    const ownRuntimeCalls = () => vi.mocked(runtimeSignal.signalHostedDeviceSyncMailboxRuntime).mock.calls
      .filter(([input]) => failed.mailbox.some(item => item.id === input.mailboxItemId));
    expect(ownRuntimeCalls()).toHaveLength(1);
    const attemptedAt = failed.devices[0]!.updatedAt;
    await tick(new Date(attemptedAt.getTime() + hour - 1));
    expect(providerCalls(memberId)).toHaveLength(1);
    expect(await snapshot(memberId)).toEqual(failed);
    expect(ownRuntimeCalls()).toHaveLength(1);
    failedAccounts.delete(memberId);
    await tick(new Date(attemptedAt.getTime() + hour));
    expect(providerCalls(memberId)).toHaveLength(2);
    await expectCleared(memberId);
    expect((await snapshot(memberId)).clinical[0]!.disconnectedAt).toEqual(failed.clinical[0]!.disconnectedAt);
  });

  it("spaces retries per account when a sibling throws before updating its connection", async () => {
    const memberId = await fixture([], "granted");
    const unknownAccountId = `${memberId}_unknown`;
    const failingAccountId = `${memberId}_failing`;
    const unknown = await device(memberId, unknownAccountId);
    const failing = await device(memberId, failingAccountId);
    const retained = await prisma.deviceConnection.update({ where: { id: unknown.id }, data: {
      status: "reauthorization_required", lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN", updatedAt: unknown.updatedAt,
    } });
    expect(retained).toMatchObject({ credentialKind: "oauth_tokens",
      accessTokenEncrypted: expect.any(String), refreshTokenEncrypted: expect.any(String) });
    await revoke(memberId, new Date(now.getTime() - 2 * hour));
    failedAccounts.add(failingAccountId);

    await tick();
    const failed = await snapshot(memberId);
    expect(providerCalls(unknownAccountId)).toHaveLength(0);
    expect(providerCalls(failingAccountId)).toHaveLength(1);
    expect(failed.devices.find(row => row.id === unknown.id)).toEqual(retained);
    const attempted = failed.devices.find(row => row.id === failing.id)!;
    expect(attempted).toMatchObject({ status: "reauthorization_required", credentialKind: "oauth_tokens",
      lastErrorCode: DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE });
    expect(failed.signals).toHaveLength(1);
    expect(failed.signals[0]).toMatchObject({ connectionId: failing.id,
      kind: "reauthorization_required", revokeWarningCode: "PROVIDER_REVOKE_FAILED" });
    expect(failed.mailbox).toHaveLength(1);
    const ownRuntimeCalls = () => vi.mocked(runtimeSignal.signalHostedDeviceSyncMailboxRuntime).mock.calls
      .filter(([input]) => failed.mailbox.some(item => item.id === input.mailboxItemId));
    expect(ownRuntimeCalls()).toHaveLength(1);

    for (const elapsed of [...Array.from({ length: 11 }, (_, i) => (i + 1) * 5 * 60 * 1000), hour - 1]) {
      expect((await tick(new Date(attempted.updatedAt.getTime() + elapsed))).selected).toBeGreaterThan(0);
      expect(providerCalls(unknownAccountId)).toHaveLength(0);
      expect(providerCalls(failingAccountId)).toHaveLength(1);
      expect(await snapshot(memberId)).toEqual(failed);
      expect(ownRuntimeCalls()).toHaveLength(1);
    }

    failedAccounts.delete(failingAccountId);
    await tick(new Date(attempted.updatedAt.getTime() + hour));
    expect(providerCalls(unknownAccountId)).toHaveLength(0);
    expect(providerCalls(failingAccountId)).toHaveLength(2);
    const retried = await snapshot(memberId);
    expect(retried.devices.find(row => row.id === unknown.id)).toEqual(retained);
    expect(retried.devices.find(row => row.id === failing.id)).toMatchObject({
      status: "disconnected", credentialKind: "none", accessTokenEncrypted: null, refreshTokenEncrypted: null,
    });
  });

  it("revokes and clears a Junction provider_config credential through the real store", async () => {
    const memberId = await fixture([], "granted");
    const connection = await device(memberId, memberId, "junction");
    expect(connection).toMatchObject({ credentialKind: "provider_config", providerConfigKey: "junction" });
    await revoke(memberId, new Date(now.getTime() - 2 * hour));

    await tick();
    expect(providerCalls(memberId)).toHaveLength(1);
    expect(providerCalls(memberId)[0]?.[0]).toMatchObject({ provider: "junction",
      credential: { kind: "provider_config", providerConfigKey: "junction" } });
    await expectCleared(memberId);
    expect((await snapshot(memberId)).devices[0]).toMatchObject({ providerConfigKey: null });
  });

  it("revokes a credential retained on a row already marked disconnected", async () => {
    const memberId = await fixture(["device"]);
    await prisma.deviceConnection.updateMany({ where: { userId: memberId }, data: {
      status: "disconnected", updatedAt: new Date(now.getTime() - hour),
    } });
    await tick();
    await expectCleared(memberId);
    expect(providerCalls(memberId)).toHaveLength(1);
  });

  it("finishes an interrupted disconnect with retained credentials after the hour", async () => {
    const memberId = await fixture(["device"]);
    await prisma.deviceConnection.updateMany({ where: { userId: memberId }, data: {
      status: "reauthorization_required", lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      updatedAt: new Date(now.getTime() - hour),
    } });
    await tick();
    await expectCleared(memberId);
    expect(providerCalls(memberId)).toHaveLength(1);
  });
});
