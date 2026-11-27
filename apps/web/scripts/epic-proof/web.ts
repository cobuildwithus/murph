import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { serializeHostedNativeSessionToken } from "../../src/lib/better-auth/transport";
import { requireHostedMemberAuthFromBearerToken } from "../../src/lib/hosted-onboarding/request-auth";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "../../src/lib/hosted-crypto/domain-root-store";
import { recordHostedLaunchRequiredConsent } from "../../src/lib/legal/consent";
import { getPrisma } from "../../src/lib/prisma";
import { clinicalProcessors } from "../../src/lib/clinical-records/processor-registry";
import { setClinicalProcessorApproval } from "../../src/lib/clinical-records/processor-approvals";
import { readCompanionSources } from "../../src/lib/clinical-records/companion-sources";
import { disconnectClinicalSource } from "../../src/lib/clinical-records/connections";
import { readClinicalResponseBytes } from "../../src/lib/clinical-records/response-bytes";
import { renewClinicalAccess } from "../../src/lib/clinical-records/persistent-access";
import { openClinicalConnectionSecret } from "../../src/lib/clinical-records/secrets";
import { admitClinicalDailySync } from "../../src/lib/clinical-records/daily-sync";
import { resolveClinicalProviderDirectoryEntry } from "../../src/lib/clinical-records/provider-directory-store";
import { resolveEpicClient } from "../../src/lib/clinical-records/epic-import-config";
import { issueHostedAppSession } from "../../test/support/hosted-auth-session";
import { importGeneration } from "./generation";
import { login, SandboxFailure } from "./browser";
import { boundedEpicTransport } from "./transport";
import { base, check, origin, patients, requireClient, requirePatient, withinBands } from "./policy";

const memberId = process.env.PROOF_MEMBER!;
const dir = process.env.PROOF_DIR!;
const patient = process.env.PROOF_PATIENT!;
const keys = join(homedir(), ".config/murph/epic");
const stage = (stage: string) => process.send?.({ stage });
let vendorDown = false;

async function configure(initial: boolean) {
  const id = process.env.EPIC_SMART_NON_PRODUCTION_CLIENT_ID;
  requireClient(id);
  check(patients.includes(patient) && /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/murph_test_epic_[a-f0-9]{32}$/u.test(process.env.DATABASE_URL ?? ""));
  check(process.env.HOSTED_CRYPTO_ENV === "test" && process.env.HOSTED_CRYPTO_GCP_KMS_API_ROOT === "local://murph-hosted-kms");
  const testKey = Buffer.alloc(32, 13).toString("base64url");
  Object.assign(process.env, { HOSTED_ONBOARDING_PUBLIC_BASE_URL: origin,
    HOSTED_BETTER_AUTH_SECRET: testKey, HOSTED_AUTH_STORAGE_KEY: testKey, HOSTED_APP_SESSION_HMAC_KEY: testKey,
    HOSTED_CONTACT_PRIVACY_KEYS: "v1:" + testKey, HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
    HOSTED_MAILBOX_FINGERPRINT_KEY: testKey, HOSTED_DEVICE_ROUTING_INDEX_KEY: testKey,
    EPIC_SMART_NON_PRODUCTION_ASYMMETRIC_CLIENT_ID: id, EPIC_SMART_NON_PRODUCTION_PUBLIC_CLIENT_ID: "unused-public-registration",
    EPIC_SMART_NON_PRODUCTION_PRIVATE_KEY_PEM: process.env.EPIC_PROOF_SANDBOX_PEM || await readFile(join(keys, "sandbox-private.pem"), "utf8"),
    CLINICAL_RECORDS_WRITE_GRANT_PROFILES: "1" });
  const entry = resolveClinicalProviderDirectoryEntry("epic-sandbox");
  check(entry?.sourceSystem === "epic-fhir" && entry.id === "epic-sandbox" && entry.fhirBaseUrl === base && entry.clientIdEnvironmentKey === "EPIC_SMART_NON_PRODUCTION_CLIENT_ID");
  const registration = resolveEpicClient(entry);
  check(registration.profile.environment === "sandbox" && registration.auth.method === "private_key_jwt" && registration.auth.clientId === id);
  globalThis.fetch = boundedEpicTransport({ transport: globalThis.fetch, patient, budget: initial ? 100 : 140,
    deadline: Number(process.env.PROOF_DEADLINE), unavailable: () => { vendorDown = true; } });
}

async function setup(initial: boolean) {
  const prisma = getPrisma();
  if (initial) {
    await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    for (const domain of ["ingress", "device", "control"] as const)
      await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain, userId: memberId, reason: "sandbox-proof", prisma });
    for (const scope of ["launch.legal", "launch.health-data"] as const) await recordHostedLaunchRequiredConsent({ memberId, scope, prisma });
  }
  const session = await issueHostedAppSession({ memberId });
  const auth = await requireHostedMemberAuthFromBearerToken(new Request(origin, {
    headers: { authorization: "Bearer " + serializeHostedNativeSessionToken(session.token) } }));
  if (initial) for (const processor of clinicalProcessors) await setClinicalProcessorApproval(auth, processor, processor.version, true);
  return { auth, cookie: session.cookie };
}

const connection = () => getPrisma().clinicalRecordConnection.findFirstOrThrow({ where: { memberId } });

async function refreshPersistedGrant() {
  stage("refresh");
  const before = await connection();
  const pointer = { memberId, connectionId: before.id, generation: before.retrievalGeneration };
  const grant = async () => {
    const row = await connection();
    const saved = await openClinicalConnectionSecret({ ...pointer, tokenVersion: row.tokenVersion, field: "refreshToken", encrypted: row.refreshTokenEncrypted });
    check(saved);
    return JSON.parse(saved).refreshToken;
  };
  const previous = await grant();
  check(previous && before.accessTokenExpiresAt);
  const access = await renewClinicalAccess({ ...pointer, now: before.accessTokenExpiresAt });
  check(await grant() !== previous);
  const chart = await openClinicalConnectionSecret({ ...pointer, tokenVersion: before.tokenVersion, field: "patientId", encrypted: before.patientIdEncrypted });
  requirePatient(patient, chart);
  const read = await fetch(base + "/Patient/" + encodeURIComponent(chart!), { headers: { accept: "application/fhir+json", authorization: "Bearer " + access } });
  check(read.ok);
  requirePatient(patient, JSON.parse(new TextDecoder().decode(await readClinicalResponseBytes(read, 512_000))).id);
  return before;
}

// Epic omits meta.lastUpdated, so each retrieval is the resource revision and a re-read supersedes in place.
function checkUnchangedReceipt(counts: Awaited<ReturnType<typeof importGeneration>>["saved"]["outcomeCountsJson"]) {
  check(counts && typeof counts === "object" && !Array.isArray(counts));
  check(counts.createdCount === 0 && counts.retractedCount === 0);
}

// The sandbox registration lacks some sub-resources, which Epic reports as suppressed search results.
type Source = Awaited<ReturnType<typeof readCompanionSources>>["sources"][number] | undefined;
const imported = (source: Source) => source?.state === "ready" || (source?.state === "ready_partial" && source.reason === "limited_by_hospital");

async function scenario(initial: boolean) {
  await configure(initial);
  stage("session");
  const { auth, cookie } = await setup(initial);
  const projection = async () => (await readCompanionSources(auth)).sources[0];
  const connect = async () => login(cookie, patient, await readFile(join(keys, "loopback-cert.pem")), await readFile(join(keys, "loopback-key.pem")), stage);
  if (initial) {
    await connect();
    check((await projection())?.updates === "daily");
    stage("import");
    const { counts } = await importGeneration(memberId, dir, 1, !process.env.PROOF_NO_CAPTURE);
    process.send?.({ counts });
    check(imported(await projection()));
    return;
  }
  const before = await refreshPersistedGrant();
  // The member-facing import_again action reauthorizes the same source and enqueues a full generation.
  await connect();
  check((await connection()).id === before.id);
  for (const generation of [2, 3]) {
    stage(generation === 2 ? "repeat" : "daily");
    const row = await connection();
    if (generation === 3) check(row.nextSyncAt && await admitClinicalDailySync({ memberId, connectionId: row.id, now: row.nextSyncAt }));
    const { saved, vault } = await importGeneration(memberId, dir, generation);
    checkUnchangedReceipt(saved.outcomeCountsJson);
    const source = await projection();
    check((imported(source) || source?.state === "nothing_new") && source?.lastImport?.addedCount === 0);
    // A reread that writes nothing new must leave the cumulative chart inside the measured bands.
    if (!withinBands(patient, vault)) throw new SandboxFailure("expectation-drift");
  }
  stage("disconnect");
  const binding = (await connection()).patientBindingEncrypted;
  await disconnectClinicalSource(auth, { connectionId: before.id });
  const after = await connection();
  check(binding && after.patientBindingEncrypted === binding && !after.refreshTokenEncrypted && !after.accessTokenEncrypted && (await projection())?.state === "disconnected");
}

process.once("message", async (message: { phase: string }) => {
  let outcome = "pass";
  try { await scenario(message.phase === "initial"); if (vendorDown) outcome = "vendor-unavailable"; }
  catch (error) { outcome = vendorDown ? "vendor-unavailable" : error instanceof SandboxFailure ? error.outcome : "app-failure"; }
  finally {
    await getPrisma().$disconnect();
    process.send?.({ outcome }, () => process.exit(Number(outcome !== "pass")));
  }
});
