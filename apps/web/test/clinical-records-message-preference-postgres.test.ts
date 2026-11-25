import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as complete } from "../app/api/clinical-records/companion/complete/route";
import { POST as setPreference } from "../app/api/clinical-records/companion/message-preference/route";
import { POST as remove } from "../app/api/clinical-records/companion/sources/[id]/remove/route";
import { GET as list } from "../app/api/clinical-records/companion/sources/route";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import { setClinicalRecordMessageMode } from "@/src/lib/clinical-records/message-preference";
import { buildHostedDeviceSyncAppCompletionProof } from "@/src/lib/device-sync/browser-callback-proof";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { withdrawHostedHealthDataConsent } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { issueHostedAppSession } from "./support/hosted-auth-session";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search || url.hash) {
    throw new Error("Clinical preference proof requires an isolated local test database.");
  }
}

describe.skipIf(!enabled)("clinical record message preference", () => {
  let memberId: string;
  let session: Awaited<ReturnType<typeof issueHostedAppSession>>;
  beforeEach(async () => {
    memberId = `clinical-preference-${randomUUID()}`;
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 11).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 12).toString("base64url"));
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", Buffer.alloc(32, 13).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://example.test");
    await getPrisma().hostedMember.create({ data: { id: memberId, billingStatus: "canceled" } });
    for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: getPrisma() });
    }
    session = await issueHostedAppSession({ memberId });
  });
  afterEach(async () => {
    await getPrisma().hostedMember.deleteMany({ where: { id: memberId } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await getPrisma().$disconnect(); });

  function request(path: string, method = "GET", body?: object) {
    return new Request(`https://example.test/api/clinical-records/companion/${path}`, {
      method, headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(session.token)}` },
      body: JSON.stringify(body),
    });
  }
  const postMode = (mode: string) => setPreference(request("message-preference", "POST", { mode }));
  function setting() {
    return getPrisma().hostedMember.findUniqueOrThrow({ where: { id: memberId },
      select: { clinicalRecordMessageMode: true, clinicalRecordMessageRevision: true } });
  }

  it("persists all transitions for a lapsed member, incrementing only on change", async () => {
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 0 });
    for (const [mode, revision] of [
      ["notice", 0], ["off", 1], ["off", 1], ["notice", 2], ["detail", 3], ["detail", 3],
      ["notice", 4], ["detail", 5], ["off", 6],
    ] as const) {
      const result = await postMode(mode);
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ messageMode: mode });
      await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: mode, clinicalRecordMessageRevision: revision });
    }
    const rejected = await postMode("detail");
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error.code).toBe("CLINICAL_RECORD_NOTICE_REQUIRED");
    expect((await postMode("unknown")).status).toBe(400);
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "off", clinicalRecordMessageRevision: 6 });
    const where = { memberId, scope: "feature.clinical-record-message-detail" };
    await expect(getPrisma().hostedConsentEvent.findMany({ where, select: { metadataJson: true }, orderBy: { createdAt: "asc" } }))
      .resolves.toEqual([{ metadataJson: { revision: 3 } }, { metadataJson: { revision: 5 } }]);
    await expect(getPrisma().hostedConsentGrant.count({ where })).resolves.toBe(0);
  });

  it("withdraws detail atomically and leaves it off across retries and reconsent", async () => {
    const prisma = getPrisma();
    expect((await postMode("detail")).status).toBe(200);
    await withdrawHostedHealthDataConsent({ memberId, prisma });
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "off", clinicalRecordMessageRevision: 2 });
    expect((await postMode("notice")).status).toBe(403);
    expect((await postMode("off")).status).toBe(200);
    await withdrawHostedHealthDataConsent({ memberId, prisma });
    await recordHostedLaunchRequiredConsent({ memberId, prisma, scope: "launch.health-data" });
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "off", clinicalRecordMessageRevision: 2 });
  });

  it("rejects extra keys before changing the preference", async () => {
    const response = await setPreference(request("message-preference", "POST", { mode: "off", extra: true }));
    expect(response.status).toBe(400);
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 0 });
  });

  it("allows opting out when product access blocks notice and detail", async () => {
    await getPrisma().hostedMember.update({ where: { id: memberId }, data: { billingStatus: "not_started" } });
    for (const mode of ["notice", "detail"]) {
      const response = await postMode(mode);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("HOSTED_ACCESS_REQUIRED");
    }
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 0 });
    expect((await postMode("off")).status).toBe(200);
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "off", clinicalRecordMessageRevision: 1 });
  });

  it("rejects a session revoked between bearer admission and the write", async () => {
    const auth = await requireHostedMemberAuthFromBearerToken(request("message-preference"));
    await getPrisma().hostedAuthRecord.delete({ where: { model_id: { model: "session", id: session.sessionId } } });
    await expect(setClinicalRecordMessageMode(auth, "off")).rejects.toMatchObject({ httpStatus: 401 });
    expect((await postMode("off")).status).toBe(401);
    await expect(setting()).resolves.toEqual({ clinicalRecordMessageMode: "notice", clinicalRecordMessageRevision: 0 });
  });

  it("shares the daily-grant projection across list, complete and removal", async () => {
    const read = async () => (await list(request("sources"))).json();
    expect(await read()).toEqual({ sources: [], canAdd: true });
    const source = { memberId, sourceSystem: "epic-fhir", displayName: "Synthetic portal", connectedAt: new Date(),
      fhirBaseUrlEncrypted: "synthetic-sealed", fhirBaseHash: "synthetic-hash", requestedScopesJson: [] };
    const add = (id: string, persistent: boolean) => getPrisma().clinicalRecordConnection.create({
      data: { ...source, id, providerDirectoryEntryId: id, refreshTokenEncrypted: persistent ? "synthetic-sealed" : null },
    });
    const disconnect = async (id: string) => (await remove(request(`sources/${id}/remove`, "POST"),
      { params: Promise.resolve({ id }) })).json();
    const once = await add(randomUUID(), false);
    expect(await read()).not.toHaveProperty("messageMode");
    const daily = await add(randomUUID(), true);
    expect((await postMode("detail")).status).toBe(200);
    const projection = await read();
    expect(projection).toMatchObject({ messageMode: "detail", canAdd: true });
    const state = `crs_${"c".repeat(43)}`;
    const completionProof = buildHostedDeviceSyncAppCompletionProof({ memberId, sessionId: session.sessionId,
      state, provider: "clinical-records", now: new Date(Date.now() - 20 * 60_000) });
    const response = await complete(request("complete", "POST", { query: `state=${state}&error=access_denied`, completionProof }));
    expect(await response.json()).toEqual({ outcome: "expired", ...projection });
    expect(await disconnect(once.id)).toMatchObject({ messageMode: "detail" });
    const disconnected = await disconnect(daily.id);
    expect(disconnected).not.toHaveProperty("messageMode");
    expect(disconnected.sources).toHaveLength(2);
    expect(disconnected.sources).toEqual(Array(2).fill(expect.objectContaining({ updates: "one_time", state: "disconnected" })));
  });
});
