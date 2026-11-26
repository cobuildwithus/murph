import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostedNativeMemberAuth } from "../src/lib/better-auth/native-auth";
import { authLookupKey } from "../src/lib/better-auth/record-crypto";
import { getPrisma } from "../src/lib/prisma";
import { recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from "../src/lib/legal/consent";
import { assertHealthSetCurrent, changeHealthWin, readHealthWins, resolveHealthCards } from "../src/lib/health-wins/wins";
import * as crypto from "../src/lib/health-wins/crypto";
import type { HealthWinsInput } from "../src/lib/health-wins/engine";

const source = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/health-wins/inputs", () => ({ readHealthWinInputs: source }));
vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
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

async function fixture(): Promise<HostedNativeMemberAuth> {
  const memberId = randomUUID(), credential = randomUUID(), now = new Date();
  members.push(memberId);
  const member = await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const row = await db.hostedAuthRecord.create({ data: { model: "session", id: randomUUID(), memberId,
    createdAt: now, updatedAt: now, expiresAt, payloadEncrypted: "fixture-session" } });
  await db.gameProfile.create({ data: { memberId, firstNameEncrypted: "fixture-name", timeZone: "UTC" } });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: db });
  }
  return { kind: "better-auth", member, credential, sessionId: row.id,
    proof: { row, expiresAt, credentialDigest: createHash("sha256").update(credential).digest() } };
}

describe.skipIf(!enabled)("member-local health win sets", () => {
  afterEach(async () => {
    source.mockReset();
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });

  it("serves one stable set within the hour, freezes the selected option, and conflicts after replacement", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_auth, today: string) => data(today));
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
    source.mockImplementation(async (_auth, today: string) => data(today, 39, false));
    const replacement = await readHealthWins(auth, { signal });
    expect(replacement.candidates[0].title.number).toBe("39");
    expect(replacement.setRevision).not.toBe(first.setRevision);
    await expect(db.$transaction(tx => assertHealthSetCurrent(tx, memberId, prepared.day, first.setRevision))).rejects.toMatchObject({ httpStatus: 409 });
    await expect(resolveHealthCards(auth, first.setRevision, [{ candidateId, option: "original" }])).rejects.toMatchObject({ httpStatus: 409 });
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
    source.mockImplementation(async (_auth, today: string) => data(today, total));
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
    source.mockImplementation(async (_auth, today: string) => {
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

  it("prevents a slower computation from replacing a newer publication", async () => {
    const auth = await fixture();
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    source.mockImplementationOnce(async (_auth, today: string) => {
      markStarted();
      await finish;
      return data(today, 31);
    }).mockImplementationOnce(async (_auth, today: string) => data(today, 48));
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

  it("returns the last good day on timeout and rejects it after the next day's set arrives", async () => {
    const auth = await fixture(), memberId = auth.member.id;
    source.mockImplementation(async (_auth, today: string) => data(today));
    const first = await readHealthWins(auth, { signal });
    const previousDay = "2008-03-14";
    await db.healthWinSet.update({ where: { memberId_day: { memberId, day: first.day } }, data: { day: previousDay } });

    const deadline = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 8_000 ? deadline.signal : nativeTimeout(ms));
    source.mockImplementationOnce(async (_auth, _today: string, sourceSignal: AbortSignal) => {
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
    source.mockImplementationOnce(async (_auth, _today: string, sourceSignal: AbortSignal) => {
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
    source.mockImplementation(async (_auth, today: string) => data(today));
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
    source.mockImplementation(async (_auth, today: string) => data(today));
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
