import "server-only";
import { toLocalDayKey } from "@murphai/contracts";
import { resolveMetricDefinition } from "@murphai/health-metrics";
import * as z from "@murphai/contracts/zod-runtime";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { loadPublishedCompanionMetricReplica } from "../device-sync/companion-numbers";
import type { HostedGroupBoardProjection } from "../hosted-groups/group-store";
import type { PairBoard } from "../game/board-numbers";
import { assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameNotFound, invalidGameRequest } from "../game/http/errors";
import { profileFactorLookupKeys } from "../hosted-onboarding/contact-privacy-core";
import { readWorkingSelections } from "./storage";
import { withInputAuthority } from "../health-wins/inputs";
import { retainedDailySamples, WIN_METRIC_KEYS } from "../health-wins/wearable-inputs";
import { localToday } from "../health-wins/wins";
import { getPrisma } from "../prisma";
import { lastSettledStepDay } from "../settled-step-day";
import { addDays } from "../game/time";
import { assertProfileAccess, withProfileWrite, type ProfileAuth } from "./access";
import { bedtimePoint, dailyReading, formatReading, factorInfo, factors, workingRow, type Factor, type Reading } from "./factors";

const sleepTiming = z.array(z.object({ date: z.iso.date(), startAt: z.iso.datetime({ offset: true }), timeZone: z.string() })).max(366);

async function ownReadings(memberId: string, timeZone: string, selected: readonly Factor[], signal: AbortSignal, checkAuthority: () => Promise<void>) {
  const today = toLocalDayKey(new Date(), timeZone);
  return withInputAuthority(checkAuthority, async () => {
    const metrics = selected.flatMap(f => factorInfo[f].metric ?? []);
    const replica = await loadPublishedCompanionMetricReplica({ memberId, signal, metricKeys: metrics.map(m => WIN_METRIC_KEYS[m]),
      requestedShards: ["core", "metricsIndex"], timeoutMs: 6000 });
    const readings = new Map<Factor, Reading>();
    if (replica.state === "not_ready") throw Error("Profile measurements temporarily unavailable.");
    if (replica.state !== "ready") return readings;
    for (const f of selected) {
      const metric = factorInfo[f].metric;
      if (!metric) {
        const core = replica.client.replica;
        const nights = "sleepTiming" in core && sleepTiming.safeParse(core.sleepTiming);
        if (nights && nights.success) readings.set(f, dailyReading(nights.data.map(n => bedtimePoint(n.date, n.startAt, n.timeZone)), today));
        continue;
      }
      if (!("metrics" in replica.client)) throw Error("Missing profile metrics.");
      const key = WIN_METRIC_KEYS[metric];
      const rows = replica.client.metrics.series({ metricKey: key, from: addDays(today, -89),
        to: f === "steps" ? lastSettledStepDay(new Date(), timeZone) : today, grain: "day" });
      readings.set(f, dailyReading(retainedDailySamples(metric, rows).map(({ date, value }) => ({ date, value })), today,
        f === "cardioFitness" ? resolveMetricDefinition(key)?.selectionPolicy.staleAfterDays ?? 7 : 7));
    }
    return readings;
  });
}

export async function workingOptions(auth: ProfileAuth, signal: AbortSignal) {
  const profile = await getPrisma().gameProfile.findUniqueOrThrow({ where: { memberId: auth.member.id }, select: { timeZone: true } });
  const readings = await ownReadings(auth.member.id, profile.timeZone, factors, signal,
    () => getPrisma().$transaction(tx => assertProfileAccess(tx, auth, auth.member.id)));
  return { options: factors.filter(f => readings.get(f)?.state === "available").map(factor => ({
    factor, title: factorInfo[factor].title, icon: factorInfo[factor].icon,
  })) };
}

export async function setWorking(auth: ProfileAuth, selected: Factor[], signal: AbortSignal) {
  const memberId = auth.member.id;
  const previous = await readWorkingSelections(memberId);
  const options = selected.some(f => !previous.some(row => row.factor === f)) ? (await workingOptions(auth, signal)).options : [];
  await withProfileWrite(auth, async (tx, profile) => {
    const current = await tx.healthWorkingOn.findMany({ where: { memberId }, take: 3 });
    const keys = selected.map(f => {
      const keys = profileFactorLookupKeys(memberId, f);
      return current.find(row => keys.candidates.includes(row.factor))?.factor ?? keys.current;
    });
    if (selected.some((f, i) => !current.some(row => row.factor === keys[i]) && !options.some(o => o.factor === f))) {
      throw invalidGameRequest("Choose a metric from your current options.");
    }
    await tx.healthWorkingOn.deleteMany({ where: { memberId, factor: { notIn: keys } } });
    for (const [position, factor] of keys.entries()) {
      const where = { memberId, factor };
      if (current.some(r => r.factor === factor)) await tx.healthWorkingOn.update({ where: { memberId_factor: where }, data: { position } });
      else await tx.healthWorkingOn.create({ data: { ...where, position, since: localToday(profile) } });
    }
  });
}

export async function profileWorking(auth: ProfileAuth, owner: string, zone: string, board: PairBoard | null, signal: AbortSignal,
  items: Awaited<ReturnType<typeof readWorkingSelections>>, bedtime?: HostedGroupBoardProjection) {
  if (!items.length) return [];
  const today = toLocalDayKey(new Date(), zone), viewer = auth.member.id;
  const own = owner === viewer ? await ownReadings(owner, zone, items.map(i => i.factor), signal,
    () => getPrisma().$transaction(tx => assertProfileAccess(tx, auth, owner))) : null;
  const person = board?.people.find(p => p.memberId === owner);
  return items.map(({ factor, since, cheered }) => {
    const metric = factorInfo[factor].board;
    let reading: Reading = own ? own.get(factor) ?? { state: "pending" }
      : (metric && person?.numbers[metric]) || { state: "not_shared" };
    if (!own && factor === "bedtime" && bedtime && bedtime.state !== "not_granted") {
      const byDay = new Map<string, ReturnType<typeof bedtimePoint>>();
      for (const { data } of bedtime.records) {
        if ("sleepStartAt" in data && !byDay.has(data.date)) byDay.set(data.date, bedtimePoint(data.date, data.sleepStartAt, zone));
      }
      reading = dailyReading([...byDay.values()], today);
    }
    return workingRow(factor, since, today, reading, cheered);
  });
}

export async function setWorkingCheer(auth: ProfileAuth, ownerId: string, factor: Factor, enabled: boolean) {
  const memberId = auth.member.id;
  if (ownerId === memberId) throw gameNotFound();
  const { candidates } = profileFactorLookupKeys(ownerId, factor);
  await getPrisma().$transaction(async tx => {
    if (!enabled) {
      await assertGameMemberAuthCurrentTx(auth, tx);
      await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
      const removed = await tx.healthWorkingOnCheer.deleteMany({ where: { memberId, ownerId, factor: { in: candidates } } });
      if (removed.count) return;
    }
    await assertProfileAccess(tx, auth, ownerId, true);
    const rows = await tx.$queryRaw<{ factor: string }[]>`SELECT factor FROM health_working_on WHERE member_id = ${ownerId} AND factor = ANY(${candidates}::text[]) FOR SHARE`;
    if (!rows.length) throw gameNotFound();
    if (enabled) await tx.healthWorkingOnCheer.createMany({ data: [{ memberId, ownerId, factor: rows[0].factor }], skipDuplicates: true });
  });
  return { cheered: enabled };
}

/** Private S1 this-week rows. The caller owns native session admission. */
export async function listWorkingOn(memberId: string) {
  const db = getPrisma();
  const check = () => assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  await check();
  const items = await readWorkingSelections(memberId);
  if (!items.length) return [];
  const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId }, select: { timeZone: true } });
  const readings = await ownReadings(memberId, profile.timeZone, items.map(i => i.factor), AbortSignal.timeout(6000), check);
  const today = localToday(profile);
  return items.flatMap(({ factor, since }) => {
    const row = workingRow(factor, since, today, readings.get(factor) ?? { state: "pending" }, false);
    const latest = row.series?.at(-1);
    return latest ? [{ kind: "workingOn" as const, factor, title: row.title, icon: factorInfo[factor].icon,
      text: formatReading(factor, latest.value), change: row.change || null }] : [];
  });
}
