import "server-only";

import type { ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema } from "../companion/push-route";
import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { isGameEnabled } from "./access";
import { openGameTexts } from "./crypto";
import { deliverGamePush, readGamePushRoutes } from "./push-delivery";
import { gameReminderWindow, reminderOpenDay } from "./reminders";
import { effectiveTermWords, eligibleFromDay, liveEntry, parseTermWords, termsForDay } from "./rules";
import { toRuleState } from "./row";
import { readNamesForViewer } from "./viewer-names";

/** Each member is visited every five minutes, so a reminder is at most that late and a missed sweep costs one visit of six. */
const SHARDS = 5;
const PAGE_SIZE = 500;
const READ_BATCH = 5;
const GAMES_PER_MEMBER = 20;
const ENTRIES_PER_SEAT = 365 * 3;
const entrySelect = { id: true, memberId: true, dayIndex: true, attempt: true, kind: true, incomplete: true,
  receivedAt: true, withdrawnAt: true, mediaKeys: true, blurHash: true } as const;

/** A member's games that remind at one time of day: a game's own time, else the profile time. */
type ReminderSlot = { memberId: string; minutes: number };

/** Own attempt history only. Peer artifacts are read only for the final single-game wording. */
async function readOpenGames(slots: readonly ReminderSlot[], now: Date) {
  const profiles = await getPrisma().gameProfile.findMany({ where: { memberId: { in: [...new Set(slots.map(slot => slot.memberId))] }, reminderPush: true },
    select: { memberId: true, timeZone: true, reminderMinutes: true, players: {
      where: { leftAt: null, reminderOff: false, game: { status: "live" } }, orderBy: { gameId: "asc" }, take: GAMES_PER_MEMBER + 1,
      include: { entries: { select: entrySelect, take: ENTRIES_PER_SEAT + 1 }, game: { include: { players: true, invitees: true } } },
    } } });
  return slots.flatMap(({ memberId, minutes }) => {
    const profile = profiles.find(profile => profile.memberId === memberId);
    const window = profile && gameReminderWindow(now, profile.timeZone, minutes);
    if (!profile || !window || profile.players.length > GAMES_PER_MEMBER) return [];
    const open = profile.players.flatMap(seat => {
      if (!isGameEnabled() || seat.entries.length > ENTRIES_PER_SEAT || (seat.reminderMinutes ?? profile.reminderMinutes) !== minutes) return [];
      try {
        const state = toRuleState(seat.game, seat.entries);
        const player = state.players.find(player => player.memberId === profile.memberId);
        const day = player ? reminderOpenDay(state, player, new Date(now.getTime() + Number(seat.game.devClockOffsetMs)), seat.reminderEveryDay) : null;
        return day === null || !player ? [] : [{ row: seat.game, state, player, day }];
      } catch { return []; }
    });
    return open.length ? [{ memberId, minutes, window, open }] : [];
  });
}

/** One attempt a day for each of a member's reminder times. No claim is released, including a lost or superseded push. */
export async function sendDueGameReminders(now = new Date(), options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<void> {
  const startedAt = Date.now();
  const deadline = Math.min(options.deadlineMs ?? Infinity, startedAt + 20_000);
  const stopped = () => options.signal?.aborted || Date.now() >= deadline;
  const clock = () => new Date(now.getTime() + Date.now() - startedAt);
  const shard = Math.floor(now.getTime() / 60_000) % SHARDS;
  let cursor = "";
  try {
    while (!stopped()) {
      // Zones stay in JavaScript so one malformed profile cannot reject a whole page.
      const profiles = await getPrisma().$queryRaw<Array<{ memberId: string; timeZone: string; slots: number[] }>>`
        SELECT profile.member_id AS "memberId", profile.time_zone AS "timeZone",
          array_agg(DISTINCT COALESCE(seat.reminder_minutes, profile.reminder_minutes)) AS "slots"
        FROM game_profile profile
        JOIN hosted_member member ON member.id = profile.member_id
        JOIN companion_push_route route ON route.user_id = profile.member_id
        JOIN game_player seat ON seat.member_id = profile.member_id AND seat.left_at IS NULL AND NOT seat.reminder_off
        JOIN game ON game.id = seat.game_id AND game.status = 'live'
        WHERE profile.member_id > ${cursor} AND profile.reminder_push AND member.suspended_at IS NULL
          AND route.alerts_allowed AND route.game_reminders AND route.game_session_id IS NOT NULL
          AND mod(abs(hashtext(profile.member_id)::bigint), ${SHARDS}) = ${shard}
        GROUP BY profile.member_id, profile.time_zone
        ORDER BY profile.member_id LIMIT ${PAGE_SIZE}`;
      if (!profiles.length) break;
      cursor = profiles[profiles.length - 1]!.memberId;
      const due = await unclaimedDueSlots(profiles, clock());
      for (let index = 0; index < due.length && !stopped(); index += READ_BATCH) {
        const slots = due.slice(index, index + READ_BATCH);
        const [members, routes] = await Promise.all([readOpenGames(slots, clock()),
          readGamePushRoutes(getPrisma(), [...new Set(slots.map(slot => slot.memberId))], true)]);
        for (const member of members) {
          if (stopped()) break;
          const route = routes.find(route => route.userId === member.memberId);
          const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true }).safeParse(
            route ? { environment: route.environment, token: route.token, topic: route.topic } : null);
          if (!route?.gameSessionId || !target.success) continue;
          await sendReminder(member, route.gameSessionId, target.data, clock, stopped);
        }
      }
      if (profiles.length < PAGE_SIZE) break;
    }
  } catch { /* Reminders must never fail the lifecycle drain. */ }
}

const reminderCommandKey = (memberId: string, day: string, minutes: number) => `game-reminder:${sha256Hex(JSON.stringify([memberId, day, minutes]))}`;

/** Visits repeat through the window, so skip any time already reminded before reading its games. */
async function unclaimedDueSlots(profiles: ReadonlyArray<{ memberId: string; timeZone: string; slots: number[] }>, now: Date): Promise<ReminderSlot[]> {
  const due = profiles.flatMap(profile => profile.slots.flatMap(minutes => {
    const window = gameReminderWindow(now, profile.timeZone, minutes);
    return window ? [{ memberId: profile.memberId, minutes, commandKey: reminderCommandKey(profile.memberId, window.day, minutes) }] : [];
  }));
  if (!due.length) return [];
  const claimed = await getPrisma().gameEvent.findMany({ where: { commandKey: { in: due.map(slot => slot.commandKey) } }, select: { commandKey: true } });
  const seen = new Set(claimed.map(event => event.commandKey));
  return due.filter(slot => !seen.has(slot.commandKey)).map(({ memberId, minutes }) => ({ memberId, minutes }));
}

async function sendReminder(member: Awaited<ReturnType<typeof readOpenGames>>[number], sessionId: string,
  target: ApplePushRequest["target"], clock: () => Date, stopped: () => boolean | undefined) {
  const { memberId, minutes, window } = member;
  const commandKey = reminderCommandKey(memberId, window.day, minutes);
  const payload = { v: 1, recipientMemberId: memberId, day: window.day, minutes };
  const claimed = await getPrisma().gameEvent.createMany({ skipDuplicates: true, data: [{
    gameId: member.open[0]!.row.id, actor: "system", type: "reminder_notification", commandKey, payload: { ...payload, outcome: "claimed" },
  }] });
  if (!claimed.count) return;
  const request: ApplePushRequest = { target, collapseId: sha256Hex(commandKey), expiresAt: window.expiresAt,
    data: { gameId: member.open[0]!.row.id, notification: "game_reminder" }, message: { kind: "alert", title: "", body: "Still time today." } };
  // The recheck also rebuilds the words and target, so a game closed since the claim can't be named.
  const outcome = await deliverGamePush({ memberId, sessionId, request, requireGameReminders: true }, async () => {
    if (stopped()) return false;
    const [fresh] = await readOpenGames([{ memberId, minutes }], clock());
    if (!fresh || fresh.window.day !== window.day) return false;
    const words = await openGameTexts(fresh.open.map(({ row }) => ({ table: "game", field: "terms_words",
      memberId: row.wordsOwnerMemberId, rowId: row.id, value: row.termsWordsEncrypted })));
    const tasks = fresh.open.map((game, index) => {
      const version = effectiveTermWords(parseTermWords(words[index] ?? ""), termsForDay(game.state.game.terms, game.day).n);
      return version.tasks.find(task => task.seat === game.player.seat)?.text ?? version.defaultTask ?? "";
    });
    request.data.gameId = fresh.open[0]!.row.id;
    request.expiresAt = new Date(Math.min(window.expiresAt.getTime(), fresh.window.expiresAt.getTime()));
    const posted = fresh.open.length === 1 ? await postedPeers(fresh.open[0]!, memberId) : [];
    request.message = { kind: "alert", title: tasks.join(", ").slice(0, 120),
      body: posted.length ? `${await whoPosted(memberId, posted)} posted. Share yours to see it.` : "Still time today." };
    return !stopped();
  });
  try {
    await getPrisma().gameEvent.updateMany({ where: { commandKey }, data: { payload: { ...payload, outcome } } });
  } catch { /* A claimed receipt still prevents replay. */ }
}

/** Peers with a visible post today, in seat order. */
async function postedPeers(game: Awaited<ReturnType<typeof readOpenGames>>[number]["open"][number], memberId: string) {
  const peers = game.state.players.filter(player => player.memberId !== memberId && !player.leftAt && game.day >= eligibleFromDay(game.state, player)).map(player => player.memberId);
  const [entries, blocks] = await Promise.all([
    getPrisma().gameEntry.findMany({ where: { gameId: game.row.id, memberId: { in: peers }, dayIndex: game.day, attempt: { gt: 0 }, withdrawnAt: null,
      reports: { none: { reporterMemberId: memberId } } }, select: entrySelect, take: 20 }),
    getPrisma().gameBlock.findMany({ where: { OR: [{ blockerMemberId: memberId, blockedMemberId: { in: peers } },
      { blockedMemberId: memberId, blockerMemberId: { in: peers } }] }, select: { blockerMemberId: true, blockedMemberId: true } }),
  ]);
  const hidden = new Set(blocks.map(block => block.blockerMemberId === memberId ? block.blockedMemberId : block.blockerMemberId));
  const state = toRuleState(game.row, entries);
  return peers.filter(peer => !hidden.has(peer) && !!liveEntry(state.entries, peer, game.day));
}

/** "Kat", "Kat and Zach", "Kat and 2 others", by the names the recipient knows them by. */
async function whoPosted(memberId: string, peers: readonly string[]): Promise<string> {
  const names = await readNamesForViewer(memberId, peers).catch(() => new Map<string, string>());
  const named = peers.flatMap(peer => names.get(peer) ?? []);
  if (named.length !== peers.length || !named.length) return "They";
  if (named.length === 1) return named[0]!;
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named[0]} and ${named.length - 1} others`;
}
