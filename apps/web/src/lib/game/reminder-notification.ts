import "server-only";

import type { ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema } from "../companion/push-route";
import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { isGameOn } from "./access";
import { openGameTexts } from "./crypto";
import { deliverGamePush, readGamePushRoutes } from "./push-delivery";
import { gameReminderWindow, reminderOpenDay } from "./reminders";
import { effectiveTermWords, eligibleFromDay, liveEntry, parseTermWords, termsForDay } from "./rules";
import { toRuleState } from "./service";

/** Each member is visited every five minutes, so a reminder is at most that late and a missed sweep costs one visit of six. */
const SHARDS = 5;
const PAGE_SIZE = 500;
const READ_BATCH = 5;
const GAMES_PER_MEMBER = 20;
const ENTRIES_PER_SEAT = 365 * 3;
const entrySelect = { id: true, memberId: true, dayIndex: true, attempt: true, kind: true, incomplete: true,
  receivedAt: true, withdrawnAt: true, mediaKeys: true, blurHash: true } as const;

/** Own attempt history only. Peer artifacts are read only for the final single-game wording. */
async function readOpenGames(memberIds: string[], now: Date) {
  const profiles = await getPrisma().gameProfile.findMany({ where: { memberId: { in: memberIds }, reminderPush: true },
    select: { memberId: true, timeZone: true, reminderMinutes: true, players: {
      where: { leftAt: null, reminderOff: false, game: { status: "live" } }, orderBy: { gameId: "asc" }, take: GAMES_PER_MEMBER + 1,
      include: { entries: { select: entrySelect, take: ENTRIES_PER_SEAT + 1 }, game: { include: { players: true, invitees: true } } },
    } } });
  return profiles.flatMap(profile => {
    const window = gameReminderWindow(now, profile.timeZone, profile.reminderMinutes);
    if (!window || profile.players.length > GAMES_PER_MEMBER) return [];
    const open = profile.players.flatMap(seat => {
      if (!isGameOn(seat.game) || seat.entries.length > ENTRIES_PER_SEAT) return [];
      try {
        const state = toRuleState(seat.game, seat.entries);
        const player = state.players.find(player => player.memberId === profile.memberId);
        const day = player ? reminderOpenDay(state, player, new Date(now.getTime() + Number(seat.game.devClockOffsetMs))) : null;
        return day === null || !player ? [] : [{ row: seat.game, state, player, day }];
      } catch { return []; }
    });
    return open.length ? [{ memberId: profile.memberId, window, open }] : [];
  });
}

/** One member-wide daily attempt. No claim is released, including a lost or superseded push. */
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
      const profiles = await getPrisma().$queryRaw<Array<{ memberId: string; timeZone: string; reminderMinutes: number }>>`
        SELECT profile.member_id AS "memberId", profile.time_zone AS "timeZone", profile.reminder_minutes AS "reminderMinutes"
        FROM game_profile profile
        JOIN hosted_member member ON member.id = profile.member_id
        JOIN companion_push_route route ON route.user_id = profile.member_id
        WHERE profile.member_id > ${cursor} AND profile.reminder_push AND member.suspended_at IS NULL
          AND route.alerts_allowed AND route.game_reminders AND route.game_session_id IS NOT NULL
          AND mod(abs(hashtext(profile.member_id)::bigint), ${SHARDS}) = ${shard}
          AND EXISTS (SELECT 1 FROM game_player seat JOIN game ON game.id = seat.game_id
            WHERE seat.member_id = profile.member_id AND seat.left_at IS NULL AND game.status = 'live')
        ORDER BY profile.member_id LIMIT ${PAGE_SIZE}`;
      if (!profiles.length) break;
      cursor = profiles[profiles.length - 1]!.memberId;
      const due = await unclaimedDueMembers(profiles, clock());
      for (let index = 0; index < due.length && !stopped(); index += READ_BATCH) {
        const ids = due.slice(index, index + READ_BATCH);
        const [members, routes] = await Promise.all([readOpenGames(ids, clock()), readGamePushRoutes(getPrisma(), ids, true)]);
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

const reminderCommandKey = (memberId: string, day: string) => `game-reminder:${sha256Hex(JSON.stringify([memberId, day]))}`;

/** Visits repeat through the window, so skip anyone already reminded before reading their games. */
async function unclaimedDueMembers(profiles: ReadonlyArray<{ memberId: string; timeZone: string; reminderMinutes: number }>, now: Date): Promise<string[]> {
  const due = profiles.flatMap(profile => {
    const window = gameReminderWindow(now, profile.timeZone, profile.reminderMinutes);
    return window ? [{ memberId: profile.memberId, commandKey: reminderCommandKey(profile.memberId, window.day) }] : [];
  });
  if (!due.length) return [];
  const claimed = await getPrisma().gameEvent.findMany({ where: { commandKey: { in: due.map(member => member.commandKey) } }, select: { commandKey: true } });
  const seen = new Set(claimed.map(event => event.commandKey));
  return due.filter(member => !seen.has(member.commandKey)).map(member => member.memberId);
}

async function sendReminder(member: Awaited<ReturnType<typeof readOpenGames>>[number], sessionId: string,
  target: ApplePushRequest["target"], clock: () => Date, stopped: () => boolean | undefined) {
  const { memberId, window } = member;
  const commandKey = reminderCommandKey(memberId, window.day);
  const payload = { v: 1, recipientMemberId: memberId, day: window.day };
  const claimed = await getPrisma().gameEvent.createMany({ skipDuplicates: true, data: [{
    gameId: member.open[0]!.row.id, actor: "system", type: "reminder_notification", commandKey, payload: { ...payload, outcome: "claimed" },
  }] });
  if (!claimed.count) return;
  const request: ApplePushRequest = { target, collapseId: sha256Hex(commandKey), expiresAt: window.expiresAt, sound: "default",
    data: { gameId: member.open[0]!.row.id, notification: "game_reminder" }, message: { kind: "alert", title: "", body: "Still time today." } };
  // The recheck also rebuilds the words and target, so a game closed since the claim can't be named.
  const outcome = await deliverGamePush({ memberId, sessionId, request, requireGameReminders: true }, async () => {
    if (stopped()) return false;
    const [fresh] = await readOpenGames([memberId], clock());
    if (!fresh || fresh.window.day !== window.day) return false;
    const words = await openGameTexts(fresh.open.map(({ row }) => ({ table: "game", field: "terms_words",
      memberId: row.wordsOwnerMemberId, rowId: row.id, value: row.termsWordsEncrypted })));
    const tasks = fresh.open.map((game, index) => {
      const version = effectiveTermWords(parseTermWords(words[index] ?? ""), termsForDay(game.state.game.terms, game.day).n);
      return version.tasks.find(task => task.seat === game.player.seat)?.text ?? version.defaultTask ?? "";
    });
    request.data.gameId = fresh.open[0]!.row.id;
    request.expiresAt = new Date(Math.min(window.expiresAt.getTime(), fresh.window.expiresAt.getTime()));
    request.message = { kind: "alert", title: tasks.join(", ").slice(0, 120),
      body: fresh.open.length === 1 && await peerPosted(fresh.open[0]!, memberId) ? "They posted. Share yours to see it." : "Still time today." };
    return !stopped();
  });
  try {
    await getPrisma().gameEvent.updateMany({ where: { commandKey }, data: { payload: { ...payload, outcome } } });
  } catch { /* A claimed receipt still prevents replay. */ }
}

async function peerPosted(game: Awaited<ReturnType<typeof readOpenGames>>[number]["open"][number], memberId: string) {
  const peers = game.state.players.filter(player => player.memberId !== memberId && !player.leftAt && game.day >= eligibleFromDay(game.state, player)).map(player => player.memberId);
  const [entries, blocks] = await Promise.all([
    getPrisma().gameEntry.findMany({ where: { gameId: game.row.id, memberId: { in: peers }, dayIndex: game.day, attempt: { gt: 0 }, withdrawnAt: null,
      reports: { none: { reporterMemberId: memberId } } }, select: entrySelect, take: 20 }),
    getPrisma().gameBlock.findMany({ where: { OR: [{ blockerMemberId: memberId, blockedMemberId: { in: peers } },
      { blockedMemberId: memberId, blockerMemberId: { in: peers } }] }, select: { blockerMemberId: true, blockedMemberId: true } }),
  ]);
  const hidden = new Set(blocks.map(block => block.blockerMemberId === memberId ? block.blockedMemberId : block.blockerMemberId));
  return peers.some(peer => !hidden.has(peer) && !!liveEntry(toRuleState(game.row, entries).entries, peer, game.day));
}
