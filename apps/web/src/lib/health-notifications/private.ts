import "server-only";
import { Prisma } from "@prisma/client";
import { resolveFloatingIsoTimestampInTimeZone, toLocalDayKey } from "@murphai/contracts";
import type { ClientUnits } from "../companion/client-info";
import { openProgressMany } from "../game/progress/crypto";
import type { Candidate } from "../game/progress/registry";
import { healthCandidateDisplay, healthCandidateDisplayIds, withDistanceTrendUnits } from "../health-wins/card-options";
import { isPersonalMilestone, milestoneCard } from "../health-wins/milestones";
import { postedCardKeys } from "../health-wins/posted-card-keys";
import { openCachedHealthCandidates } from "../health-wins/wins";
import { cachedAgeChange } from "../health-you/read";
import { getPrisma } from "../prisma";

export interface OwnEvent {
  kind: "winReady" | "milestone" | "ageChange";
  key: string;
  eventId?: string;
  otherDisplayIds?: string[];
  at: Date;
  text: string;
  art?: string;
  seen?: boolean;
}

function midnight(date: string, zone: string) {
  const instant = resolveFloatingIsoTimestampInTimeZone(date + "T00:00:00", zone);
  return instant ? new Date(instant.timestamp) : null;
}

function readyWins(cached: Awaited<ReturnType<typeof openCachedHealthCandidates>>, createdAt: Date, units: ClientUnits,
  from: Date, now: Date, countOnly: boolean) {
  const events: OwnEvent[] = [];
  for (const entry of cached) {
    const candidate = countOnly ? entry : withDistanceTrendUnits(entry);
    const display = healthCandidateDisplay(candidate, units);
    const card = display.variants[0].spec;
    if (card.kind === "milestone") continue;
    const at = candidate.readyAt ? new Date(candidate.readyAt) : createdAt;
    if (at && at >= from && at <= now) events.push({ kind: "winReady", key: display.id, eventId: candidate.id, at,
      otherDisplayIds: healthCandidateDisplayIds(entry),
      text: countOnly ? "" : `have a win ready to post: ${[card.title.number, card.title.measure].filter(Boolean).join(" ")}` });
  }
  return events;
}

export async function ownEvents(memberId: string, zone: string, from: Date, now: Date, signal: AbortSignal, units: ClientUnits, countOnly: boolean) {
  const db = getPrisma(), today = toLocalDayKey(now, zone);
  const [set, awards, age] = await Promise.all([
    db.healthWinSet.findFirst({ where: { memberId, day: { lte: today }, createdAt: { gte: from } }, orderBy: { day: "desc" } }),
    db.gameProgressAward.findMany({ where: { memberId, subjectMemberId: null,
      earnedOn: { gte: new Date(toLocalDayKey(from, zone)), lte: new Date(today) } },
      orderBy: [{ earnedOn: "desc" }, { createdAt: "desc" }, { lookup: "desc" }], take: 99 }),
    cachedAgeChange(memberId, signal),
  ]);
  const [cached, opened] = await Promise.all([
    set ? openCachedHealthCandidates(set, signal) : [],
    openProgressMany<Candidate>(awards.map(row => ({ memberId, table: "game_progress_award", rowId: row.lookup,
      field: "data", value: row.dataEncrypted })), false, signal),
  ]);
  const events = set ? readyWins(cached, set.createdAt, units, from, now, countOnly) : [];
  for (const [i, row] of awards.entries()) {
    const award = { ...opened[i], id: row.lookup, on: row.earnedOn.toISOString().slice(0, 10), seenAt: row.seenAt, createdAt: row.createdAt };
    if (!isPersonalMilestone(award)) continue;
    const card = countOnly ? null : milestoneCard(award);
    const at = row.createdAt;
    if (at && at >= from && at <= now) events.push({ kind: "milestone", key: `milestone:${row.lookup}`, at,
      text: card ? `earned ${card.title.measure}.` : "", seen: row.seenAt !== null, art: card?.chart.type === "medal" ? card.chart.art : undefined });
  }
  const keys = postedCardKeys(memberId, events.flatMap(e => e.otherDisplayIds ?? [e.key]));
  const posted = keys.size ? await db.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT k AS key FROM health_post p CROSS JOIN LATERAL unnest(p.posted_card_keys) k
    WHERE p.author_member_id = ${memberId} AND p.deleted_at IS NULL AND p.posted_card_keys && ${[...keys.values()]}::text[]
      AND k IN (${Prisma.join([...keys.values()])})` : [];
  const used = new Set(posted.map(row => row.key));
  const results = events.filter(event => {
    return (event.otherDisplayIds ?? [event.key]).every(id => {
      const key = keys.get(id);
      return key !== undefined && !used.has(key);
    });
  });
  if (age) {
    const at = midnight(age.date, age.timeZone);
    if (at && at >= from && at <= now) results.push({ kind: "ageChange", key: age.date, at,
      text: `biological age moved ${(Math.abs(age.tenths) / 10).toFixed(1)} years ${age.tenths < 0 ? "lower" : "higher"} this week.` });
  }
  return results;
}
