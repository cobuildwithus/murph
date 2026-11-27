import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { findEventByExternalRef, initializeVault } from "@murphai/core";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as db from "@/src/lib/prisma";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "@/src/lib/hosted-crypto/domain-root-store";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";
import { clinicalProcessors } from "@/src/lib/clinical-records/processor-registry";
import { setClinicalProcessorApproval } from "@/src/lib/clinical-records/processor-approvals";
import { readCompanionSources } from "@/src/lib/clinical-records/companion-sources";
import { renewClinicalAccess } from "@/src/lib/clinical-records/persistent-access";
import { admitClinicalDailySync } from "@/src/lib/clinical-records/daily-sync";
import {
  buildClinicalRetrievalWakeEventId, fetchClinicalRetrievalPage, readClinicalRetrievalRun,
  recordClinicalChangeProof, recordClinicalRetrievalOutcome,
} from "@/src/lib/clinical-records/retrieval";
import { readHostedMailboxItemByDedupeKey, readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
import { claimHostedRuntime } from "@/src/lib/hosted-execution/runtime-owner";
import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";
import { ensureHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import * as signal from "@/src/lib/hosted-orchestration/signal-runtime";
import { POST as start } from "../app/api/clinical-records/companion/start/route";
import { GET as callback } from "../app/api/clinical-records/oauth/callback/route";
import { POST as complete } from "../app/api/clinical-records/companion/complete/route";
import { POST as remove } from "../app/api/clinical-records/companion/sources/[id]/remove/route";
import { checkpointClinicalMailboxItem, createHostedRuntimeWorkspace } from "../../../packages/assistant-runtime/test/clinical-connector-runtime";
import { createClinicalVendorSimulator, epicWireProfile } from "./support/clinical-vendor-simulator";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { localRosterCrypto } from "./support/roster-postgres";
import { sandboxPublicKey, signerPem } from "./clinical-records-synthetic-signer";

vi.mock("../public/.well-known/epic/sandbox.jwks.json", async () => ({
  default: { keys: [(await import("./clinical-records-synthetic-signer")).sandboxPublicKey] },
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Use a local PostgreSQL proof database.");
  }
}
const origin = "https://app.example.test";
const cleanups: (() => Promise<unknown>)[] = [];
afterAll(async () => { if (enabled) await db.getPrisma().$disconnect(); });
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

function lab(id: string, value: number, updated: Date, status = "final", patient = epicWireProfile.patient) {
  return { resourceType: "Observation", id, status, subject: { reference: `Patient/${patient}` },
    meta: { lastUpdated: updated.toISOString() }, effectiveDateTime: "2026-01-05T12:00:00Z",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c" }] },
    valueQuantity: { value, unit: "%", code: "%", system: "http://unitsofmeasure.org" } };
}

async function connect() {
  localRosterCrypto();
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", origin);
  vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 31).toString("base64url"));
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 32).toString("base64url"));
  vi.stubEnv("EPIC_SMART_NON_PRODUCTION_CLIENT_ID", epicWireProfile.clientId);
  vi.stubEnv("EPIC_SMART_NON_PRODUCTION_ASYMMETRIC_CLIENT_ID", epicWireProfile.clientId);
  vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PUBLIC_CLIENT_ID", "fixture-public");
  vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PRIVATE_KEY_PEM", signerPem);
  vi.stubEnv("CLINICAL_RECORDS_WRITE_GRANT_PROFILES", "1");

  const prisma = db.getPrisma();
  const memberId = randomUUID();
  await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  cleanups.push(() => prisma.hostedMember.delete({ where: { id: memberId } }));
  for (const domain of ["ingress", "device", "control"] as const) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain, userId: memberId, reason: "synthetic-test", prisma });
  }
  for (const scope of ["launch.legal", "launch.health-data"] as const) await recordHostedLaunchRequiredConsent({ memberId, scope, prisma });
  const session = await issueHostedAppSession({ memberId });
  const bearer = serializeHostedNativeSessionToken(session.token);
  const post = (path: string, body: unknown) => new Request(origin + path, { method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const auth = await requireHostedMemberAuthFromBearerToken(post("/", {}));
  for (const processor of clinicalProcessors) await setClinicalProcessorApproval(auth, processor, processor.version, true);
  vi.spyOn(signal, "signalHostedMailboxAppendRuntime").mockResolvedValue({ signalAccepted: true, workflowId: "fixture" });
  const vendor = createClinicalVendorSimulator(epicWireProfile, sandboxPublicKey);
  vi.stubGlobal("fetch", vendor.fetchImpl);
  const started = await start(post("/api/clinical-records/companion/start", { providerId: "epic-sandbox", appReturn: "ios" }));
  expect(started.status).toBe(200);
  const { authorizationUrl, completionProof } = await started.json();
  const issued = await vendor.fetchImpl(authorizationUrl);
  expect(issued.status).toBe(302);
  const returned = await callback(new Request(issued.headers.get("location")!));
  expect(returned.status).toBe(303);
  const query = new URL(returned.headers.get("location")!).search.slice(1);
  const completed = await complete(post("/api/clinical-records/companion/complete", { query, completionProof }));
  expect(completed.status).toBe(200);
  expect(await completed.json()).toMatchObject({ outcome: "connected", sources: [{ state: "getting_records", updates: "daily" }] });
  const connection = () => prisma.clinicalRecordConnection.findFirstOrThrow({ where: { memberId } });
  const { id: connectionId } = await connection();
  const projection = async () => (await readCompanionSources(auth)).sources[0];
  const disconnect = async () => {
    const response = await remove(post(`/api/clinical-records/companion/sources/${connectionId}/remove`, {}), { params: Promise.resolve({ id: connectionId }) });
    expect(response.status).toBe(200);
  };
  const nearExpiry = () => prisma.clinicalRecordConnection.update({ where: { id: connectionId },
    data: { accessTokenExpiresAt: new Date(Date.now() + 10_000) } });
  const renew = () => renewClinicalAccess({ connectionId, memberId, generation: 1, fetchImpl: vendor.fetchImpl });
  return { memberId, prisma, vendor, connectionId, projection, connection, disconnect, nearExpiry, renew };
}

type Connected = Awaited<ReturnType<typeof connect>>;
async function importGeneration(f: Connected, workspace: Awaited<ReturnType<typeof createHostedRuntimeWorkspace>>) {
  const { memberId, prisma } = f;
  const run = await prisma.clinicalRecordRetrievalRun.findFirstOrThrow({ where: { memberId }, orderBy: { generation: "desc" } });
  const lookup = { dedupeKey: buildClinicalRetrievalWakeEventId({ runId: run.id, generation: run.generation }), userId: memberId };
  const wake = await readHostedMailboxWakeByDedupeKey(lookup);
  const item = await readHostedMailboxItemByDedupeKey(lookup);
  if (!item || wake?.kind !== "clinical-records.sync-requested") throw new Error("Missing committed clinical wake.");
  const current = await ensureHostedWorkspace({ userId: memberId });
  const lease = await claimHostedRuntime({ prisma, userId: memberId, processingMode: "default" });
  if (lease.status === "blocked" || !lease.owner.attemptId) throw new Error("Expected a runtime lease.");
  const runtimeAuthority = { attemptId: lease.owner.attemptId, generation: String(lease.owner.generation), workspaceVersion: String(current.version) };
  await checkpointClinicalMailboxItem({ ...workspace, item, wake, port: {
    readRun: request => readClinicalRetrievalRun({ memberId, ...request }),
    fetchPage: request => fetchClinicalRetrievalPage({ memberId, request, fetchImpl: f.vendor.fetchImpl }),
    recordOutcome: async request => {
      if ("kind" in request) await recordClinicalChangeProof({ memberId, ...request });
      else await recordClinicalRetrievalOutcome({ memberId, request });
    },
  }, publish: async snapshotRef => {
    const before = await prisma.clinicalRecordRetrievalRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(before.completedAt).toBeNull();
    const published = await checkpointHostedRuntimeWorkspace({ userId: memberId, runtimeAuthority,
      expectedVersion: current.version, reason: "system_mailbox_receipt", snapshotRef });
    expect(published.status).toBe("updated");
  } });
  return prisma.clinicalRecordRetrievalRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function vault() {
  const workspace = await createHostedRuntimeWorkspace("clinical-connector-");
  cleanups.push(workspace.cleanup);
  await initializeVault({ vaultRoot: workspace.vaultRoot, timezone: "UTC" });
  return workspace;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fact = (vaultRoot: string, resourceId: string) => findEventByExternalRef({ vaultRoot,
  system: `epic-fhir-${digest(epicWireProfile.base)}-${digest(epicWireProfile.patient)}`, resourceType: "observation", resourceId });
const refreshes = (f: Connected) => f.vendor.requests.filter(request => request.operation === "refresh_token").length;

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!enabled)("Epic vendor lifecycle on PostgreSQL", () => {
  it("publishes full, identical and corrected generations before removing local access", async () => {
    const f = await connect();
    const workspace = await vault();
    const now = new Date();
    f.vendor.setSearchResults("Observation", "laboratory", [lab("first", 5, now), lab("second", 6, now)]);
    const initial = await importGeneration(f, workspace);
    expect(initial.outcomeCountsJson).toMatchObject({ createdCount: 2, labResultCount: 2 });
    expect(await f.projection()).toMatchObject({ state: "ready", updates: "daily" });
    const first = await fact(workspace.vaultRoot, "first");
    expect(first).toMatchObject({ results: [{ value: 5 }] });
    const nextDay = (await f.connection()).nextSyncAt!;
    const admit = async (at: Date) => expect(await admitClinicalDailySync({
      memberId: f.memberId, connectionId: f.connectionId, now: at,
    })).toBe(true);
    await admit(nextDay);
    await f.nearExpiry();
    const repeat = await importGeneration(f, workspace);
    expect(refreshes(f)).toBe(1);
    expect(repeat.outcomeCountsJson).toMatchObject({ createdCount: 0, supersededCount: 0, retractedCount: 0 });
    expect(await fact(workspace.vaultRoot, "first")).toEqual(first);
    expect(await f.projection()).toMatchObject({ state: "nothing_new" });
    const encounterWindow = (from: number) => f.vendor.requests.slice(from)
      .find(({ url }) => url.pathname.endsWith("/Encounter") && url.searchParams.has("date"))?.url.searchParams.getAll("date");
    const previousWindow = encounterWindow(0);
    expect(previousWindow).toHaveLength(2);
    const changed = new Date(now.getTime() + 1000);
    f.vendor.setSearchResults("Observation", "laboratory", [lab("first", 7, changed, "corrected"), lab("second", 6, changed, "entered-in-error")]);
    await admit(new Date(nextDay.getTime() + 86_400_000));
    const startAt = f.vendor.requests.length;
    const daily = await importGeneration(f, workspace);
    expect(daily.outcomeCountsJson).toMatchObject({ supersededCount: 1, retractedCount: 1 });
    const nextWindow = encounterWindow(startAt);
    expect(nextWindow).toHaveLength(2);
    const [previousFrom, previousTo] = previousWindow!.map(date => Date.parse(date.slice(2)));
    const [nextFrom] = nextWindow!.map(date => Date.parse(date.slice(2)));
    expect(nextFrom).toBeGreaterThan(previousFrom!);
    expect(nextFrom).toBeLessThan(previousTo!);
    const corrected = await fact(workspace.vaultRoot, "first");
    expect(corrected).toMatchObject({ results: [{ value: 7 }] });
    expect(await fact(workspace.vaultRoot, "second")).toBeNull();
    const wireCount = f.vendor.requests.length;
    const before = await f.connection();
    await f.disconnect();
    expect(await f.projection()).toMatchObject({ state: "disconnected", updates: "one_time" });
    expect(await f.connection()).toMatchObject({ patientBindingEncrypted: before.patientBindingEncrypted,
      accessTokenEncrypted: null, refreshTokenEncrypted: null, nextSyncAt: null });
    expect(await fact(workspace.vaultRoot, "first")).toEqual(corrected);
    expect(f.vendor.requests).toHaveLength(wireCount);
  }, 180_000);

  it.each(["contender", "disconnect"] as const)("fences a concurrent %s after the vendor consumes the grant", async race => {
    const f = await connect();
    await f.nearExpiry();
    const entered = barrier();
    const release = barrier();
    f.vendor.onNext("refresh_token", async response => { entered.resolve(); await release.promise; return response; });
    const first = f.renew();
    await Promise.race([entered.promise, first.then(() => { throw new Error("Refresh missed the vendor barrier."); })]);
    try {
      if (race === "contender") {
        const contender = db.createPrismaClient({ databaseUrl: process.env.DATABASE_URL!, poolMax: 1 });
        try {
          vi.spyOn(db, "getPrisma").mockReturnValueOnce(contender);
          await expect(f.renew()).rejects.toMatchObject({ code: "CLINICAL_RECORD_REFRESH_IN_PROGRESS" });
        } finally { await contender.$disconnect(); }
      } else await f.disconnect();
    } finally { release.resolve(); await first.catch(() => undefined); }
    if (race === "disconnect") {
      await expect(first).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
      expect(await f.connection()).toMatchObject({ refreshTokenEncrypted: null, accessTokenEncrypted: null });
      expect(await f.projection()).toMatchObject({ state: "disconnected" });
    } else expect(await f.renew()).toBe(await first);
    expect(refreshes(f)).toBe(1);
  });

  it("never replays a consumed token after PostgreSQL rejects the successor", async () => {
    const f = await connect();
    await f.nearExpiry();
    // The lease acquisition still succeeds. PostgreSQL rejects the acceptance write after exchange.
    const constraint = "clinical_fixture_" + f.memberId.replaceAll("-", "");
    await f.prisma.$executeRawUnsafe(`ALTER TABLE clinical_record_connection ADD CONSTRAINT ${constraint}
        CHECK (member_id <> '${f.memberId}' OR persistent_token_encrypted IS NULL OR refresh_lease_id IS NOT NULL) NOT VALID`);
    cleanups.push(() => f.prisma.$executeRawUnsafe(`ALTER TABLE clinical_record_connection DROP CONSTRAINT ${constraint}`));
    await expect(f.renew()).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
    const row = await f.connection();
    expect(row.refreshLeaseId).toBeTruthy();
    await f.prisma.clinicalRecordConnection.update({ where: { id: f.connectionId }, data: { refreshLeaseExpiresAt: new Date(0) } });
    const initial = await f.prisma.clinicalRecordRetrievalRun.findFirstOrThrow({ where: { connectionId: f.connectionId } });
    const pointer = { memberId: f.memberId, runId: initial.id, generation: initial.generation };
    const loaded = await readClinicalRetrievalRun(pointer);
    if (loaded.status !== "ready") throw new Error("Expected the initial run.");
    const slice = loaded.run.retrievalSlices[0]!;
    const result = await fetchClinicalRetrievalPage({ memberId: f.memberId, fetchImpl: f.vendor.fetchImpl, request: {
      runId: initial.id, generation: initial.generation, retrievalProtocol: loaded.run.retrievalProtocol,
      resourceType: slice.resourceType, queryScopeId: slice.queryScopeId, sliceId: slice.sliceId, queryFingerprint: slice.queryFingerprint,
      cursor: null, requestId: "fixture-expired-lease",
    } });
    expect(result).toMatchObject({ status: "unavailable", errorCode: "authorization-required", retryable: false });
    expect(await f.projection()).toMatchObject({ state: "sign_in_again", updates: "one_time" });
    expect(await f.connection()).toMatchObject({ refreshTokenEncrypted: null, accessTokenEncrypted: null });
    expect(refreshes(f)).toBe(1);
  });

  it("keeps a foreign patient observation out of both raw evidence and active facts", async () => {
    const f = await connect();
    const workspace = await vault();
    f.vendor.setSearchResults("Observation", "laboratory", [lab("foreign-lab", 9, new Date(), "final", "foreign-chart")]);
    const run = await importGeneration(f, workspace);
    expect(run.lastErrorCode).toBe("snapshot_rejected");
    expect(await f.projection()).toMatchObject({ state: "could_not_add" });
    expect(await fact(workspace.vaultRoot, "foreign-lab")).toBeNull();
    const raw = join(workspace.vaultRoot, "raw", "clinical");
    for (const entry of await readdir(raw, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) expect(await readFile(join(entry.parentPath, entry.name), "utf8")).not.toContain("foreign-lab");
    }
  });
});
