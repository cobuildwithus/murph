import "server-only";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { openGameTexts } from "../game/crypto";
import { dayIndexAt, effectiveTermWords, eligibleFromDay, isScheduledDay, parseStoredTerms, parseTermWords,
  playerStreak, termsForDay, type RuleState } from "../game/rules";
import { addDays, daysBetween, gameLocalDate, weekdayOf } from "../game/time";
import { gameMediaUrl } from "../game/views";
import { readNamesForViewer } from "../game/viewer-names";
import { getPrisma } from "../prisma";
import type { ProfileDb } from "./access";

const activeSeat = { joinedAt: { not: null }, leftAt: null };
export type DayMark = "done" | "missed" | "todo" | "none";

async function streakFacts(db: ProfileDb, owner: string, viewer: string, gameIds?: string[]) {
  const games = await db.game.findMany({
    where: { status: "live", id: gameIds && { in: gameIds }, AND: [...new Set([owner, viewer])].map(memberId => ({
      players: { some: { memberId, ...activeSeat } },
    })) },
    take: 64, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, createdBy: true, maxPlayers: true, lengthDays: true, terms: true, wordsOwnerMemberId: true,
      termsWordsEncrypted: true, devClockOffsetMs: true, startsOn: true,
      players: { where: activeSeat, take: 10, orderBy: { seat: "asc" },
        select: { seat: true, memberId: true, dayOne: true, joinedAt: true, timeZone: true } } },
  });
  const entries = games.length ? await db.gameEntry.groupBy({
    where: { gameId: { in: games.map(game => game.id) }, memberId: { in: [owner, viewer] },
      attempt: { gt: 0 }, OR: [{ incomplete: false }, { incomplete: null }], withdrawnAt: null },
    by: ["gameId", "memberId", "dayIndex"], orderBy: [{ gameId: "asc" }, { memberId: "asc" }, { dayIndex: "asc" }],
    take: 8193,
  }) : [];
  if (entries.length > 8192) throw Error("Profile streak history exceeds the read budget.");
  return games.map(game => {
    const now = new Date(Date.now() + Number(game.devClockOffsetMs ?? 0));
    const players = game.players.flatMap(p => p.memberId && p.timeZone && p.dayOne
      ? [{ ...p, memberId: p.memberId, timeZone: p.timeZone, dayOne: p.dayOne.toISOString().slice(0, 10) }] : []);
    const state: RuleState = { game: { id: game.id, seats: game.maxPlayers, createdBy: game.createdBy, status: "live",
      startsOn: game.startsOn?.toISOString().slice(0,10) ?? null, lengthDays: game.lengthDays,
      terms: parseStoredTerms(game.terms), inviteExpiresAt: null }, players, entries: [] };
    const member = players.find(p => p.memberId === owner);
    if (!member) return null;
    const today = gameLocalDate(now, member.timeZone);
    const monday = addDays(today, -weekdayOf(today));
    const completed = (id: string) => new Set(entries.filter(e => e.gameId === game.id && e.memberId === id).map(e => e.dayIndex));
    const done = completed(owner);
    const dayIndex = dayIndexAt(member, now)!;
    const days = Array.from({ length: 7 }, (_, i): DayMark => {
      const index = daysBetween(member.dayOne, addDays(monday, i));
      if (index < eligibleFromDay(state, member) || index >= game.lengthDays || !isScheduledDay(state, index)) return "none";
      return done.has(index) ? "done" : index < dayIndex ? "missed" : "todo";
    });
    const count = playerStreak(state, member, now, done);
    const version = termsForDay(state.game.terms, dayIndex).n;
    const peer = players.find(p => p.memberId === viewer && viewer !== owner);
    const peerVersion = peer && termsForDay(state.game.terms, dayIndexAt(peer, now)!).n;
    const peerCount = peer && playerStreak(state, peer, now, completed(peer.memberId));
    const partnerId = game.maxPlayers === 2 ? players.find(p => p.memberId !== owner)?.memberId : undefined;
    const revision = createHash("sha256").update(JSON.stringify([game.id, game.termsWordsEncrypted,
      member.seat, version, today, count, days, partnerId, peer?.seat, peerVersion, peerCount])).digest("hex");
    return { gameId: game.id, memberId: game.wordsOwnerMemberId, encrypted: game.termsWordsEncrypted,
      seat: member.seat, version, peerSeat: peer?.seat, peerVersion, peerCount, partnerId, count, days, monday, revision };
  }).filter(fact => fact !== null);
}

export async function currentPartners(db: ProfileDb, viewer: string, ids: string[]) {
  return ids.length ? await db.$queryRaw<{ id: string; photoKey: string | null }[]>`SELECT p.id, COALESCE(profile.photo_key, label.photo_key) AS "photoKey"
    FROM hosted_member p LEFT JOIN game_profile profile ON profile.member_id = p.id
    LEFT JOIN game_contact_label label ON label.owner_member_id = ${viewer} AND label.subject_member_id = p.id
    WHERE p.id IN (${Prisma.join(ids)})
    AND p.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM game_block b WHERE
      (b.blocker_member_id = ${viewer} AND b.blocked_member_id = p.id) OR (b.blocker_member_id = p.id AND b.blocked_member_id = ${viewer}))
    AND NOT EXISTS (SELECT 1 FROM game_report r WHERE r.reporter_member_id = ${viewer} AND r.about = 'player' AND r.reported_member_id = p.id)` : [];
}

export async function readProfileStreaks(owner: string, viewer: string, gameIds?: string[], withPartners = true) {
  const db = getPrisma();
  const facts = await streakFacts(db, owner, viewer, gameIds);
  const opened = await openGameTexts(facts.map(f => ({ table: "game", rowId: f.gameId, memberId: f.memberId, field: "terms_words", value: f.encrypted })));
  const ids = withPartners ? facts.flatMap(f => f.partnerId ? [f.partnerId] : []) : [];
  const allowed = await currentPartners(db, viewer, ids);
  const photos = new Map(allowed.map(row => [row.id, row.photoKey ? gameMediaUrl(row.photoKey) : null]));
  const names = await readNamesForViewer(viewer, allowed.map(p => p.id));
  return facts.flatMap((fact, i) => {
    const words = parseTermWords(opened[i]!);
    const task = (seat: number, version: number) => {
      const terms = effectiveTermWords(words, version);
      return terms.tasks.find(t => t.seat === seat)?.text ?? terms.defaultTask;
    };
    const title = task(fact.seat, fact.version);
    if (!title) return [];
    const firstName = fact.partnerId && names.get(fact.partnerId);
    const partner = firstName && fact.partnerId ? { memberId: fact.partnerId, firstName, avatarUrl: photos.get(fact.partnerId) ?? null } : null;
    const sameTask = fact.peerSeat !== undefined && fact.peerVersion !== undefined && task(fact.peerSeat, fact.peerVersion) === title;
    return [{ row: { gameId: fact.gameId, title, count: fact.count, days: fact.days, partner },
      monday: fact.monday, revision: fact.revision, peerCount: sameTask ? fact.peerCount : undefined }];
  });
}

export async function currentStreakRevisions(db: ProfileDb, owner: string, viewer: string, ids: string[]) {
  const facts = ids.length ? await streakFacts(db, owner, viewer, ids) : [];
  return new Map(facts.map(f => [f.gameId, f.revision]));
}
