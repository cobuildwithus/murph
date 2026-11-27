import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedNativeMemberAuth } from "../src/lib/better-auth/native-auth";
import { profileFactorLookupKeys } from "../src/lib/hosted-onboarding/contact-privacy-core";
import { recordHostedLaunchRequiredConsent } from "../src/lib/legal/consent";
import { prepareHealthCandidates } from "../src/lib/health-wins/card-options";
import * as crypto from "../src/lib/health-wins/crypto";
import { prepareHealthProfileExport } from "../src/lib/health-profile/export";
import { storedPins, readWorkingSelections } from "../src/lib/health-profile/storage";
import { pinCandidates, setPins } from "../src/lib/health-profile/pins";
import { listWorkingOn, workingOptions, setWorking, setWorkingCheer } from "../src/lib/health-profile/working-on";
import { readExtendedProfile } from "../src/lib/health-profile/profile";
import { profileAge } from "../src/lib/health-profile/age";
import { addDays } from "../src/lib/game/time";
import { authorizeMediaRead, runGameCommand } from "../src/lib/game/service";
import { putGameMedia } from "../src/lib/game/media";
import { getPrisma } from "../src/lib/prisma";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { seedHealthPayoff } from "./support/health-payoff-fixture";

const { replica } = vi.hoisted(() => ({ replica: vi.fn() }));
vi.mock("../src/lib/device-sync/companion-numbers", async original => ({
  ...await original<typeof import("../src/lib/device-sync/companion-numbers")>(), loadPublishedCompanionMetricReplica: replica,
}));
vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32, 31), envelope: { rootKeyId: "fixture-profile-root" } }),
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Buffer.alloc(32, 31) }),
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw Error("Expected an isolated local test database.");
}
const members: string[] = [], signal = new AbortController().signal;
async function member(): Promise<HostedNativeMemberAuth> {
  const db = getPrisma(), memberId = randomUUID(), credential = randomUUID(), now = new Date();
  members.push(memberId);
  const member = await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const row = await db.hostedAuthRecord.create({ data: { model: "session", id: randomUUID(), memberId, createdAt: now, updatedAt: now,
    expiresAt, payloadEncrypted: "fixture-session" } });
  for (const scope of ["launch.legal", "launch.health-data"] as const) await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: db });
  return { kind: "better-auth", member, credential, sessionId: row.id, proof: { row, expiresAt, credentialDigest: createHash("sha256").update(credential).digest() } };
}
async function winSet(owner: string, day: string, empty = false) {
  const revision = randomUUID();
  const cards = prepareHealthCandidates(owner, empty ? [] : [{
    id: "fixture-lab", kind: "lab_range", filter: "Labs", theme: "labs", title: { number: "17", measure: "Fixture marker" },
    subtitle: "Fixture milestone", source_note: "", chart: { type: "gauge", value: 17, unit: "units", range: { source: "fixture" }, date: day },
    share: { caption_tips: [] },
  }, {
    id: "fixture-historic-run", kind: "game_streak", filter: "Challenges", theme: "challenges",
    title: { number: "8", measure: "days" }, subtitle: "Fixture historic best", source_note: "",
    chart: { type: "week_dots", days: 8, start: addDays(day, -7), end: day, missedOn: null },
    share: { caption_tips: [] },
  }]);
  const [candidatesEncrypted] = await crypto.sealHealthTexts([{ memberId: owner, table: "health_win_set", rowId: revision, field: "candidates", value: JSON.stringify(cards) }]);
  const data = { memberId: owner, revision, day, sourceRevision: revision, candidatesEncrypted, checkedAt: new Date() };
  await getPrisma().healthWinSet.upsert({ where: { memberId_day: { memberId: owner, day } }, create: data, update: data });
  return revision;
}

describe.skipIf(!enabled)("Health profile publication", () => {
  beforeEach(() => {
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
    vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", "*");
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
  });
  afterEach(async () => {
    replica.mockReset();
    vi.restoreAllMocks();
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    vi.unstubAllEnvs();
  });

  it("serves only the current cover to eligible profile viewers and validates upload ownership", async () => {
    const auth = await member(), peer = await member(), other = await member(), owner = auth.member.id;
    await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const key = await putGameMedia({ prefix: `game/${owner}/`, bytes: Uint8Array.from([255, 216, 255, 219]), contentType: "image/jpeg" });
    const save = (actorMemberId: string, cover: Record<string, unknown>) => runGameCommand({ actorMemberId, command: { ...cover, type: "setProfile" } });
    expect(await save(peer.member.id, { coverPhotoKey: key })).toMatchObject({ ok: false, error: { code: "MEDIA_MISSING" } });
    expect(await save(owner, { coverPhotoKey: key })).toMatchObject({ ok: true });
    expect((await readExtendedProfile(peer, owner, signal)).extras.cover).toMatchObject({ kind: "photo", url: expect.any(String) });
    expect(await authorizeMediaRead(peer.member.id, key)).toBe(true);
    expect(await authorizeMediaRead(other.member.id, key)).toBe(false);
    vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", owner);
    expect(await authorizeMediaRead(peer.member.id, key)).toBe(false);
    await expect(save(peer.member.id, { cover: null })).rejects.toMatchObject({ httpStatus: 404 });
    await save(owner, { coverArt: "ink" });
    vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", "*");
    expect(await authorizeMediaRead(peer.member.id, key)).toBe(false);
    expect((await readExtendedProfile(peer, owner, signal)).extras.cover).toEqual({ kind: "art", key: "ink" });
    await save(owner, { cover: null });
    expect((await readExtendedProfile(peer, owner, signal)).extras.cover).toBeNull();
  });
  it("fences replacement during sealing and preserves the chosen variant after its source disappears", async () => {
    const auth = await member(), peer = await member(), owner = auth.member.id;
    await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const day = new Date().toISOString().slice(0, 10);
    await winSet(owner, day);
    const [offer] = (await pinCandidates(auth, signal, "us")).candidates;
    const pick = { key: offer.key, revision: offer.revision, option: "hide_numbers" };
    const seal = crypto.sealHealthTexts;
    vi.spyOn(crypto, "sealHealthTexts").mockImplementationOnce(async (...args) => {
      const result = await seal(...args);
      await winSet(owner, day);
      return result;
    });
    await expect(setPins(auth, [pick], signal, "us")).rejects.toMatchObject({ httpStatus: 409 });
    expect(await storedPins(owner)).toEqual([]);
    const { candidates } = await pinCandidates(auth, signal, "us");
    expect(candidates.map(candidate => candidate.card.kind)).toEqual(["lab_range"]);
    const [fresh] = candidates;
    await setPins(auth, [{ key: fresh.key, revision: fresh.revision, option: "hide_numbers" }], signal, "us");
    await winSet(owner, day, true);
    const { extras } = await readExtendedProfile(peer, owner, signal);
    expect(extras.pins[0]).toMatchObject({ pinnedOn: day, card: { chart: { type: "hidden" } } });
    const [retained] = (await pinCandidates(auth, signal, "us")).candidates;
    await setPins(auth, [{ key: retained.key, revision: retained.revision }], signal, "us");
    const records = await prepareHealthProfileExport(owner, async () => {});
    expect(JSON.parse((await records!().next()).value!).healthProfile.pins[0].card.chart.type).toBe("hidden");
    await setPins(auth, [], signal, "us");
    expect(await storedPins(owner)).toEqual([]);
  });

  it("only returns mutual game rows, and a non-mutual live pin never names the other seat", async () => {
    const auth = await member(), peer = await member(), other = await member(), owner = auth.member.id;
    const mutual = await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const privateGame = await seedHealthPayoff({ winnerId: owner, debtorId: other.member.id });
    const db = getPrisma();
    await db.game.updateMany({ where: { id: { in: [mutual.gameId, privateGame.gameId] } }, data: { status: "live", settledAt: null } });
    await winSet(owner, new Date().toISOString().slice(0, 10), true);
    const { candidates } = await pinCandidates(auth, signal, "us");
    await setPins(auth, candidates.map(({ key, revision }) => ({ key, revision })), signal, "us");
    const { extras } = await readExtendedProfile(peer, owner, signal);
    expect(extras.streaks.map(s => s.gameId)).toEqual([mutual.gameId]);
    expect(extras.pins).toHaveLength(2);
    expect(JSON.stringify(extras.pins)).not.toContain(privateGame.gameId);
    expect(JSON.stringify(extras.pins)).not.toContain(other.member.id);
    await db.game.update({ where: { id: privateGame.gameId }, data: { status: "settled" } });
    expect((await readExtendedProfile(peer, owner, signal)).extras.pins).toHaveLength(1);
  });

  it("offers trackable private metrics and returns the chosen rows for the private You view", async () => {
    const auth = await member(), peer = await member(), owner = auth.member.id;
    await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const today = new Date().toISOString().slice(0, 10);
    replica.mockResolvedValue({ state: "ready", client: { replica: {}, metrics: { series: ({ metricKey }: { metricKey: string }) =>
      metricKey === "resting-heart-rate" ? [54, 51].map((value, i) => ({ metricKey, value, date: addDays(today, i - 1),
        context: {}, statistic: "value", sourceLabel: "Garmin", unit: "bpm" })) : [] } } });
    expect((await workingOptions(auth, signal)).options.map(o => o.factor)).toEqual(["restingHeartRate"]);
    await expect(setWorking(auth, ["steps"], signal)).rejects.toMatchObject({ httpStatus: 400 });
    await setWorking(auth, ["restingHeartRate"], signal);
    const { extras } = await readExtendedProfile(auth, owner, signal);
    expect(extras.workingOn[0]).toMatchObject({ since: today, series: [{ date: today, value: 51 }] });
    expect(await listWorkingOn(owner)).toEqual([{ kind: "workingOn", factor: "restingHeartRate", title: "Resting heart rate",
      icon: "heart", text: "51", change: "0" }]);
  });

  it("suppresses absent age, fences a changed age, and compares only two explicit age pins", async () => {
    const auth = await member(), peer = await member(), owner = auth.member.id;
    await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const day = new Date().toISOString().slice(0, 10);
    for (const id of [owner, peer.member.id]) await winSet(id, day, true);
    expect((await pinCandidates(auth, signal, "us")).candidates).toEqual([]);
    vi.spyOn(profileAge, "read").mockImplementation(async id => ({
      value: id === owner ? 43.2 : 40.8, gap: -0.8, revision: "model-day-generation",
    }));
    const valid = vi.spyOn(profileAge, "current").mockResolvedValue(false);
    const pick = { key: "age", revision: "model-day-generation" };
    await expect(setPins(auth, [pick], signal, "us")).rejects.toMatchObject({ httpStatus: 409 });
    valid.mockResolvedValue(true);
    await setPins(auth, [pick], signal, "us");
    expect((await readExtendedProfile(peer, owner, signal)).extras.compare?.rows).toEqual([]);
    await setPins(peer, [pick], signal, "us");
    const { extras } = await readExtendedProfile(peer, owner, signal);
    expect(extras.compare?.rows).toEqual([{ label: "Biological age", them: "43.2", you: "40.8" }]);
    expect(extras.pins[0].card.chart).toEqual({ type: "biological_age", value: 43.2, gap: -0.8 });
  });

  it("preserves since and cheers on reorder, withholds unshared readings, cascades removal and deletion", async () => {
    const auth = await member(), peer = await member(), owner = auth.member.id, db = getPrisma();
    await seedHealthPayoff({ winnerId: owner, debtorId: peer.member.id });
    const since = "2025-06-12";
    await db.healthWorkingOn.createMany({ data: ["steps", "sleepTime"].map((factor, position) => ({
      memberId: owner, factor: profileFactorLookupKeys(owner, factor).current, position, since,
    })) });
    await setWorkingCheer(peer, owner, "steps", true);
    await setWorkingCheer(peer, owner, "steps", true);
    await setWorking(auth, ["sleepTime", "steps"], signal);
    expect((await readWorkingSelections(owner, peer.member.id)).map(i => [i.factor, i.since, i.cheered])).toEqual([
      ["sleepTime", since, false], ["steps", since, true],
    ]);
    expect((await readExtendedProfile(peer, owner, signal)).extras.workingOn[1]).toEqual({ factor: "steps", title: "Steps", cheered: true, state: "notShared" });
    expect(await db.hostedVaultShare.count({ where: { grantorMemberId: owner } })).toBe(0);
    const exportRows = await prepareHealthProfileExport(peer.member.id, async () => {});
    const exported = [];
    for await (const line of exportRows!()) exported.push(JSON.parse(line));
    expect(exported.at(-1)).toEqual({ workingOnCheers: [{ ownerId: owner, factor: "steps" }] });
    await setWorking(auth, ["sleepTime"], signal);
    expect(await db.healthWorkingOnCheer.count({ where: { ownerId: owner } })).toBe(0);
    await cleanupGameFixtures(db, members);
    await db.hostedMember.delete({ where: { id: owner } });
    expect(await db.healthWorkingOn.count({ where: { memberId: owner } })).toBe(0);
  });
});
