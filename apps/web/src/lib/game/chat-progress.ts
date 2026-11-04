import type { HostedGameChatState } from "@murphai/hosted-execution/runtime-control";
import { eligibleFromDay, indexGameEntries, attemptsUsed, currentTerms, dayIndexAt, isScheduledDay, liveEntry, completedEntry, scorePlayer, type RuleState } from "./rules";
import { addDays, dayStartInstant, GAME_GRACE_MS } from "./time";

const CHAT_DAY_WINDOW = 14;

type Progress = NonNullable<HostedGameChatState["games"][number]["progress"]>;

/** Shared metadata only. Never expose media, entry words or private app labels. */
export function gameChatProgress(state: RuleState, now: Date): Progress {
  const entries = indexGameEntries(state.entries);
  return { checkedAt: now.toISOString(), players: state.players.filter(player => state.game.seats !== 10 || !player.leftAt).map((player) => {
    const today = dayIndexAt(player, now);
    const current = state.game.status === "live" && today !== null && today >= 0 && today < state.game.lengthDays ? today : null;
    const schedule = currentTerms(state.game.terms).schedule;
    const endDay = Math.min(state.game.lengthDays, Math.max(CHAT_DAY_WINDOW, (today ?? -1) + 1));
    const firstDay = Math.max(eligibleFromDay(state, player), endDay - CHAT_DAY_WINDOW);
    const days: Progress["players"][number]["days"] = player.dayOne ? Array.from({ length: Math.max(0, endDay - firstDay) }, (_, offset) => {
      const dayIndex = firstDay + offset;
      const date = addDays(player.dayOne!, dayIndex);
      const posted = state.game.seats === 10 ? liveEntry(entries, player.memberId, dayIndex) : completedEntry(entries, player.memberId, dayIndex);
      const closed = state.game.status === "settled" || now.getTime() >= dayStartInstant(addDays(date, 1), player.timeZone).getTime() + GAME_GRACE_MS;
      const status = posted ? "posted" : !isScheduledDay(state, dayIndex) ? "off"
        : today === null || dayIndex > today ? "upcoming"
        : "count" in schedule || state.game.seats === 10 ? "not_posted" : closed ? "missed" : "due";
      return { dayIndex, date, status };
    }) : [];
    return { memberId: player.memberId, currentDayIndex: current,
      score: scorePlayer(state, player, state.game.status === "settled" ? state.game.lengthDays - 1 : today ?? -1, entries).score,
      target: "count" in schedule ? schedule.count : Array.from({ length: state.game.lengthDays }, (_, day) => isScheduledDay(state, day)).filter(Boolean).length,
      currentEntryId: current === null ? null : liveEntry(entries, player.memberId, current)?.id ?? null,
      attemptsRemaining: current === null ? 0 : Math.max(0, 2 - attemptsUsed(entries, player.memberId, current)), days };
  }) };
}
