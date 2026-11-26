import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostedNativeMemberAuth } from "../src/lib/better-auth/native-auth";
import { authLookupKey } from "../src/lib/better-auth/record-crypto";
import { getPrisma } from "../src/lib/prisma";
import { recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from "../src/lib/legal/consent";
import { assertHealthSetCurrent, changeHealthWin, readHealthWins, resolveHealthCards } from "../src/lib/health-wins/wins";
import { createHealthPost, deleteHealthPost, patchHealthPost } from "../src/lib/health-wins/writes";
import * as cardOptions from "../src/lib/health-wins/card-options";
import * as chatHealth from "../src/lib/hosted-onboarding/linq-provider-health-store";
import * as destinations from "../src/lib/hosted-routing/assistant-notification-destination";
import { drainHealthWinTexts } from "../src/lib/health-wins/nudge-job";
import * as crypto from "../src/lib/health-wins/crypto";
import type { HealthWinsInput } from "../src/lib/health-wins/engine";
import { seeYoursCard } from "../src/lib/health-wins/engine/see-yours";

const source = vi.hoisted(() => vi.fn());
const measureSource = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/health-wins/inputs", () => ({ readHealthWinInputs: source, readMeasureInputs: measureSource }));
vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedDomainRootForWeb: async ({ domain, userId }: { domain: string; userId: string }) => ({ domain, userId, rootKeyId: "fixture-win-root" }),
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32, 49), envelope: { rootKeyId: "fixture-win-root" } }),
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Buffer.alloc(32, 49) }),
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Win set tests require an isolated local test database.");
}
const db = getPrisma(), members: string[] = [];
const signal = new AbortController().signal;
function data(today: string, total = 27, complete = true) {
  const input: HealthWinsInput = {
    member: { today, age: null, sex: null, wearableProvider: null },
    games: [{ exercise: "squats", total, unit: "reps", landmarksPassed: [], next: null, bestStreak: null }],
  };
  return { input, complete, sourceRevision: `fixture-revision-${total}` };
}

async function fixture(sessionDays = 1): Promise<HostedNativeMemberAuth> {
  const memberId = randomUUID(), credential = randomUUID(), now = new Date();
  members.push(memberId);
  const member = await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  const expiresAt = new Date(now.getTime() + sessionDays * 86_400_000);
  const row = await db.hostedAuthRecord.create({ data: { model: "session", id: randomUUID(), memberId,
    createdAt: now, updatedAt: now, expiresAt, payloadEncrypted: "fixture-session" } });
  await db.gameProfile.create({ data: { memberId, firstNameEncrypted: "fixture-name", timeZone: "UTC" } });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: db });
  }
  return { kind: "better-auth", member, credential, sessionId: row.id,
    proof: { row, expiresAt, credentialDigest: createHash("sha256").update(credential).digest() } };
}

function enableWinTexts(...members: string[]) {
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", members.join(","));
  vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", members.join(","));
}

function sessionInputs(today: string, total = 20, complete = true) {
  const result = data(today, total, complete);
  result.input.sessions = ["01", "02", "03"].map(day =>
    ({ type: "walk", minutes: 14, date: `${today.slice(0, 7)}-${day}` }));
  return result;
}

async function publishEasternHistory(utcDays: number[]) {
  // At 11:00 UTC the UTC+14 and UTC-12 local dates are two days apart.
  const instant = (day: number) => Date.UTC(2031, 5, day, 11);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant(utcDays[0]));
  const auth = await fixture(30);
  await db.gameProfile.update({ where: { memberId: auth.member.id }, data: { timeZone: "Pacific/Kiritimati" } });
  source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
  for (const day of utcDays) {
    vi.setSystemTime(instant(day));
    await readHealthWins(auth, { signal });
  }
  return auth;
}

function incompleteInputs(_memberId: string, _checkAuthority: () => Promise<void>, today: string) {
  return { input: { member: data(today).input.member }, complete: false, sourceRevision: "fixture-incomplete" };
}

function distanceHistory(today: string) {
  const result = data(today);
  result.input.daily = ["04", "05", "06", "07"].flatMap(month => Array.from({ length: 16 }, (_, i) => ({
    metric: "distance_km", provider: "apple", date: `2034-${month}-${String(i + 1).padStart(2, "0")}`,
    value: (month === "07" ? 3.28 : 2.34) * 1.609344,
  })));
  return result;
}

describe.skipIf(!enabled)("member-local health win sets", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    source.mockReset();
    measureSource.mockReset();
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });

  it("cleans up excess history per member after deploy and preserves the remaining days on retry", async () => {
    const migration = await readFile(new URL(
      "../prisma/contract-migrations/20261126010000_prune_health_win_sets/migration.sql", import.meta.url,
    ), "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL search_path TO pg_temp`;
      await tx.$executeRaw`CREATE TEMP TABLE health_win_set (
        member_id text, day varchar(10), PRIMARY KEY (member_id, day)
      ) ON COMMIT DROP`;
      await tx.$executeRaw`INSERT INTO health_win_set VALUES
        ('daily', '2032-04-06'), ('daily', '2032-04-07'), ('daily', '2032-04-08'), ('daily', '2032-04-09'),
        ('sparse', '2031-02-01'), ('sparse', '2031-11-09'), ('sparse', '2032-04-06'), ('sparse', '2032-10-17'),
        ('single', '2031-02-01')`;
      expect(await tx.$executeRawUnsafe(migration)).toBe(2);
      expect(await tx.$executeRawUnsafe(migration)).toBe(0);
      expect(await tx.$queryRaw`
        SELECT member_id, array_agg(day ORDER BY day) AS days FROM health_win_set GROUP BY member_id ORDER BY member_id
      `).toEqual([
        { member_id: "daily", days: ["2032-04-07", "2032-04-08", "2032-04-09"] },
        { member_id: "single", days: ["2031-02-01"] },
        { member_id: "sparse", days: ["2031-11-09", "2032-04-06", "2032-10-17"] },
      ]);
    });
  });

  it("keeps an offered Diet card available to publish when Diet generation is turned off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2035-06-08T12:00:00Z"));
    const auth = await fixture();
    vi.stubEnv("MURPH_HEALTH_DIET_MEMBER_IDS", auth.member.id);
    const meals = Array.from({ length: 26 }, (_, i) => ({
      date: `2035-05-${String(i + 1).padStart(2, "0")}`, proteinG: 74, fiberG: null,
    }));
    source.mockImplementation((_memberId, _checkAuthority, today: string) => ({
      ...data(today), input: { member: data(today).input.member, meals },
    }));
    const offered = await readHealthWins(auth, { signal });
    const tally = offered.candidates.find(card => card.kind === "month_total");
    expect(tally).toBeDefined();
    vi.stubEnv("MURPH_HEALTH_DIET_MEMBER_IDS", "");
    expect(await readHealthWins(auth, { signal })).toEqual(offered);
    const id = randomUUID();
    expect(await createHealthPost(auth, { id, setRevision: offered.setRevision,
      cards: [{ candidateId: tally!.id, option: "original" }] })).toEqual({ id, version: 1 });
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("serves one stable set within the hour, freezes the selected option, and conflicts after replacement", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    const first = await readHealthWins(auth, { signal });
    const candidateId = first.candidates[0].id;
    expect((await readHealthWins(auth, { signal })).setRevision).toBe(first.setRevision);
    expect(source).toHaveBeenCalledTimes(1);
    const hidden = await changeHealthWin(auth, { setRevision: first.setRevision, candidateId, option: "hide_numbers" });
    expect(hidden.card).toMatchObject({ title: { number: "" }, chart: { type: "hidden" } });
    const prepared = await resolveHealthCards(auth, first.setRevision, [{ candidateId, option: "hide_numbers" }]);
    expect(prepared.cards[0]).toMatchObject({ id: candidateId, specRevision: hidden.card.specRevision, spec: { chart: { type: "hidden" } } });
    expect(JSON.stringify(prepared.cards[0].spec)).not.toContain("game_climb:squats");
    await expect(changeHealthWin(auth, { setRevision: first.setRevision, candidateId, option: "invent_values" })).rejects.toMatchObject({ httpStatus: 400 });
    await db.healthWinSet.updateMany({ where: { memberId }, data: { checkedAt: new Date(0) } });
    const unchanged = await readHealthWins(auth, { signal });
    expect(unchanged).toEqual(first);
    await db.healthWinSet.updateMany({ where: { memberId }, data: { checkedAt: new Date(0) } });
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today, 39, false));
    const replacement = await readHealthWins(auth, { signal });
    expect(replacement.candidates[0].title.number).toBe("39");
    expect(replacement.setRevision).not.toBe(first.setRevision);
    await expect(db.$transaction(tx => assertHealthSetCurrent(tx, memberId, prepared.day, first.setRevision))).rejects.toMatchObject({ httpStatus: 409 });
    await expect(resolveHealthCards(auth, first.setRevision, [{ candidateId, option: "original" }])).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("enrolls on presentation, including legacy, throttled, partial and fallback sets", async ({ onTestFinished }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-02-19T11:04:00Z"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 22).toString("base64url"));
    const auth = await fixture(3), memberId = auth.member.id;
    const where = { memberId };
    const throttleId = `arl_${authLookupKey("verification", "rate-limit", `health-wins-refresh:member:${memberId}`)}`;
    onTestFinished(async () => { await db.hostedAuthRecord.deleteMany({ where: { model: "verification", id: throttleId } }); });
    const read = (refresh = false) => readHealthWins(auth, { signal, refresh });
    source.mockImplementation((_memberId, _check, today: string) => sessionInputs(today));
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", "");
    const legacy = await read();
    expect(await db.healthWinNudge.findUnique({ where })).toBeNull();

    enableWinTexts(memberId);
    expect(await read()).toEqual(legacy);
    expect(await db.healthWinNudge.findUniqueOrThrow({ where })).toMatchObject({ baselineAt: null, lastPresentedAt: expect.any(Date) });
    source.mockImplementationOnce((_memberId, _check, today: string) => sessionInputs(today, 22, false));
    const partial = await read(true);
    const card = partial.candidates.find(candidate => candidate.kind === "sessions")!;
    expect(card.winRef).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(partial)).not.toMatch(/"achievement"|"sourceComplete"|"seenKey"/u);
    expect(await db.healthWinNudge.findUniqueOrThrow({ where })).toMatchObject({ baselineAt: null });
    for (const refresh of [false, true]) {
      await db.healthWinNudge.update({ where, data: { lastPresentedAt: new Date(0) } });
      expect(await read(refresh)).toEqual(partial);
      const state = await db.healthWinNudge.findUniqueOrThrow({ where });
      expect(state.lastPresentedAt.getTime()).toBeGreaterThan(0);
      expect(state.baselineAt).toBeNull();
    }
    expect(source).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2032-02-20T11:04:00Z"));
    await db.healthWinNudge.update({ where, data: { lastPresentedAt: new Date(0) } });
    const deadline = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const budget = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 8_000 ? deadline.signal : nativeTimeout(ms));
    source.mockImplementationOnce((_memberId, _check, _today, sourceSignal: AbortSignal) => {
      deadline.abort(new DOMException("Test input timeout", "TimeoutError"));
      sourceSignal.throwIfAborted();
    });
    expect(await read()).toEqual(partial);
    expect((await db.healthWinNudge.findUniqueOrThrow({ where })).lastPresentedAt.getTime()).toBeGreaterThan(0);
    budget.mockRestore();
    const complete = await read();
    const refreshed = complete.candidates.find(candidate => candidate.kind === "sessions")!;
    expect(refreshed.winRef).toBe(card.winRef);
    const baseline = await db.healthWinNudge.findUniqueOrThrow({ where });
    expect(baseline.baselineAt).toBeInstanceOf(Date);
    expect(baseline.seenKeys).toHaveLength(1);
    expect(baseline.seenKeys).not.toContain(card.winRef);
    const peer = await fixture();
    enableWinTexts(memberId, peer.member.id);
    const peerCard = (await readHealthWins(peer, { signal })).candidates.find(candidate => candidate.kind === "sessions")!;
    expect(peerCard.winRef).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(peerCard.winRef).not.toBe(card.winRef);

    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.healthWinNudge.update({ where, data: { lastPresentedAt: new Date(0) } });
    const withoutKeys = await read();
    expect(withoutKeys.candidates.find(candidate => candidate.id === refreshed.id)).toBeDefined();
    expect(withoutKeys.candidates.every(candidate => candidate.winRef === undefined)).toBe(true);
    expect((await db.healthWinNudge.findUniqueOrThrow({ where })).lastPresentedAt.getTime()).toBeGreaterThan(0);
  });

  it("accepts a held composer selection after a complete background detection reads changed inputs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-04-14T10:17:00Z"));
    const auth = await fixture(3), memberId = auth.member.id;
    enableWinTexts(memberId);
    source.mockImplementation((_memberId, _check, today: string) => sessionInputs(today));
    const held = await readHealthWins(auth, { signal });
    const selection = held.candidates.find(candidate => candidate.kind === "sessions")!;
    vi.setSystemTime(new Date("2032-04-14T11:07:00Z"));
    const now = new Date();
    await db.hostedLinqDailyState.create({ data: { memberId, dayUtc: new Date("2032-04-14T00:00:00Z"),
      inboundCount: 1, firstSeenAt: now, lastSeenAt: now } });
    vi.spyOn(destinations, "resolveHostedAssistantNotificationDestination").mockResolvedValue({
      conversationShape: "direct-member", externalThreadRouteAuthority: null,
      route: { channel: "linq", actorId: null, identityId: "fixture-identity", threadId: "fixture-thread",
        threadIsDirect: true, delivery: { kind: "thread", target: "fixture-thread" } },
    });
    vi.spyOn(chatHealth, "readHostedLinqChatHealth").mockResolvedValue({
      service: "iMessage", linqChatLookupKey: "fixture-thread", phoneNumberLookupKey: null,
      providerObservedAt: now, providerUpdatedAt: now, providerStatus: "HEALTHY",
    });
    source.mockImplementation((_memberId, _check, today: string) => sessionInputs(today, 38));
    expect(await drainHealthWinTexts({ prisma: db, signal })).toMatchObject({ claimed: 1, computed: 1, errors: 0 });
    expect(source).toHaveBeenCalledTimes(2);
    expect((await db.healthWinNudge.findUniqueOrThrow({ where: { memberId } })).lastEvaluatedDay).toBe(held.day);
    const id = randomUUID();
    await createHealthPost(auth, { id, setRevision: held.setRevision, cards: [{ candidateId: selection.id, option: "original" }] });
    expect(await db.healthPost.count({ where: { id } })).toBe(1);
  });

  it("offers only cards absent from live posts as a member posts, edits, and deletes", async () => {
    const auth = await fixture();
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => {
      const result = data(today);
      result.input.daily = [{ metric: "distance_km", provider: "apple", value: 9, date: today }];
      return result;
    });
    const read = () => readHealthWins(auth, { signal });
    const initial = await read();
    const first = initial.candidates.find(card => card.kind === "game_climb")!;
    const second = initial.candidates.find(card => card.kind === "cumulative")!;
    const selection = (id: string) => ({ setRevision: initial.setRevision, cards: [{ candidateId: id, option: "original" }] });
    const without = (...ids: string[]) => ({ ...initial, candidates: initial.candidates.filter(card => !ids.includes(card.id)) });

    const post = await createHealthPost(auth, { id: randomUUID(), ...selection(first.id) });
    expect(await read()).toEqual(without(first.id));
    // The open composer can still publish from the original set.
    const duplicate = await createHealthPost(auth, { id: randomUUID(), ...selection(first.id) });
    await patchHealthPost(auth, post.id, { expectedVersion: 1, ...selection(second.id) });
    expect(await read()).toEqual(without(first.id, second.id));
    await deleteHealthPost(auth, duplicate.id);
    expect(await read()).toEqual(without(second.id));
    await patchHealthPost(auth, post.id, { expectedVersion: 2, caption: "Fixture update" });
    expect(await read()).toEqual(without(second.id));
    await patchHealthPost(auth, post.id, { expectedVersion: 3, cards: [] });
    expect(await read()).toEqual(initial);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("keeps equal candidate IDs separate for two members", async () => {
    const owner = await fixture(), peer = await fixture();
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    // Exercise a literal ID collision without depending on today's member-bound candidate generation.
    const prepare = cardOptions.prepareHealthCandidates;
    vi.spyOn(cardOptions, "prepareHealthCandidates").mockImplementation((_memberId, cards) => prepare("fixture-namespace", cards));
    const a = await readHealthWins(owner, { signal }), b = await readHealthWins(peer, { signal });
    const candidateId = a.candidates[0].id;
    expect(b.candidates[0].id).toBe(candidateId);
    const cards = [{ candidateId, option: "original" }];
    const ownerPost = await createHealthPost(owner, { id: randomUUID(), setRevision: a.setRevision, cards });
    expect(await readHealthWins(peer, { signal })).toEqual(b);
    const peerPost = await createHealthPost(peer, { id: randomUUID(), setRevision: b.setRevision, cards });
    const keys = (id: string) => db.healthPost.findUniqueOrThrow({ where: { id }, select: { postedCardKeys: true } });
    const ownerKeys = await keys(ownerPost.id), peerKeys = await keys(peerPost.id);
    expect(ownerKeys.postedCardKeys).toHaveLength(1);
    expect(peerKeys.postedCardKeys).toHaveLength(1);
    expect(ownerKeys).not.toEqual(peerKeys);
  });

  it("offers the next month's achievement while the prior month's post is live", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2033-03-29T12:00:00Z"));
    const auth = await fixture(14);
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => {
      const result = data(today);
      result.input.sessions = ["01", "02", "03"].map(day =>
        ({ type: "walk", minutes: 23, date: `${today.slice(0, 7)}-${day}` }));
      return result;
    });
    const march = await readHealthWins(auth, { signal });
    const card = march.candidates.find(item => item.kind === "sessions")!;
    await createHealthPost(auth, { id: randomUUID(), setRevision: march.setRevision, cards: [{ candidateId: card.id, option: "original" }] });
    expect((await readHealthWins(auth, { signal })).candidates).not.toContainEqual(card);
    vi.setSystemTime(new Date("2033-04-03T12:00:00Z"));
    const april = await readHealthWins(auth, { signal });
    const next = april.candidates.find(item => item.kind === "sessions")!;
    expect(next.id).not.toBe(card.id);
  });

  it("returns all cached suggestions when the card-key keyring is unavailable", async ({ onTestFinished }) => {
    const auth = await fixture();
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    const first = await readHealthWins(auth, { signal });
    await createHealthPost(auth, { id: randomUUID(), setRevision: first.setRevision,
      cards: [{ candidateId: first.candidates[0].id, option: "original" }] });
    expect((await readHealthWins(auth, { signal })).candidates).toHaveLength(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "");
    onTestFinished(() => { vi.unstubAllEnvs(); });
    expect(await readHealthWins(auth, { signal })).toEqual(first);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Health win card keys unavailable.", { errorClass: "TypeError" });
  });

  it("admits one explicit recomputation every 60 seconds per member, including concurrent refreshes", async ({ onTestFinished }) => {
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 42).toString("base64url"));
    const auth = await fixture(), other = await fixture();
    const ids = [auth, other].map(({ member }) =>
      `arl_${authLookupKey("verification", "rate-limit", `health-wins-refresh:member:${member.id}`)}`);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      await db.hostedAuthRecord.deleteMany({ where: { model: "verification", id: { in: ids } } });
    });
    const startedAt = Math.floor(Date.now() / 60_000) * 60_000 + 59_990;
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    let total = 27;
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today, total));
    const first = await readHealthWins(auth, { signal });
    total = 72;
    const refresh = { signal, refresh: true };
    const replies = await Promise.all([readHealthWins(auth, refresh), readHealthWins(auth, refresh)]);
    const updated = await readHealthWins(auth, { signal });
    expect(updated.setRevision).not.toBe(first.setRevision);
    expect(updated.candidates[0].title.number).toBe("72");
    expect(replies).toContainEqual(updated);
    expect(source).toHaveBeenCalledTimes(2);

    total = 84;
    clock.mockReturnValue(startedAt + 59_999);
    expect(await readHealthWins(auth, refresh)).toEqual(updated);
    expect((await readHealthWins(other, refresh)).candidates[0].title.number).toBe("84");
    expect(source).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(startedAt + 60_000);
    expect((await readHealthWins(auth, refresh)).candidates[0].title.number).toBe("84");
    expect(source).toHaveBeenCalledTimes(4);
  });

  it.each([null, "/api/game/v1/progress/art/map%3Av1%3Acard%3Afixture"])("freezes only available map art (%s)", async distanceArtUrl => {
    const auth = await fixture();
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => {
      const result = data(today);
      result.input.daily = [{ metric: "distance_km", provider: "apple", value: 7, date: today }];
      return { ...result, distanceArtUrl };
    });
    const { candidates, setRevision } = await readHealthWins(auth, { signal });
    const card = candidates.find(item => item.kind === "cumulative")!;
    const expectedArt = distanceArtUrl ? { art: { url: distanceArtUrl } } : {};
    expect(card.chart).toEqual({ type: "map", days: 1, series: expect.any(Array), totalMiles: expect.any(Number), ...expectedArt });
    const selection = { candidateId: card.id, option: "original" };
    const { cards } = await resolveHealthCards(auth, setRevision, [selection]);
    expect(cards[0]).toMatchObject({ specRevision: card.specRevision, spec: { chart: card.chart } });
    const hidden = await changeHealthWin(auth, { setRevision, ...selection, option: "hide_numbers" });
    expect(hidden.card.chart).toEqual({ type: "hidden" });
  });

  it("serves one distance trend in the requested units and freezes the selected display", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2034-07-24T12:00:00Z"));
    const auth = await fixture(7);
    enableWinTexts(auth.member.id);
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => distanceHistory(today));
    const metric = await readHealthWins(auth, { signal, units: "metric" });
    const us = await readHealthWins(auth, { signal, units: "us" });
    expect(await readHealthWins(auth, { signal, units: "uk" })).toEqual(us);
    expect(source).toHaveBeenCalledTimes(1);
    expect(us.setRevision).toBe(metric.setRevision);
    expect(us.candidates.map(card => card.kind)).toEqual(metric.candidates.map(card => card.kind));
    const km = metric.candidates.find(card => card.kind === "trend_change")!;
    const mi = us.candidates.find(card => card.kind === "trend_change")!;
    expect(km.chart).toMatchObject({ unit: "km", pills: ["Usual 3.8 km", "Jul 5.3 km"] });
    expect(mi.id).not.toBe(km.id);
    expect(mi.winRef).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(km.winRef).toBe(mi.winRef);
    expect(mi).toMatchObject({ title: { number: "+1 mi" }, chart: { unit: "mi",
      baseline: expect.closeTo(2.34), delta: expect.closeTo(0.94), pills: ["Usual 2.3 mi", "Jul 3.3 mi"],
      series: [2.34, 2.34, 2.34, 3.28].map(value => ({ value: expect.closeTo(value) })),
    } });
    for (const card of [km, mi]) {
      const selection = { candidateId: card.id, option: "original" };
      const changed = await changeHealthWin(auth, { ...selection, setRevision: us.setRevision });
      expect({ ...changed.card, winRef: mi.winRef }).toEqual(card);
      expect((await resolveHealthCards(auth, us.setRevision, [selection])).cards[0]).toMatchObject({
        id: card.id, specRevision: card.specRevision, spec: { title: card.title, chart: card.chart },
      });
    }
    await expect(resolveHealthCards(auth, us.setRevision, [km, mi].map(card => ({ candidateId: card.id, option: "original" }))))
      .rejects.toMatchObject({ httpStatus: 400 });

    vi.setSystemTime(new Date("2034-07-25T12:00:00Z"));
    source.mockImplementation(incompleteInputs);
    expect(await readHealthWins(auth, { signal, units: "metric" })).toEqual(metric);
    expect(await readHealthWins(auth, { signal })).toEqual(us);
    await createHealthPost(auth, { id: randomUUID(), setRevision: us.setRevision, cards: [{ candidateId: mi.id, option: "original" }] });
    expect((await readHealthWins(auth, { signal })).candidates).not.toContainEqual(mi);
    expect(await readHealthWins(auth, { signal, units: "metric" })).toEqual(metric);
  });

  it("hides the posted See yours distance display and restores it when the frozen card is removed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const today = "2034-07-24";
    vi.setSystemTime(new Date(`${today}T12:00:00Z`));
    const auth = await fixture();
    const history = distanceHistory(today);
    source.mockResolvedValue(history);
    measureSource.mockResolvedValue({ input: history.input, observed: true });
    const metric = await readHealthWins(auth, { signal, units: "metric" });
    const us = await readHealthWins(auth, { signal, units: "us" });
    const spec = seeYoursCard(history.input, "distance_km", "trend_change")!;
    const preview = cardOptions.previewRecordedCandidate(cardOptions.prepareSeeYoursCandidate(auth.member.id, spec, "us"));
    expect(us.candidates.find(card => card.kind === "trend_change")?.id).toBe(preview.id);
    const post = await createHealthPost(auth, { id: randomUUID(), caption: "An afternoon walk.",
      cards: [{ candidateId: preview.candidateId, option: "original", specRevision: preview.specRevision }] }, "us");
    expect((await readHealthWins(auth, { signal, units: "us" })).candidates).toEqual(us.candidates.filter(card => card.id !== preview.id));
    expect(await readHealthWins(auth, { signal, units: "metric" })).toEqual(metric);
    await patchHealthPost(auth, post.id, { expectedVersion: post.version, removeCardIds: [preview.id] });
    expect(await readHealthWins(auth, { signal, units: "us" })).toEqual(us);
    expect(source).toHaveBeenCalledTimes(1);
    expect(measureSource).toHaveBeenCalledTimes(1);
  });

  it("prevents a slower computation from replacing a newer publication", async () => {
    const auth = await fixture();
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    source.mockImplementationOnce(async (_memberId, _checkAuthority, today: string) => {
      markStarted();
      await finish;
      return data(today, 31);
    }).mockImplementationOnce(async (_memberId, _checkAuthority, today: string) => data(today, 48));
    const slow = readHealthWins(auth, { signal });
    await started;
    try {
      const fast = await readHealthWins(auth, { signal });
      release();
      expect(await slow).toEqual(fast);
      expect(fast.candidates[0].title.number).toBe("48");
      expect(await db.healthWinSet.count({ where: { memberId: auth.member.id } })).toBe(1);
    } finally {
      release();
    }
  });

  it.each([
    { visits: "consecutive", utcDays: [12, 13, 14, 15], westDay: "2031-06-14" },
    { visits: "sparse", utcDays: [1, 5, 14, 15], westDay: "2031-06-06" },
  ])("retains three $visits days for one- and two-day timezone reversals", async ({ utcDays, westDay }) => {
    const auth = await publishEasternHistory(utcDays), memberId = auth.member.id;
    const stored = await db.healthWinSet.findMany({ where: { memberId }, orderBy: { day: "asc" }, select: { day: true } });
    expect(stored.map(row => row.day)).toEqual([westDay, "2031-06-15", "2031-06-16"]);

    source.mockImplementation(incompleteInputs);
    for (const [timeZone, day] of [["UTC", "2031-06-15"], ["Etc/GMT+12", westDay]]) {
      await db.gameProfile.update({ where: { memberId }, data: { timeZone } });
      expect(await readHealthWins(auth, { signal })).toMatchObject({ day });
    }
  });

  it("rolls back a post prepared from a fallback that a concurrent publication prunes", async () => {
    const auth = await publishEasternHistory([5, 14, 15]), memberId = auth.member.id;
    await db.gameProfile.update({ where: { memberId }, data: { timeZone: "Etc/GMT+12" } });
    source.mockImplementationOnce(incompleteInputs);
    const fallback = await readHealthWins(auth, { signal });
    expect(fallback.day).toBe("2031-06-06");
    const post = { id: randomUUID(), setRevision: fallback.setRevision,
      cards: [{ candidateId: fallback.candidates[0].id, option: "original" }] };
    const receipt = await createHealthPost(auth, post);

    // Finish the local day's set after the fallback cards are frozen, before the post transaction.
    const seal = crypto.sealHealthTexts;
    vi.spyOn(crypto, "sealHealthTexts").mockImplementationOnce(async (...args) => {
      const encrypted = await seal(...args);
      expect((await readHealthWins(auth, { signal })).day).toBe("2031-06-14");
      return encrypted;
    });
    const id = randomUUID();
    await expect(createHealthPost(auth, { ...post, id })).rejects.toMatchObject({ httpStatus: 409, code: "HEALTH_WIN_SET_CHANGED" });
    expect(await db.healthPost.count({ where: { id } })).toBe(0);
    expect(await db.healthWinSet.count({ where: { memberId, day: fallback.day } })).toBe(0);
    expect(await createHealthPost(auth, post)).toEqual(receipt);
  });

  it("returns the last good day on timeout and rejects it after the next day's set arrives", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    const first = await readHealthWins(auth, { signal });
    const previousDay = "2008-03-14";
    await db.healthWinSet.update({ where: { memberId_day: { memberId, day: first.day } }, data: { day: previousDay } });

    const deadline = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 8_000 ? deadline.signal : nativeTimeout(ms));
    source.mockImplementationOnce(async (_memberId, _checkAuthority, _today: string, sourceSignal: AbortSignal) => {
      deadline.abort(new DOMException("Fixture deadline", "TimeoutError"));
      sourceSignal.throwIfAborted();
    });
    const fallback = await readHealthWins(auth, { signal });
    expect(fallback.day).toBe(previousDay);
    expect(fallback.setRevision).toBe(first.setRevision);
    await db.$transaction(tx => assertHealthSetCurrent(tx, memberId, previousDay, fallback.setRevision));

    vi.restoreAllMocks();
    const current = await readHealthWins(auth, { signal });
    expect(current.day).toBe(first.day);
    await expect(db.$transaction(tx => assertHealthSetCurrent(tx, memberId, previousDay, fallback.setRevision)))
      .rejects.toMatchObject({ httpStatus: 409 });
  });

  it.each([false, true])("checks authority after a cold-cache timeout (withdrawn=%s)", async withdrawn => {
    const auth = await fixture(), memberId = auth.member.id;
    const deadline = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 8_000 ? deadline.signal : nativeTimeout(ms));
    source.mockImplementationOnce(async (_memberId, _checkAuthority, _today: string, sourceSignal: AbortSignal) => {
      if (withdrawn) await revokeHostedConsentScope({ memberId, prisma: db, scope: "launch.health-data" });
      deadline.abort(new DOMException("Fixture deadline", "TimeoutError"));
      sourceSignal.throwIfAborted();
    });
    await expect(readHealthWins(auth, { signal })).rejects.toMatchObject(withdrawn
      ? { httpStatus: 403, code: "HOSTED_CONSENT_REQUIRED" }
      : { httpStatus: 503, code: "HEALTH_WINS_UNAVAILABLE", retryable: true });
    expect(await db.healthWinSet.count({ where: { memberId } })).toBe(0);
  });

  it("serves a warm set while the member and session rows are locked, then rejects a revoked session", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    const warm = await readHealthWins(auth, { signal });
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${memberId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hosted_auth_record WHERE model = 'session' AND id = ${auth.sessionId} FOR UPDATE`;
      expect(await readHealthWins(auth, { signal })).toEqual(warm);
    });
    await db.hostedAuthRecord.delete({ where: { model_id: { model: "session", id: auth.sessionId } } });
    await expect(readHealthWins(auth, { signal })).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("refuses a warm set when health consent is lost during decryption", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_memberId, _checkAuthority, today: string) => data(today));
    await readHealthWins(auth, { signal });
    const open = crypto.openHealthTexts;
    vi.spyOn(crypto, "openHealthTexts").mockImplementationOnce(async (...args) => {
      const result = await open(...args);
      await revokeHostedConsentScope({ memberId, prisma: db, scope: "launch.health-data" });
      return result;
    });
    await expect(readHealthWins(auth, { signal })).rejects.toMatchObject({ httpStatus: 403 });
  });
});
