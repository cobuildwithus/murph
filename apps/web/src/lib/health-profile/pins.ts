import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type HealthProfilePin } from "@prisma/client";
import type { ClientUnits } from "../companion/client-info";
import { addDays } from "../game/time";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { sealHealthTexts } from "../health-wins/crypto";
import { pinTarget, storedPins, type Selector } from "./storage";
import { assertHealthSetCurrent, localToday, readHealthWins, resolveHealthCards } from "../health-wins/wins";
import { postedCardKeys } from "../health-wins/posted-card-keys";
import { getPrisma } from "../prisma";
import { assertProfileAccess, withProfileWrite, type ProfileAuth } from "./access";
import { profileAge } from "./age";
import { currentStreakRevisions, readProfileStreaks } from "./streaks";

type Streak = Awaited<ReturnType<typeof readProfileStreaks>>[number];
type Pick = { key: string; revision: string; option?: string };
const changed = () => hostedOnboardingError({ code: "HEALTH_PIN_CHANGED", httpStatus: 409, message: "Your cards changed. Choose again." });
const streakKey = (member: string, game: string) => createHostedOpaqueIdentifier("profile-streak", JSON.stringify([member, game]))!;
const savedRevision = (row: HealthProfilePin) => "saved:" + createHash("sha256").update(row.specEncrypted).digest("hex");

function streakCard(key: string, { row, monday }: Streak) {
  return { id: key, kind: "game_streak", filter: "Challenges", theme: "challenges",
    title: { number: String(row.count), measure: "days" }, subtitle: row.title, source_note: "",
    chart: { type: "week_dots", days: row.count, start: monday, end: addDays(monday, 6), missedOn: null,
      marks: row.days, calendar: row.days.map((mark, i) => ({ date: addDays(monday, i),
        state: mark === "done" ? "posted" : mark === "missed" ? "missed" : "no_game" })) }, share: { caption_tips: [] } } as const;
}
function ageCard(value: number, gap: number) {
  return { id: "age", kind: "biological_age", filter: "Fitness", theme: "age",
    title: { number: value.toFixed(1), measure: "years" }, subtitle: "Biological age", source_note: "",
    chart: { type: "biological_age", value, gap }, share: { caption_tips: [] } } as const;
}
function filter(card: { filter: string; kind: string }) {
  switch (card.filter) {
    case "Heart": return "heart";
    case "Sleep": return "sleep";
    case "Labs": return "labs";
    default: return card.kind === "game_streak" ? "streaks" : "bests";
  }
}

export async function publishedPins(memberId: string, pins: Awaited<ReturnType<typeof storedPins>>, ownStreaks?: Streak[]) {
  const ids = pins.flatMap(({ stored }) => stored.kind === "streak" ? [stored.gameId] : []);
  const streaks = ownStreaks ?? (ids.length ? await readProfileStreaks(memberId, memberId, ids, false) : []);
  const age = pins.some(({ stored }) => stored.kind === "age") && await profileAge.read(memberId);
  return pins.map(({ row, stored }) => {
    const key = row.sourceKey;
    if (stored.kind === "milestone") return { key, revision: savedRevision(row), card: stored.card, pinnedOn: stored.pinnedOn };
    if (stored.kind === "age") return age ? { key, revision: age.revision, card: ageCard(age.value, age.gap) } : null;
    const streak = streaks.find(s => s.row.gameId === stored.gameId);
    return streak ? { key, revision: streak.revision, card: streakCard(key, streak) } : null;
  }).filter(pin => pin !== null);
}

async function offered(auth: ProfileAuth, signal: AbortSignal, units: ClientUnits) {
  const owner = auth.member.id;
  await assertProfileAccess(getPrisma(), auth, owner);
  const wins = await readHealthWins(auth, { signal, units }).catch(error => {
    if (error?.code === "HEALTH_WINS_UNAVAILABLE") return { candidates: [], setRevision: null };
    throw error;
  });
  const streaks = await readProfileStreaks(owner, owner, undefined, false);
  const age = await profileAge.read(owner);
  const pins = await storedPins(owner);
  const liveKey = (gameId: string) => pins.find(p => p.stored.kind === "streak" && p.stored.gameId === gameId)?.row.sourceKey ?? streakKey(owner, gameId);
  const offered = [
    // Profile streaks identify a current game. The feed also offers a historical all-games best.
    ...wins.candidates.filter(card => card.kind !== "game_streak").map(card => ({ key: card.id, revision: wins.setRevision!, card, filter: filter(card) })),
    ...streaks.map(s => { const key = liveKey(s.row.gameId);
      return { key, revision: s.revision, card: streakCard(key, s), filter: "streaks" }; }),
    ...(age ? [{ key: "age", revision: age.revision, card: ageCard(age.value, age.gap), filter: "age" }] : []),
  ];
  // A frozen milestone remains selectable for reorder even after its candidate disappears.
  const retained = pins.flatMap(({ row, stored }) => stored.kind === "milestone" ? [{
    key: row.sourceKey, revision: savedRevision(row), card: stored.card, filter: filter(stored.card), pinnedOn: stored.pinnedOn,
  }] : []);
  const candidates = [...offered.filter(c => !retained.some(r => r.key === c.key)), ...retained];
  await assertProfileAccess(getPrisma(), auth, owner);
  return { wins, streaks, age, pins, candidates, liveKey };
}

export async function pinCandidates(auth: ProfileAuth, signal: AbortSignal, units: ClientUnits) {
  const { pins, candidates } = await offered(auth, signal, units);
  return { candidates, pinned: pins.map(p => p.row.sourceKey) };
}

export async function setPins(auth: ProfileAuth, picks: Pick[], signal: AbortSignal, units: ClientUnits) {
  const owner = auth.member.id;
  if (!picks.length) return withProfileWrite(auth, tx => tx.healthProfilePin.deleteMany({ where: { memberId: owner } }));
  const { wins, streaks, candidates, pins, age, liveKey } = await offered(auth, signal, units);
  const winPicks = picks.filter(p => p.revision === wins.setRevision);
  const frozen = wins.setRevision && winPicks.length ? await resolveHealthCards(auth, wins.setRevision,
    winPicks.map(p => ({ candidateId: p.key, option: p.option ?? "original" }))) : null;
  const newStreaks: Streak[] = [];
  const profile = await getPrisma().gameProfile.findUnique({ where: { memberId: owner }, select: { timeZone: true } });
  const pinnedOn = localToday(profile);
  const selections = picks.map((p): Selector => {
    if (!candidates.some(c => c.key === p.key && c.revision === p.revision)) throw changed();
    const card = frozen?.cards.find(c => c.id === p.key);
    if (card) return { kind: "milestone", card: card.spec, pinnedOn };
    if (p.option && p.option !== "original") throw changed();
    const kept = pins.find(item => item.row.sourceKey === p.key && savedRevision(item.row) === p.revision);
    if (kept) return kept.stored;
    if (age && p.key === "age" && p.revision === age.revision) return { kind: "age" };
    const streak = streaks.find(s => liveKey(s.row.gameId) === p.key && s.revision === p.revision);
    if (!streak) throw changed();
    newStreaks.push(streak);
    return { kind: "streak", gameId: streak.row.gameId };
  });
  const sealed = await sealHealthTexts(selections.map((s, i) => ({ ...pinTarget(owner, picks[i].key), value: JSON.stringify(s) })), signal);
  await withProfileWrite(auth, async (tx, currentProfile) => {
    if (frozen && wins.setRevision) {
      if (localToday(currentProfile) !== pinnedOn) throw changed();
      await assertHealthSetCurrent(tx, owner, frozen.day, wins.setRevision);
      const keys = [...postedCardKeys(owner, winPicks.map(p => p.key)).values()];
      if (keys.length && await tx.healthPost.findFirst({ where: { authorMemberId: owner, deletedAt: null,
        postedCardKeys: { hasSome: keys } }, select: { id: true } })) throw changed();
    }
    const ids = newStreaks.map(s => s.row.gameId).sort();
    if (ids.length) {
      await tx.$queryRaw`SELECT id FROM game WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
      const revisions = await currentStreakRevisions(tx, owner, owner, ids);
      if (newStreaks.some(s => revisions.get(s.row.gameId) !== s.revision)) throw changed();
    }
    if (age && picks.some(p => p.key === "age") && !await profileAge.current(tx, owner, age)) throw changed();
    const current = await tx.healthProfilePin.findMany({ where: { memberId: owner }, take: 3 });
    if (picks.some(p => p.revision.startsWith("saved:") && !current.some(r => r.sourceKey === p.key && savedRevision(r) === p.revision))) throw changed();
    await tx.healthProfilePin.deleteMany({ where: { memberId: owner } });
    await tx.healthProfilePin.createMany({ data: selections.map((s, i) => {
      const kept = current.find(r => r.sourceKey === picks[i].key && savedRevision(r) === picks[i].revision);
      return { memberId: owner, position: i, sourceKind: s.kind, sourceKey: picks[i].key,
        specEncrypted: kept?.specEncrypted ?? sealed[i], refreshedAt: kept?.refreshedAt };
    }) });
  });
}
