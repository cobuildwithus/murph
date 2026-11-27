import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "@/src/lib/hosted-crypto/domain-root-store";
import * as signal from "@/src/lib/hosted-orchestration/signal-runtime";
import * as cryptoEnv from "@/src/lib/hosted-crypto/env";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";
import { EPIC_ACQUISITION_POLICY, EPIC_ACQUISITION_POLICY_ID } from "@/src/lib/clinical-records/epic-policy";
import { parseClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory";
import * as directory from "@/src/lib/clinical-records/provider-directory-store";
import { createClinicalRecordConnectIntent } from "@/src/lib/clinical-records/connect-intents";
import { disconnectClinicalRecordConnection, disconnectClinicalSource } from "@/src/lib/clinical-records/connections";
import { openClinicalConnectionFhirBaseUrl, sealClinicalConnectionFhirBaseUrl } from "@/src/lib/clinical-records/secrets";
import {
  completeNativeAuthorization, finishClinicalRecordAuthorization, startClinicalRecordConnection, startNativeAuthorization,
} from "@/src/lib/clinical-records/control-plane";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { localRosterCrypto } from "./support/roster-postgres";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Use a local PostgreSQL proof database.");
  }
}

const ORIGIN = "https://app.example.test";
const ENTRY_ID = "epic-synthetic-valley";
const OLD_BASE = "https://portal-one.example.test/FHIR/R4";
const NEW_BASE = "https://portal-two.example.test/FHIR/R4";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// The published directory before and after an upstream endpoint move for one entry.
function artifact(version: string, fhirBaseUrl: string) {
  return parseClinicalProviderDirectory({
    schema: "murph.clinical-provider-directory.v2", version, generatedAt: "2026-11-01T00:00:00.000Z",
    sourceBundleSha256: hash(version), policies: [EPIC_ACQUISITION_POLICY],
    entries: [{ id: ENTRY_ID, brandName: "Synthetic Valley Health", aliases: [], clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID",
      fhirBaseUrl, policyId: EPIC_ACQUISITION_POLICY_ID, locations: [] }],
  });
}
const baseArtifact = artifact("synthetic-base", OLD_BASE);
const headArtifact = artifact("synthetic-head", NEW_BASE);

// Each synthetic portal serves SMART discovery and a public-client token exchange on its own origin.
function syntheticPortals() {
  const egress: string[] = [];
  let patient = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    egress.push(url.origin);
    if (request.method === "GET" && url.pathname === "/FHIR/R4/.well-known/smart-configuration") {
      return Response.json({ authorization_endpoint: `${url.origin}/oauth2/authorize`, token_endpoint: `${url.origin}/oauth2/token`,
        code_challenge_methods_supported: ["S256"], capabilities: ["context-standalone-patient", "permission-v2"] });
    }
    if (request.method === "POST" && url.pathname === "/oauth2/token") {
      return Response.json({ access_token: randomUUID(), token_type: "Bearer", expires_in: 3600, patient });
    }
    throw new Error("Request outside the synthetic portals.");
  };
  return { egress, fetchImpl, signIn(next: string) { patient = next; } };
}

type Path = "browser" | "native";

describe.skipIf(!enabled)("Clinical Records reconnect keeps the pinned FHIR base on PostgreSQL", () => {
  const prisma = getPrisma();
  const members: string[] = [];
  let published = baseArtifact;
  let portals = syntheticPortals();
  let kmsUnwraps = () => 0;

  beforeEach(() => {
    localRosterCrypto();
    const crypto = cryptoEnv.getHostedWebCryptoConfig();
    vi.spyOn(cryptoEnv, "getHostedWebCryptoConfig").mockReturnValue(crypto);
    const decrypt = vi.spyOn(crypto.gcpKms, "decrypt");
    kmsUnwraps = () => decrypt.mock.calls.length;
    setHostedSecureBoxStringTestCodecForTests(null);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", ORIGIN);
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 41).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 42).toString("base64url"));
    vi.stubEnv("EPIC_SMART_CLIENT_ID", "synthetic-public-client");
    for (const key of ["EPIC_SMART_PUBLIC_CLIENT_ID", "EPIC_SMART_ASYMMETRIC_CLIENT_ID", "EPIC_SMART_PERSISTENT_CREDENTIALS",
      "EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS", "CLINICAL_RECORDS_WRITE_GRANT_PROFILES"]) vi.stubEnv(key, "");
    published = baseArtifact;
    portals = syntheticPortals();
    vi.stubGlobal("fetch", portals.fetchImpl);
    vi.spyOn(directory, "resolveClinicalProviderDirectoryEntry")
      .mockImplementation(id => published.entries.find(entry => entry.id === id) ?? null);
    vi.spyOn(signal, "signalHostedMailboxAppendRuntime").mockResolvedValue({ signalAccepted: true, workflowId: "synthetic" });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await prisma.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });
  afterAll(() => prisma.$disconnect());

  async function member(path: Path) {
    const memberId = `clinical-pinned-${randomUUID()}`;
    members.push(memberId);
    await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    for (const domain of ["ingress", "device", "control"] as const) {
      await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain, userId: memberId, reason: "synthetic-test", prisma });
    }
    for (const scope of ["launch.legal", "launch.health-data"] as const) await recordHostedLaunchRequiredConsent({ memberId, scope, prisma });
    const session = await issueHostedAppSession({ memberId });
    const cookie = session.cookie.split(";")[0]!;
    const browserRequest = (route: string) => new Request(`${ORIGIN}${route}`, { method: "POST", headers: { origin: ORIGIN, cookie } });
    const nativeAuth = await requireHostedMemberAuthFromBearerToken(new Request(ORIGIN, {
      headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(session.token)}` },
    }));

    /** Starts at the provider and returns the authorization URL plus a callback that reports the member outcome. */
    async function start() {
      if (path === "native") {
        const started = await startNativeAuthorization({ auth: nativeAuth, appReturn: "ios", origin: ORIGIN, providerDirectoryEntryId: ENTRY_ID });
        const state = new URL(started.authorizationUrl).searchParams.get("state")!;
        return { authorizationUrl: new URL(started.authorizationUrl),
          finish: () => completeNativeAuthorization(nativeAuth, new URLSearchParams({ state, code: "synthetic-code" }), started.completionProof) };
      }
      const request = browserRequest("/api/clinical-records/connect-intents/start");
      const intent = await createClinicalRecordConnectIntent({ memberId, request });
      const started = await startClinicalRecordConnection({ claim: intent.claim, providerDirectoryEntryId: ENTRY_ID, request });
      const state = new URL(started.authorizationUrl).searchParams.get("state")!;
      return { authorizationUrl: new URL(started.authorizationUrl), finish: async () => {
        try {
          await finishClinicalRecordAuthorization({ code: "synthetic-code", state, providerDenied: false, providerError: false,
            request: new Request(`${ORIGIN}/api/clinical-records/oauth/callback`, { headers: { cookie } }) });
          return "connected";
        } catch (error) {
          return (error as { code?: string }).code ?? "failed";
        }
      } };
    }
    async function source() {
      const row = await prisma.clinicalRecordConnection.findUniqueOrThrow({
        where: { memberId_providerDirectoryEntryId: { memberId, providerDirectoryEntryId: ENTRY_ID } },
      });
      const fhirBaseUrl = await openClinicalConnectionFhirBaseUrl({ connectionId: row.id, encrypted: row.fhirBaseUrlEncrypted, memberId });
      return { ...row, fhirBaseUrl };
    }
    async function disconnect(connectionId: string) {
      if (path === "native") await disconnectClinicalSource(nativeAuth, { connectionId });
      else await disconnectClinicalRecordConnection({ connectionId, request: browserRequest(`/api/clinical-records/connections/${connectionId}/disconnect`) });
    }
    return { memberId, start, source, disconnect };
  }

  async function connect(subject: Awaited<ReturnType<typeof member>>, patient: string) {
    portals.signIn(patient);
    const egressBefore = portals.egress.length;
    const unwrapsBefore = kmsUnwraps();
    const { authorizationUrl, finish } = await subject.start();
    const startUnwraps = kmsUnwraps() - unwrapsBefore;
    const outcome = await finish();
    return { authorizationUrl, outcome, egress: [...new Set(portals.egress.slice(egressBefore))], startUnwraps };
  }

  const pathsAndBindings = [["browser", false], ["browser", true], ["native", false], ["native", true]] as const;

  /** Connects one member's source while the base directory is published, then publishes the moved endpoint. */
  async function connectedBeforeMove(path: Path, bound: boolean) {
    vi.stubEnv("CLINICAL_RECORDS_WRITE_GRANT_PROFILES", bound ? "1" : "");
    const subject = await member(path);
    const first = await connect(subject, "synthetic-patient-one");
    expect(first.outcome).toBe("connected");
    const original = await subject.source();
    expect(original).toMatchObject({ fhirBaseUrl: OLD_BASE, fhirBaseHash: hash(OLD_BASE), tokenVersion: 1 });
    published = headArtifact;
    return { subject, original, first };
  }

  function expectPinnedAuthorization(attempt: Awaited<ReturnType<typeof connect>>, first: Awaited<ReturnType<typeof connect>>) {
    expect(attempt).toMatchObject({ outcome: "connected", egress: [new URL(OLD_BASE).origin] });
    expect(attempt.authorizationUrl.origin).toBe(new URL(OLD_BASE).origin);
    expect(attempt.authorizationUrl.searchParams.get("aud")).toBe(OLD_BASE);
    // Opening the pinned base shares the verifier seal's domain-root unwrap, so the start costs no extra KMS call.
    expect(attempt.startUnwraps).toBe(first.startUnwraps);
  }

  it.each(pathsAndBindings)("reconnects the same patient at the pinned base after the directory moves (%s, bound=%s)", async (path, bound) => {
    const { subject, original, first } = await connectedBeforeMove(path, bound);
    expectPinnedAuthorization(await connect(subject, "synthetic-patient-one"), first);
    expect(await subject.source()).toMatchObject({ id: original.id, status: "active", tokenVersion: 2, retrievalGeneration: 2,
      fhirBaseUrl: OLD_BASE, fhirBaseHash: hash(OLD_BASE) });
  });

  it.each(pathsAndBindings)("re-adds a disconnected source at the pinned base after the directory moves (%s, bound=%s)", async (path, bound) => {
    const { subject, original, first } = await connectedBeforeMove(path, bound);
    await subject.disconnect(original.id);
    expect(await subject.source()).toMatchObject({ status: "disconnected", fhirBaseUrl: OLD_BASE, fhirBaseHash: hash(OLD_BASE) });
    expectPinnedAuthorization(await connect(subject, "synthetic-patient-one"), first);
    expect(await subject.source()).toMatchObject({ id: original.id, status: "active", tokenVersion: 2, fhirBaseUrl: OLD_BASE });
    expect(await prisma.clinicalRecordConnection.count({ where: { memberId: subject.memberId } })).toBe(1);
  });

  it.each(["browser", "native"] as const)("gives a different member's first connection the moved endpoint (%s)", async path => {
    await connectedBeforeMove(path, false);
    const newcomer = await member(path);
    const attempt = await connect(newcomer, "synthetic-patient-two");
    expect(attempt).toMatchObject({ outcome: "connected", egress: [new URL(NEW_BASE).origin] });
    expect(attempt.authorizationUrl.searchParams.get("aud")).toBe(NEW_BASE);
    expect(await newcomer.source()).toMatchObject({ fhirBaseUrl: NEW_BASE, fhirBaseHash: hash(NEW_BASE), tokenVersion: 1 });
  });

  it.each(["browser", "native"] as const)("completes a bound session started before the directory moved (%s)", async path => {
    vi.stubEnv("CLINICAL_RECORDS_WRITE_GRANT_PROFILES", "1");
    const subject = await member(path);
    portals.signIn("synthetic-patient-three");
    const { finish } = await subject.start();
    published = headArtifact;
    const egressBefore = portals.egress.length;
    expect(await finish()).toBe("connected");
    expect(new Set(portals.egress.slice(egressBefore))).toEqual(new Set([new URL(OLD_BASE).origin]));
    expect(await subject.source()).toMatchObject({ fhirBaseUrl: OLD_BASE, fhirBaseHash: hash(OLD_BASE) });
  });

  it.each(["browser", "native"] as const)("refuses a pinned base that fails the directory URL rules before any egress (%s)", async path => {
    const subject = await member(path);
    expect((await connect(subject, "synthetic-patient-four")).outcome).toBe("connected");
    const row = await subject.source();
    // A private address is never a valid directory endpoint, even when it is what the source was bound to.
    const untrusted = "https://10.20.30.40/FHIR/R4";
    await prisma.clinicalRecordConnection.update({ where: { id: row.id }, data: { fhirBaseHash: hash(untrusted),
      fhirBaseUrlEncrypted: await sealClinicalConnectionFhirBaseUrl({ connectionId: row.id, memberId: subject.memberId, value: untrusted }) } });
    const sessions = await prisma.clinicalRecordOauthSession.count({ where: { memberId: subject.memberId } });
    const egressBefore = portals.egress.length;
    await expect(subject.start()).rejects.toMatchObject({ code: "CLINICAL_RECORD_PINNED_ENDPOINT_UNTRUSTED" });
    expect(portals.egress.length).toBe(egressBefore);
    expect(await prisma.clinicalRecordOauthSession.count({ where: { memberId: subject.memberId } })).toBe(sessions);
    expect(await prisma.clinicalRecordConnectIntent.count({ where: { memberId: subject.memberId, startedAt: { not: null }, completedAt: null } }))
      .toBe(0);
  });
});
