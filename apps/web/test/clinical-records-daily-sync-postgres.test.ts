import * as chatLock from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { incrementHostedLinqInboundDailyState } from "@/src/lib/hosted-onboarding/linq-daily-state";
import * as callbackAuth from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { POST as authorizeEgress } from "../app/api/internal/hosted-runtime/linq-egress/engagement/route";
import { POST as recordOutcome } from "../app/api/internal/hosted-runtime/linq-egress/delivery/route";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import * as control from "@/src/lib/hosted-execution/control";
import { clinicalChangeDeliveryKey } from "@murphai/hosted-execution/clinical-records-boundary";
import { appendHostedMailboxEnvelopeTx } from "@/src/lib/hosted-mailbox/store";
import { clinicalFhirRetrievalPlanSchema, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getPrisma, createPrismaClient } from "@/src/lib/prisma";
import { clinicalProcessors, clinicalProcessorScope } from "@/src/lib/clinical-records/processor-registry";
import { sealClinicalConnectionFhirBaseUrl, sealClinicalConnectionSecret } from "@/src/lib/clinical-records/secrets";
import { admitClinicalDailySync, runClinicalDailySyncSweep } from "@/src/lib/clinical-records/daily-sync";
import { buildHostedMemberIdentityPrivateColumns, buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { clinicalEgressBlock, readClinicalNotificationAuthority, readClinicalNotificationDecision } from "@/src/lib/clinical-records/notification";
import { fetchClinicalRetrievalPage, recordClinicalChangeProof, recordClinicalRetrievalOutcome, readClinicalRetrievalRun } from "@/src/lib/clinical-records/retrieval";
import { buildEpicBetaRetrievalPlan } from "@/src/lib/clinical-records/epic-policy";
import * as cryptoEnv from "@/src/lib/hosted-crypto/env";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithFreshHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import * as runtimeSignal from "@/src/lib/hosted-orchestration/signal-runtime";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";

import { startNativeAuthorization, completeNativeAuthorization } from "@/src/lib/clinical-records/control-plane";
import * as directory from "@/src/lib/clinical-records/provider-directory-store";
import * as smart from "@/src/lib/clinical-records/smart";
import * as notification from "@/src/lib/clinical-records/notification";
import { setClinicalRecordMessageMode } from "@/src/lib/clinical-records/message-preference";
import { setClinicalProcessorApproval } from "@/src/lib/clinical-records/processor-approvals";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { signerPem } from "./clinical-records-synthetic-signer";

vi.mock("../public/.well-known/epic/sandbox.jwks.json", async () => ({
  default: { keys: [(await import("./clinical-records-synthetic-signer")).sandboxPublicKey] },
}));

function lockBarrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(release => { resolve = release; });
  return { promise, resolve };
}

async function nativeAuth(memberId: string) {
  vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 11).toString("base64url"));
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 12).toString("base64url"));
  vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", Buffer.alloc(32, 13).toString("base64url"));
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://app.example.test");
  const session = await issueHostedAppSession({ memberId });
  return requireHostedMemberAuthFromBearerToken(new Request("https://app.example.test", {
    headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(session.token)}` },
  }));
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!url.protocol.startsWith("postgres") || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) throw new Error("Clinical proof requires a local murph_test database.");
}
const now = new Date("2026-11-01T12:00:00Z");
const openWindow = new Date("2026-11-01T19:00:00Z");
const daily = 24 * 60 * 60_000;
const retry = 14 * 60_000;
const currentReaders = { runner: 4, cloudflarePort: 4 };
const emptyCounts = { createdCount: 0, executableDecisionCount: 0, fetchedPageCount: 0, fetchedResourceFamilyCount: 0,
  rawFileCount: 0, retractedCount: 0, reviewDecisionCount: 0, skippedExistingCount: 0, supersededCount: 0 };

describe.skipIf(!enabled)("daily clinical admission PostgreSQL", () => {
  let client: PrismaClient;
  let restoreCrypto: () => void;
  const members: string[] = [];
  beforeAll(() => { restoreCrypto = configureLocalCryptoForTest(); client = getPrisma(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await client.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });
  afterAll(async () => { await client.$disconnect(); restoreCrypto(); });

  async function fixture({ consent = true, access = true, openBaseline = false, replacement = false } = {}) {
    const memberId = `clinical-budget-${randomUUID()}`;
    const connectionId = `crc-${randomUUID()}`;
    members.push(memberId);
    await client.hostedMember.create({ data: { id: memberId, billingStatus: access ? "active" : "not_started" } });
    if (consent) for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: client, now });
    }
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "ingress", prisma: client, reason: "synthetic-test", userId: memberId });
    await client.clinicalRecordConnection.create({ data: {
      id: connectionId, memberId, providerDirectoryEntryId: "synthetic-epic", sourceSystem: "epic", displayName: "Synthetic hospital",
      fhirBaseUrlEncrypted: "synthetic-sealed", fhirBaseHash: "synthetic-hash", requestedScopesJson: [], connectedAt: now,
      requiresProcessorApprovals: replacement, refreshTokenEncrypted: "synthetic-refresh", patientIdEncrypted: "synthetic-patient", retrievalGeneration: 1, nextSyncAt: now,
      retrievalRuns: { create: { id: `crr-${randomUUID()}`, memberId, generation: 1, status: openBaseline ? "queued" : "complete", completedAt: openBaseline ? null : now,
        retrievalProtocol: "query-slices-v2",
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

  async function notificationFixture(mode: "notice" | "off" = "notice", {
    replacement = true, readers = currentReaders, verified = true, group = false, phone = "+12025550137",
    baselineStatus = "completed", scheduledSweep = false, admissionsPaused = false, firstEvidenceFailure,
  }: { replacement?: boolean; readers?: typeof currentReaders; verified?: boolean; group?: boolean; phone?: string;
    baselineStatus?: "completed" | "partial" | "failed"; scheduledSweep?: boolean; admissionsPaused?: boolean; firstEvidenceFailure?: "transport" | "staged" } = {}) {
    let reads = 0;
    if (admissionsPaused) vi.stubEnv("CLINICAL_DAILY_NOTICE_ADMISSION_PAUSED", "1");
    vi.spyOn(control, "readHostedExecutionControlClientIfConfigured").mockReturnValue(createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test", getBearerToken: async () => "synthetic",
      fetchImpl: async (url, init) => {
        reads++;
        if (reads === 1 && firstEvidenceFailure === "transport") throw new Error("Synthetic unavailable control route");
        if (reads === 1 && firstEvidenceFailure === "staged") return new Response(null, { status: 503 });
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic");
        return Response.json({ ...readers, version: "synthetic-release", nonce: new URL(String(url)).searchParams.get("nonce") });
      },
    }));
    const f = await fixture({ openBaseline: true, replacement });
    const { memberId, connectionId } = f;
    const [baseline] = await client.clinicalRecordRetrievalRun.findMany({ where: { connectionId }, take: 1 });
    const threadId = `chat-${memberId}`;
    const chat = createHostedLinqChatLookupKey(threadId)!;
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "control", prisma: client, reason: "synthetic-test", userId: memberId });
    const identity = await buildHostedMemberIdentityPrivateColumns({ memberId, phoneNumber: phone, signupPhoneNumber: null, prisma: client });
    const routing = await buildHostedMemberRoutingPrivateColumns({ memberId, linqChatId: threadId, linqRecipientPhone: "+12025550143",
      pendingLinqChatId: null, pendingLinqRecipientPhone: null, telegramThreadId: null, telegramUserId: null, prisma: client });
    const participant = createHostedPhoneLookupKey(phone)!;
    const line = createHostedPhoneLookupKey("+12025550143")!;
    await client.hostedMember.update({ where: { id: memberId }, data: {
      clinicalRecordMessageMode: mode,
      identity: { create: { ...identity, phoneNumberVerifiedAt: verified ? now : null, phoneLookupKey: participant } },
      routing: { create: { ...routing, linqChatLookupKey: chat, linqParticipantContactKind: "phone",
        linqParticipantContactLookupKey: participant, linqRecipientPhoneLookupKey: line } },
    } });
    await client.hostedLinqChatHealth.create({ data: {
      linqChatLookupKey: chat, providerUpdatedAt: now, providerObservedAt: now, providerStatus: "healthy", service: "iMessage", isGroup: group,
      line: { create: { phoneNumberLookupKey: line, phoneNumberHint: "synthetic" } },
    } });
    const cleanup = async () => {
      await client.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: chat } });
      await client.hostedLinqChatHealth.delete({ where: { linqChatLookupKey: chat } });
      await client.hostedLinqLine.delete({ where: { phoneNumberLookupKey: line } });
    };
    const baselinePointer = { memberId, runId: baseline!.id, generation: 1 };
    await recordClinicalChangeProof(baselinePointer);
    expect(await f.mailbox()).toBe(0);
    if (replacement) {
      await client.hostedConsentGrant.createMany({ data: clinicalProcessors.map(processor => ({
        memberId, scope: clinicalProcessorScope(processor), status: "granted", grantedAt: now,
        source: "synthetic", documentVersionsJson: { [processor.id]: processor.version },
      })) });
    }
    const baselinePlan = clinicalFhirRetrievalPlanSchema.parse(baseline!.retrievalPlanJson);
    await recordClinicalRetrievalOutcome({ memberId, request: { runId: baselinePointer.runId, generation: baselinePointer.generation, retrievalProtocol: "query-slices-v2",
      retrievalSlices: baselinePlan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })),
      counts: emptyCounts, status: baselineStatus, ...(baselineStatus === "failed" ? {} : { hasChangeReceipt: true }),
    } });
    await recordClinicalChangeProof(baselinePointer);
    expect(await f.mailbox()).toBe(0);
    expect((await f.row()).baselineTokenVersion).toBe(replacement && baselineStatus === "completed" ? 1 : null);
    const due = (await f.row()).nextSyncAt!;
    if (scheduledSweep) expect(await runClinicalDailySyncSweep({ now: due })).toMatchObject({ queued: 1 });
    else expect(await admitClinicalDailySync({ memberId, connectionId, now: due })).toBe(true);
    const [run] = await f.runs();
    const pointer = { memberId, runId: run!.id, generation: run!.generation };
    const count = () => client.hostedMailboxItem.count({ where: { userId: memberId, kind: "clinical-records.change-recorded" } });
    const terminal = async (proof = false, acceptedRun = run!) => {
      const plan = clinicalFhirRetrievalPlanSchema.parse(acceptedRun.retrievalPlanJson);
      await recordClinicalRetrievalOutcome({ memberId, request: { generation: acceptedRun.generation, runId: acceptedRun.id,
        status: "partial", retrievalProtocol: acceptedRun.retrievalProtocol === "query-slices-receipts-v3" ? "query-slices-receipts-v3" : "query-slices-v2",
        retrievalSlices: plan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })),
        counts: emptyCounts,
        ...(proof ? { hasChangeReceipt: true } : {}),
      } });
    };
    const authority = () => client.$transaction(tx => readClinicalNotificationAuthority(tx, pointer));
    return { ...f, pointer, threadId, chat, count, cleanup, terminal, authority };
  }

  it.each(["notice", "off"] as const)("retires the originating run when a newer eligible daily run starts in %s mode", async mode => {
    const f = await notificationFixture(mode);
    try {
      if (mode === "notice") await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
      await f.terminal();
      await f.terminal();
      expect(await f.count()).toBe(mode === "notice" ? 1 : 0);
      expect(await admitClinicalDailySync({ memberId: f.memberId, connectionId: f.connectionId,
        now: (await f.row()).nextSyncAt! })).toBe(true);
      expect(await f.runs()).toHaveLength(2);
      await Promise.all([recordClinicalChangeProof(f.pointer), recordClinicalChangeProof(f.pointer)]);
      expect(Boolean(await f.authority())).toBe(mode === "notice");
      expect(await f.count()).toBe(mode === "notice" ? 1 : 0);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "off" });
      expect((await f.runs()).find(run => run.id === f.pointer.runId)).toMatchObject(mode === "off"
        ? { retrievalProtocol: "query-slices-v2", notificationTokenVersion: null, notificationCoverage: null }
        : { retrievalProtocol: "query-slices-receipts-v3", notificationTokenVersion: 1,
            notificationSettingRevision: 0, notificationRouteKey: expect.stringMatching(/^[a-f0-9]{64}$/u), notificationCoverage: "suppressed" });
      await client.hostedMailboxItem.deleteMany({ where: { userId: f.memberId } });
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it.each([
    ["mixed-version production sweep", { scheduledSweep: true, readers: { runner: 3, cloudflarePort: 4 } }],
    ["admissions paused", { admissionsPaused: true }],
    ["old runner", { readers: { ...currentReaders, runner: 1 } }],
    ["old port", { readers: { ...currentReaders, cloudflarePort: 3 } }],
    ["legacy client", { replacement: false }],
    ["failed baseline", { baselineStatus: "failed" }],
    ["partial baseline", { baselineStatus: "partial" }],
    ["unverified phone", { verified: false }],
    ["group thread", { group: true }],
  ] as const)("keeps daily retrieval and its late enrichment silent for %s", async (_name, options) => {
    const f = await notificationFixture("notice", options);
    try {
      expect(await f.runs()).toMatchObject([{ retrievalProtocol: "query-slices-v2", notificationTokenVersion: null,
        notificationSettingRevision: null, notificationRouteKey: null }]);
      await f.terminal();
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "off" });
    } finally { await f.cleanup(); }
  });

  it.each([0, 1])("accepts an empty whole-history baseline only when the terminal page count validates (%i)", async fetchedPageCount => {
    const f = await fixture({ openBaseline: true, replacement: true });
    const run = await client.clinicalRecordRetrievalRun.findFirstOrThrow({ where: { connectionId: f.connectionId } });
    const plan = clinicalFhirRetrievalPlanSchema.parse(run.retrievalPlanJson);
    expect(run).toMatchObject({ pageCount: 0, completedAt: null });
    expect((await f.row()).baselineTokenVersion).toBeNull();
    const outcome = recordClinicalRetrievalOutcome({ memberId: f.memberId, request: {
      runId: run.id, generation: run.generation, status: "completed", retrievalProtocol: "query-slices-v2",
      counts: { ...emptyCounts, fetchedPageCount }, retrievalSlices: plan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })),
    } });
    if (fetchedPageCount === 0) {
      await outcome;
      expect(await f.row()).toMatchObject({ tokenVersion: 1, baselineTokenVersion: 1 });
    } else {
      await expect(outcome).rejects.toMatchObject({ code: "CLINICAL_RECORD_OUTCOME_COUNT_MISMATCH" });
      expect((await f.row()).baselineTokenVersion).toBeNull();
    }
  });

  it("requires a fresh baseline after a same-patient replacement SMART authorization", async () => {
    const f = await notificationFixture();
    try {
      await f.terminal(true);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "notice", threadId: f.threadId });
      const auth = await nativeAuth(f.memberId);
      const fhirBaseUrl = "https://portal.example.test/fhir";
      const patientId = "synthetic-patient";
      const { providerDirectoryEntryId, tokenVersion } = await f.row();
      vi.spyOn(directory, "resolveClinicalProviderDirectoryEntry").mockReturnValue({
        id: providerDirectoryEntryId, aliases: [], brandName: "Synthetic hospital", facilities: [], fhirBaseUrl,
        clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID", policyId: "synthetic-policy",
        requestedBaseScopes: ["openid", "fhirUser", "launch/patient"], resourceTypes: ["Patient", "DocumentReference"], sourceSystem: "epic-fhir",
      });
      vi.stubEnv("EPIC_SMART_NON_PRODUCTION_CLIENT_ID", "synthetic-signed");
      vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PUBLIC_CLIENT_ID", "synthetic-public");
      vi.stubEnv("EPIC_SMART_NON_PRODUCTION_ASYMMETRIC_CLIENT_ID", "synthetic-signed");
      vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PRIVATE_KEY_PEM", signerPem);
      const requestedScopes = ["patient/Patient.rs", "patient/DocumentReference.rs", "offline_access"];
      vi.spyOn(smart, "discoverSmartConfiguration").mockResolvedValue({ authorizationEndpoint: fhirBaseUrl + "/authorize",
        tokenEndpoint: fhirBaseUrl + "/token", requestedScopes, requestedResourceTypes: ["Patient", "DocumentReference"] });
      vi.spyOn(smart, "exchangeSmartAuthorizationCode").mockResolvedValue({ patientId, grantedScopes: requestedScopes,
        accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresInSeconds: 3600 });
      await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "device", prisma: client, reason: "synthetic-test", userId: f.memberId });
      await client.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: {
        fhirBaseHash: createHash("sha256").update(fhirBaseUrl).digest("hex"),
        patientBindingEncrypted: await sealClinicalConnectionSecret({ memberId: f.memberId, connectionId: f.connectionId,
          tokenVersion, field: "patientBinding", value: hashClinicalFhirPatientId(patientId) }),
      } });
      const start = await startNativeAuthorization({ auth, appReturn: "ios", origin: "https://app.example.test", providerDirectoryEntryId });
      const state = new URL(start.authorizationUrl).searchParams.get("state")!;
      expect(await completeNativeAuthorization(auth, new URLSearchParams({ state, code: "synthetic-code" }), start.completionProof)).toBe("connected");
      const renewed = await f.row();
      expect(renewed).toMatchObject({ tokenVersion: tokenVersion + 1, baselineTokenVersion: tokenVersion, requiresProcessorApprovals: true });
      expect(renewed.refreshTokenEncrypted).toBeTruthy();
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "off" });
      const baseline = await client.clinicalRecordRetrievalRun.findUniqueOrThrow({
        where: { connectionId_generation: { connectionId: f.connectionId, generation: renewed.retrievalGeneration } },
      });
      const plan = clinicalFhirRetrievalPlanSchema.parse(baseline.retrievalPlanJson);
      await recordClinicalRetrievalOutcome({ memberId: f.memberId, request: { runId: baseline.id, generation: baseline.generation,
        status: "partial", retrievalProtocol: "query-slices-v2", counts: emptyCounts,
        retrievalSlices: plan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })) } });
      expect(await admitClinicalDailySync({ connectionId: f.connectionId, memberId: f.memberId, now: (await f.row()).nextSyncAt! })).toBe(true);
      expect(await client.clinicalRecordRetrievalRun.findUniqueOrThrow({
        where: { connectionId_generation: { connectionId: f.connectionId, generation: baseline.generation + 1 } },
      })).toMatchObject({ notificationTokenVersion: null, retrievalProtocol: "query-slices-v2" });
    } finally { await f.cleanup(); }
  });

  it.each(["setting", "approval"] as const)("serializes a %s change requested after the eligibility check and before insert", async kind => {
    const f = await notificationFixture("notice");
    let change: Promise<unknown> | undefined;
    try {
      await f.terminal();
      const auth = await nativeAuth(f.memberId);
      const freeze = notification.freezeClinicalDailyNotification;
      vi.spyOn(notification, "freezeClinicalDailyNotification").mockImplementationOnce(async (...args) => {
        const pin = await freeze(...args);
        expect(pin?.notificationTokenVersion).toBe(1);
        const processor = clinicalProcessors[0]!;
        change = kind === "setting" ? setClinicalRecordMessageMode(auth, "off")
          : setClinicalProcessorApproval(auth, processor, processor.version, false);
        // The member lock must keep the concurrent policy writer behind the still-uninserted pin.
        await vi.waitFor(async () => {
          await args[0].$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [row] = await args[0].$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (SELECT FROM pg_stat_activity WHERE datname = current_database()
              AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS waiting`;
          expect(row?.waiting).toBe(true);
        }, { timeout: 1500, interval: 10 });
        return pin;
      });
      expect(await admitClinicalDailySync({ memberId: f.memberId, connectionId: f.connectionId,
        now: (await f.row()).nextSyncAt! })).toBe(true);
      await change;
      const run = await client.clinicalRecordRetrievalRun.findUniqueOrThrow({
        where: { connectionId_generation: { connectionId: f.connectionId, generation: f.pointer.generation + 1 } },
      });
      expect(run).toMatchObject({ notificationTokenVersion: 1, notificationSettingRevision: 0, retrievalProtocol: "query-slices-receipts-v3" });
      const pointer = { memberId: f.memberId, runId: run.id, generation: run.generation };
      expect(await client.$transaction(tx => readClinicalNotificationAuthority(tx, pointer))).toBeNull();
      const plan = clinicalFhirRetrievalPlanSchema.parse(run.retrievalPlanJson);
      await recordClinicalRetrievalOutcome({ memberId: f.memberId, request: { runId: run.id, generation: run.generation,
        counts: emptyCounts, retrievalProtocol: "query-slices-receipts-v3", status: "completed", hasChangeReceipt: true,
        retrievalSlices: plan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })) } });
      expect(await readClinicalNotificationDecision(pointer, openWindow)).toEqual({ mode: "off" });
      expect(await f.count()).toBe(0);
    } finally { await change; await f.cleanup(); }
  });

  it("recovers an incomplete baseline only after a full catch-up and never upgrades the catch-up run", async () => {
    const f = await notificationFixture("notice", { baselineStatus: "partial" });
    try {
      for (let generation = 2; generation <= 7; generation++) {
        const run = await client.clinicalRecordRetrievalRun.findUniqueOrThrow({
          where: { connectionId_generation: { connectionId: f.connectionId, generation } },
        });
        expect(run.retrievalProtocol).toBe("query-slices-v2");
        const pointer = { runId: run.id, generation };
        const plan = clinicalFhirRetrievalPlanSchema.parse(run.retrievalPlanJson);
        expect(plan.slices.every(slice => slice.coverage === "whole-family")).toBe(generation === 7);
        await recordClinicalRetrievalOutcome({ memberId: f.memberId, request: { ...pointer,
          retrievalProtocol: "query-slices-v2", retrievalSlices: plan.slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })),
          counts: emptyCounts, status: "completed", hasChangeReceipt: true,
        } });
        const connection = await f.row();
        expect(connection.baselineTokenVersion).toBe(generation === 7 ? connection.tokenVersion : null);
        expect(await admitClinicalDailySync({ connectionId: f.connectionId, memberId: f.memberId,
          now: connection.nextSyncAt! })).toBe(true);
        await recordClinicalChangeProof({ memberId: f.memberId, ...pointer });
        expect(await f.count()).toBe(0);
      }
      expect(await client.clinicalRecordRetrievalRun.findUniqueOrThrow({
        where: { connectionId_generation: { connectionId: f.connectionId, generation: 8 } },
      })).toMatchObject({ retrievalProtocol: "query-slices-receipts-v3", notificationTokenVersion: 1 });
    } finally { await f.cleanup(); }
  });

  it("commits the terminal import and suppresses a conflicting notification even after mailbox cleanup", async () => {
    const f = await notificationFixture();
    try {
      await client.$transaction(tx => appendHostedMailboxEnvelopeTx({ tx, envelope: {
        kind: "clinical-records.sync-requested", eventId: `clinical-change:v1:${f.pointer.runId}`,
        userId: f.memberId, occurredAt: now.toISOString(), generation: 1, runId: "different-synthetic-run",
      } }));
      await f.terminal(true);
      expect(await f.runs()).toMatchObject([{ status: "partial", completedAt: expect.any(Date), notificationCoverage: "suppressed" }]);
      await client.hostedMailboxItem.deleteMany({ where: { userId: f.memberId } });
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it("resumes a quiet notice once at its safe wake", async () => {
    const f = await notificationFixture("notice", { scheduledSweep: true });
    try {
      await f.terminal(true);
      const quiet = new Date("2026-11-01T06:00:00Z");
      expect(await readClinicalNotificationDecision(f.pointer, quiet)).toEqual({ mode: "off" });
      const [held] = await f.runs();
      expect(held).toMatchObject({ notificationCoverage: "published", notificationDeferral: "window",
        notificationRetryAt: new Date("2026-11-01T16:00:00Z") });
      const previous = await f.count();
      await runClinicalDailySyncSweep({ now: quiet });
      expect(await f.count()).toBe(previous);
      await runClinicalDailySyncSweep({ now: openWindow });
      await runClinicalDailySyncSweep({ now: openWindow });
      expect(await f.count()).toBe(previous + 1);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "notice", threadId: f.threadId });
    } finally { await f.cleanup(); }
  });

  it("defers a blocked notice, grants once, and covers its terminal provider attempt", async () => {
    const f = await notificationFixture();
    try {
      await f.terminal(true);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(openWindow);
      vi.spyOn(callbackAuth, "requireHostedCloudflareCallbackRequest").mockResolvedValue(f.memberId);
      const idempotencyKey = clinicalChangeDeliveryKey(f.pointer.runId);
      const request = (body: Record<string, unknown>) => new Request("https://web.example.test", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const check = async (authorityCheckOnly: boolean) => (await authorizeEgress(request({ idempotencyKey,
        intentId: "synthetic-intent", target: f.threadId, targetKind: "thread", homeRouteFallbackAllowed: false,
        answeredMailboxItemIds: [], authorityCheckOnly }))).json();
      const where = { phoneNumberLookupKey: createHostedPhoneLookupKey("+12025550143")! };
      await client.hostedLinqLine.update({ where, data: { egressPolicy: "disabled" } });
      expect(await check(false)).toMatchObject({ deliveryBlockCode: "operator_disabled" });
      expect((await f.runs())[0]).toMatchObject({ notificationCoverage: "published", notificationRetryAt: expect.any(Date) });
      await client.hostedLinqLine.update({ where, data: { egressPolicy: "enabled" } });
      expect(await check(true)).toMatchObject({ deliveryBlockCode: "automation_engagement_paused" });
      await incrementHostedLinqInboundDailyState({ memberId: f.memberId, occurredAt: openWindow, prisma: client });
      // Halt ordinary authorization after it owns the chat. Let the clinical transaction request that
      // same chat before ordinary authorization takes the member row. Reversing either order deadlocks.
      const ordinaryHasChat = lockBarrier();
      const clinicalWantsChat = lockBarrier();
      const acquireChat = chatLock.acquireHostedLinqChatOwnershipLockTx;
      const interleave = vi.spyOn(chatLock, "acquireHostedLinqChatOwnershipLockTx").mockImplementationOnce(async input => {
        await acquireChat(input);
        ordinaryHasChat.resolve();
        await clinicalWantsChat.promise;
      }).mockImplementationOnce(async input => { clinicalWantsChat.resolve(); await acquireChat(input); });
      const ordinaryPending = authorizeEgress(request({ target: f.threadId,
        targetKind: "thread", answeredMailboxItemIds: [], authorityCheckOnly: true }));
      await ordinaryHasChat.promise;
      const [ordinary, clinical] = await Promise.all([ordinaryPending, check(true)]);
      interleave.mockRestore();
      expect(ordinary.status).toBe(200);
      expect(clinical).toMatchObject({ clinicalReplyAuthorized: true });
      expect(await check(false)).toMatchObject({ clinicalReplyAuthorized: true, providerDispatchClaimed: true });
      const receipt = await recordOutcome(request({ idempotencyKey, intentId: "synthetic-intent", targetKind: "thread",
        threadIsDirect: true, target: f.threadId, attemptedAt: openWindow.toISOString(), failedAt: openWindow.toISOString(),
        failureCode: "synthetic_terminal", providerThreadId: f.threadId }));
      expect(receipt.status).toBe(200);
      expect((await f.runs())[0]?.notificationCoverage).toBe("attempted");
      expect((await check(false)).providerDispatchClaimed).not.toBe(true);
    } finally { vi.useRealTimers(); await f.cleanup(); }
  });

  it("coalesces ten paused daily occurrences and grants only the newest after release", async () => {
    const f = await notificationFixture("notice");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.spyOn(callbackAuth, "requireHostedCloudflareCallbackRequest").mockResolvedValue(f.memberId);
      const auth = async (runId: string) => (await authorizeEgress(new Request("https://web.example.test", {
        method: "POST", body: JSON.stringify({ idempotencyKey: clinicalChangeDeliveryKey(runId),
          target: f.threadId, targetKind: "thread", answeredMailboxItemIds: [], authorityCheckOnly: false, intentId: "synthetic-intent" }),
      }))).json();
      const ids: string[] = [];
      for (let day = 0; day < 10; day++) {
        vi.setSystemTime(new Date(openWindow.getTime() + day * daily));
        if (day) {
          expect(await admitClinicalDailySync({ memberId: f.memberId, connectionId: f.connectionId, now: (await f.row()).nextSyncAt! })).toBe(true);
        }
        const latest = (await f.runs()).sort((a,b) => b.generation - a.generation)[0]!;
        await f.terminal(true, latest);
        ids.push(latest.id);
        if (day === 3) {
          await client.hostedLinqChatHealth.update({ where: { linqChatLookupKey: f.chat }, data: { providerStatus: "OPTED_OUT" } });
          expect(await auth(latest.id)).toMatchObject({ deliveryBlockCode: "chat_opted_out" });
          expect((await f.runs()).find(row => row.id === latest.id)?.notificationCoverage).toBe("suppressed");
          await client.hostedLinqChatHealth.update({ where: { linqChatLookupKey: f.chat }, data: { providerStatus: "healthy" } });
        } else {
          expect(await auth(latest.id)).toMatchObject({ deliveryBlockCode: "automation_engagement_paused" });
        }
      }
      await incrementHostedLinqInboundDailyState({ memberId: f.memberId, occurredAt: new Date(), prisma: client });
      for (const id of ids.slice(0,-1)) expect(await auth(id)).toMatchObject({ deliveryBlockCode: "clinical_authority_unavailable" });
      expect(await auth(ids.at(-1)!)).toMatchObject({ providerDispatchClaimed: true });
      expect(await auth(ids.at(-1)!)).toMatchObject({ providerDispatchClaimed: false });
      expect(await client.hostedLinqDelivery.count({ where: { linqChatLookupKey: f.chat } })).toBe(1);
    } finally { vi.useRealTimers(); await f.cleanup(); }
  });

  it.each([-30_001, 1])("rejects serving evidence with an unsafe timestamp under the admission lock (%i ms)", async offset => {
    const f = await notificationFixture();
    try {
      await client.$transaction(async tx => {
        await lockHostedMemberRow(tx, f.memberId);
        const connection = await tx.clinicalRecordConnection.findUniqueOrThrow({ where: { id: f.connectionId } });
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(openWindow);
        try {
          expect(await notification.freezeClinicalDailyNotification(tx, connection, ["offline_access"],
            { ...currentReaders, observedAt: Date.now() + offset })).toBeNull();
        } finally { vi.useRealTimers(); }
      });
    } finally { await f.cleanup(); }
  });

  it.each(["transport", "staged"] as const)("pins a daily run when the second authenticated read recovers from %s", async failure => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await notificationFixture("notice", { scheduledSweep: true, firstEvidenceFailure: failure });
    try {
      expect((await f.runs())[0]?.notificationRouteKey).toBeTruthy();
      expect(warn).toHaveBeenCalledWith("Clinical daily admission reader evidence", expect.objectContaining({
        reads: 2, [failure === "transport" ? "fetch_failed" : "port_unavailable"]: 1, admittedWithoutEvidence: 0,
      }));
    } finally { warn.mockRestore(); await f.cleanup(); }
  });

  it("expires an accepted occurrence exactly 24 hours later", async () => {
    const f = await notificationFixture();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(openWindow);
      await f.terminal(true);
      const accepted = (await f.runs())[0]!.completedAt!.getTime();
      expect(await readClinicalNotificationDecision(f.pointer, new Date(accepted + daily - 1))).toMatchObject({ mode: "notice" });
      expect(await readClinicalNotificationDecision(f.pointer, new Date(accepted + daily))).toEqual({ mode: "off" });
      expect((await f.runs())[0]).toMatchObject({ notificationCoverage: "suppressed", notificationRetryAt: null });
    } finally { vi.useRealTimers(); await f.cleanup(); }
  });

  it("holds a verified region with no supported window without arming another wake", async () => {
    const f = await notificationFixture("notice", { phone: "+99900000137" });
    try {
      await f.terminal(true);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "off" });
      expect((await f.runs())[0]).toMatchObject({ notificationRetryAt: null, notificationDeferral: "route", notificationCoverage: "published" });
      const count = await f.count();
      await runClinicalDailySyncSweep({ now: openWindow });
      expect(await f.count()).toBe(count);
    } finally { await f.cleanup(); }
  });

  it("waits for renewed verification without a timer", async () => {
    const f = await notificationFixture();
    try {
      await f.terminal(true);
      await client.hostedMemberIdentity.update({ where: { memberId: f.memberId }, data: { phoneNumberVerifiedAt: null } });
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "off" });
      expect((await f.runs())[0]).toMatchObject({ notificationCoverage: "published", notificationDeferral: "route", notificationRetryAt: null });
      await client.hostedMemberIdentity.update({ where: { memberId: f.memberId }, data: { phoneNumberVerifiedAt: openWindow } });
      expect((await f.runs())[0]?.notificationRetryAt).toBeInstanceOf(Date);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "notice", threadId: f.threadId });
    } finally { await f.cleanup(); }
  });

  it("rechecks the setting, epoch, connection and private route for every attempt", async () => {
    const f = await notificationFixture("notice");
    try {
      await f.terminal();
      expect(await f.authority()).not.toBeNull();
      const member = { id: f.memberId };
      await client.hostedMember.update({ where: member, data: { clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 1 } });
      expect(await f.authority()).toBeNull();
      await client.hostedMember.update({ where: member, data: { clinicalRecordMessageMode: "off", clinicalRecordMessageRevision: 2 } });
      await recordClinicalChangeProof(f.pointer);
      await client.hostedMember.update({ where: member, data: { clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 3 } });
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it("rechecks the frozen direct route and credential epoch across service changes", async () => {
    const f = await notificationFixture("notice");
    try {
      await client.hostedLinqChatHealth.update({ where: { linqChatLookupKey: f.chat }, data: { isGroup: true } });
      expect(await f.authority()).toBeNull();
      for (const service of ["SMS", "RCS", "iMessage"]) {
        await client.hostedLinqChatHealth.update({ where: { linqChatLookupKey: f.chat }, data: { isGroup: false, service } });
        expect(await f.authority()).not.toBeNull();
      }
      await client.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: { status: "disconnected", disconnectedAt: now } });
      expect(await f.authority()).toBeNull();
      await client.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: { status: "active", disconnectedAt: null, tokenVersion: 2 } });
      expect(await f.authority()).toBeNull();
    } finally { await f.cleanup(); }
  });

  it("rejects a replacement private thread and a withdrawn ongoing grant after publication", async () => {
    const f = await notificationFixture("notice");
    const nextChat = createHostedLinqChatLookupKey(`replacement-${f.threadId}`)!;
    try {
      await f.terminal(true);
      const existing = await client.hostedLinqChatHealth.findUniqueOrThrow({ where: { linqChatLookupKey: f.chat } });
      await client.hostedLinqChatHealth.create({ data: { linqChatLookupKey: nextChat,
        phoneNumberLookupKey: existing.phoneNumberLookupKey, providerUpdatedAt: now, providerObservedAt: now,
        providerStatus: "healthy", service: "SMS", isGroup: false } });
      await client.hostedMemberRouting.update({ where: { memberId: f.memberId }, data: { linqChatLookupKey: nextChat } });
      expect(await f.authority()).toBeNull();
      await client.hostedMemberRouting.update({ where: { memberId: f.memberId }, data: { linqChatLookupKey: f.chat } });
      expect(await f.authority()).not.toBeNull();
      await client.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: { refreshTokenEncrypted: null } });
      expect(await f.authority()).toBeNull();
    } finally {
      await client.hostedLinqChatHealth.deleteMany({ where: { linqChatLookupKey: nextChat } });
      await f.cleanup();
    }
  });

  it.each([true, false])("keeps a replacement run silent after withdrawal at terminal (receipt=%s)", async receipt => {
    const f = await notificationFixture("notice");
    try {
      const where = { memberId_scope: { memberId: f.memberId, scope: clinicalProcessorScope(clinicalProcessors[0]!) } };
      expect(await f.authority()).not.toBeNull();
      await client.hostedConsentGrant.update({ where, data: { status: "revoked" } });
      await f.terminal(receipt);
      expect(await f.runs()).toMatchObject([{ status: "partial", notificationCoverage: "suppressed" }]);
      await client.hostedConsentGrant.update({ where, data: { status: "granted" } });
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it.each(["granted", "revoked"] as const)("checks a late receipt with processor approval %s", async status => {
    const f = await notificationFixture("notice");
    try {
      await f.terminal();
      expect(await f.count()).toBe(0);
      const where = { memberId_scope: { memberId: f.memberId, scope: clinicalProcessorScope(clinicalProcessors[0]!) } };
      await client.hostedConsentGrant.update({ where, data: { status } });
      await recordClinicalChangeProof(f.pointer);
      await client.hostedConsentGrant.update({ where, data: { status: "granted" } });
      await recordClinicalChangeProof(f.pointer);
      expect(await f.count()).toBe(status === "granted" ? 1 : 0);
    } finally { await f.cleanup(); }
  });

  it.each(["opt-out", "approval"] as const)("rechecks %s after staging and before dispatch", async change => {
    const f = await notificationFixture("notice");
    try {
      await f.terminal(true);
      expect(await f.count()).toBe(1);
      expect(await readClinicalNotificationDecision(f.pointer, openWindow)).toEqual({ mode: "notice", threadId: f.threadId });
      const auth = await nativeAuth(f.memberId);
      if (change === "opt-out") await setClinicalRecordMessageMode(auth, "off");
      else await setClinicalProcessorApproval(auth, clinicalProcessors[0]!, clinicalProcessors[0]!.version, false);
      expect(await client.$transaction(tx => clinicalEgressBlock(tx, {
        now: openWindow, windowPhone: "+12025550137",
        memberId: f.memberId, key: clinicalChangeDeliveryKey(f.pointer.runId),
        route: { conversationThreadId: f.threadId, target: f.threadId, targetKind: "thread", threadIsDirect: true,
          fromPhoneNumber: null, directRecipientPhoneNumber: "+12025550137" },
      }))).toBe("clinical_authority_unavailable");
    } finally { await f.cleanup(); }
  });

  it("gates a replacement daily run and its transport on current OpenAI approval", async () => {
    const f = await fixture();
    const pointer = { connectionId: f.connectionId, memberId: f.memberId, now };
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "device", prisma: client, reason: "synthetic-test", userId: f.memberId });
    const secret = { connectionId: f.connectionId, memberId: f.memberId, tokenVersion: 1, prisma: client };
    const patientIdEncrypted = await sealClinicalConnectionSecret({ ...secret, field: "patientId", value: "synthetic-patient" });
    const accessTokenEncrypted = await sealClinicalConnectionSecret({ ...secret, field: "accessToken", value: "synthetic-token" });
    const fhirBaseUrlEncrypted = await sealClinicalConnectionFhirBaseUrl({ ...secret, value: "https://hospital.example.test/fhir" });
    await client.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: {
      requiresProcessorApprovals: true, requestedScopesJson: ["patient/DocumentReference.s"],
      sourceSystem: "epic-fhir", patientIdEncrypted, accessTokenEncrypted, fhirBaseUrlEncrypted,
      accessTokenExpiresAt: new Date(Date.now() + daily),
    } });
    const processor = clinicalProcessors[0]!;
    expect(processor.id).toBe("openai");
    const where = { memberId_scope: { memberId: f.memberId, scope: clinicalProcessorScope(processor) } };
    expect(await admitClinicalDailySync(pointer)).toBe(false);
    await client.hostedConsentGrant.create({ data: { ...where.memberId_scope, status: "granted",
      grantedAt: now, source: "synthetic", documentVersionsJson: { openai: "obsolete" } } });
    expect(await admitClinicalDailySync(pointer)).toBe(false);
    expect(await f.mailbox()).toBe(0);
    await client.hostedConsentGrant.update({ where, data: { documentVersionsJson: { [processor.id]: processor.version } } });
    expect(await admitClinicalDailySync(pointer)).toBe(true);
    expect(await f.mailbox()).toBe(1);
    const [run] = await f.runs();
    const read = () => readClinicalRetrievalRun({ memberId: f.memberId, runId: run!.id, generation: run!.generation });
    const result = await read();
    if (result.status !== "ready") throw new Error(result.errorCode);
    const slice = result.run.retrievalSlices.find(slice => slice.resourceType === "DocumentReference")!;
    const fetchImpl = vi.fn(async () => Response.json({ resourceType: "Bundle", entry: [] }, {
      headers: { "content-type": "application/fhir+json" },
    }));
    const fetchPage = () => fetchClinicalRetrievalPage({ fetchImpl, memberId: f.memberId, request: {
      runId: result.run.runId, generation: result.run.generation, retrievalProtocol: "query-slices-v2",
      requestId: "synthetic-page", resourceType: slice.resourceType, cursor: null,
      queryScopeId: slice.queryScopeId, queryFingerprint: slice.queryFingerprint, sliceId: slice.sliceId,
    } });
    expect((await fetchPage()).status).toBe("page");
    await client.hostedConsentGrant.update({ where, data: { status: "revoked" } });
    expect(await read()).toMatchObject({ status: "unavailable", errorCode: "processor-admission-blocked" });
    expect(await fetchPage()).toMatchObject({ status: "unavailable", errorCode: "run-already-terminal" });
    expect(await f.runs()).toMatchObject([{ status: "failed", completedAt: expect.any(Date), lastErrorCode: "processor-admission-blocked" }]);
    const paused = await f.row();
    expect(paused.refreshTokenEncrypted).toBe("synthetic-refresh");
    await client.hostedConsentGrant.update({ where, data: { status: "granted" } });
    expect(await admitClinicalDailySync({ ...pointer, now: paused.nextSyncAt! })).toBe(true);
    // A dropped wake can leave a queued run for the daily sweep to settle.
    await client.hostedConsentGrant.update({ where, data: { status: "revoked" } });
    expect(await admitClinicalDailySync({ ...pointer, now: (await f.row()).nextSyncAt! })).toBe(false);
    expect(await f.runs()).toHaveLength(2);
    expect((await f.runs()).every(run => run.status === "failed" && run.lastErrorCode === "processor-admission-blocked")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("commits the current run failure before returning a permanent outcome rejection", async () => {
    const f = await fixture();
    expect(await admitClinicalDailySync({ connectionId: f.connectionId, memberId: f.memberId, now })).toBe(true);
    const [run] = await f.runs();
    const pointer = { runId: run!.id, generation: 2, memberId: f.memberId };
    await expect(recordClinicalRetrievalOutcome({ memberId: f.memberId, request: {
      runId: pointer.runId, generation: pointer.generation, status: "completed", retrievalProtocol: "query-slices-v2",
      retrievalSlices: [{ queryScopeId: "other-slice", sliceId: "whole" }],
      counts: { createdCount: 0, executableDecisionCount: 0, fetchedPageCount: 0, fetchedResourceFamilyCount: 0,
        rawFileCount: 0, retractedCount: 0, reviewDecisionCount: 0, skippedExistingCount: 0, supersededCount: 0 },
    } })).rejects.toMatchObject({ code: "CLINICAL_RECORD_OUTCOME_CONFLICT" });
    expect(await f.runs()).toMatchObject([{ status: "failed", completedAt: expect.any(Date), lastErrorCode: "outcome-conflict", outcomeCountsJson: null }]);
    expect(await f.row()).toMatchObject({ retrievalGeneration: 2, status: "error" });
    expect(await readClinicalRetrievalRun(pointer)).toEqual({ status: "unavailable", retryable: false, errorCode: "run-already-terminal" });
  });

  it.each([true, false])("admits a due open run only after a day without request activity (released recently=%s)", async recent => {
    const f = await fixture();
    const previous = await client.clinicalRecordRetrievalRun.update({
      where: { connectionId_generation: { connectionId: f.connectionId, generation: 1 } },
      data: { status: "retrieving", completedAt: null, createdAt: new Date(+now - daily) },
    });
    if (recent) await client.clinicalRecordRetrievalRequest.create({ data: {
      id: `crq-${randomUUID()}`, memberId: f.memberId, connectionId: f.connectionId, generation: 1, runId: previous.id,
      claimedAt: new Date(0), requestFingerprint: "released", updatedAt: new Date(+now - 1),
    } });
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: recent ? 0 : 1, failed: 0 });
    expect(await f.mailbox()).toBe(recent ? 0 : 1);
    const old = await client.clinicalRecordRetrievalRun.findUniqueOrThrow({ where: { id: previous.id } });
    if (recent) expect(old).toEqual(previous);
    else expect(old).toMatchObject({ completedAt: now, status: "canceled", lastErrorCode: "superseded" });
    expect(await f.runs()).toHaveLength(recent ? 0 : 1);
  });

  it.each([true, false])("retires obsolete daily queries once (surviving query=%s)", async survives => {
    const f = await fixture();
    const original = buildEpicBetaRetrievalPlan({ frozenAt: now, pageCount: "100", resourceTypes: ["Patient", "DocumentReference"] });
    const slices = original.slices.map((slice, i) => survives && i === 0 ? slice : { ...slice, queryScopeId: `retired-${i}` });
    await client.clinicalRecordRetrievalRun.updateMany({ where: { connectionId: f.connectionId }, data: {
      retrievalPlanJson: { ...original, slices },
    } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: survives ? 1 : 0, failed: 0 });
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), { skipped: slices.length - Number(survives) });
    if (survives) expect((await f.runs())[0]?.retrievalPlanJson).toMatchObject({ slices: [original.slices[0]] });
    else {
      expect(await f.row()).toMatchObject({ status: "needs_reauth", nextSyncAt: null, refreshTokenEncrypted: null });
      expect(await f.mailbox()).toBe(0);
      expect(await runClinicalDailySyncSweep({ now: new Date(+now + daily) })).toEqual({ checked: 0, queued: 0, failed: 0 });
    }
  });

  it.each(["canceled", "paused", "unpaid", "past_due"] as const)("admits %s clinical acquisition with consent", async (billingStatus) => {
    const f = await fixture();
    await client.hostedMember.update({ where: { id: f.memberId }, data: { billingStatus } });
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 1, failed: 0 });
    expect(await f.runs()).toHaveLength(1);
    expect(await f.mailbox()).toBe(1);
    expect(f.signal).toHaveBeenCalledTimes(1);
    expect(await client.hostedAiUsage.count({ where: { memberId: f.memberId } })).toBe(0);
  });

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
    expect(await runClinicalDailySyncSweep({ now, deadlineMs: Date.now() - 1 })).toEqual({ checked: 0, queued: 0, failed: 0 });
    expect((await f.row()).nextSyncAt).toEqual(now);
    expect(await f.runs()).toHaveLength(0);
    expect(await f.mailbox()).toBe(0);
    expect(f.decrypt).not.toHaveBeenCalled();
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 1, failed: 0 });
  });
});

const LOCAL_CRYPTO_ENV_KEYS = [
  "HOSTED_CONTACT_PRIVACY_KEYS", "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
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
    HOSTED_CONTACT_PRIVACY_KEYS: `v1:${Buffer.alloc(32, 7).toString("base64")}`,
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
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
