import "server-only";

import type { Prisma } from "@prisma/client";

export const GAME_REMINDER_OFF_CHOICE_EVENT = "reminder_off_chosen";
const EVERY_DAY_CHOICE_EVENT = "reminder_every_day_chosen";
export const MINUTES_CHOICE_EVENT = "reminder_minutes_chosen";

function choiceKey(gameId: string, memberId: string, type: string): string {
  return `game-reminder-choice:${gameId}:${memberId}:${type}`;
}

/** Record explicit fields before player writes: the event FK takes a game key-share lock. */
export async function recordGameReminderPreferencesTx(tx: Prisma.TransactionClient, memberId: string,
  chose: { off?: boolean; everyDay: boolean; minutes: boolean | readonly string[]; gameIds?: readonly string[] }): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO game_event (game_id, actor, type, command_key, payload)
    SELECT seat.game_id, ${memberId}, choice.type,
      'game-reminder-choice:' || seat.game_id || ':' || ${memberId} || ':' || choice.type,
      '{"v":1}'::jsonb
    FROM game_player seat JOIN game ON game.id = seat.game_id
    CROSS JOIN (VALUES (${GAME_REMINDER_OFF_CHOICE_EVENT}), (${EVERY_DAY_CHOICE_EVENT}), (${MINUTES_CHOICE_EVENT})) AS choice(type)
    WHERE seat.member_id = ${memberId} AND game.status = 'live'
      AND (${chose.gameIds === undefined} OR seat.game_id = ANY(${chose.gameIds ?? []}::text[]))
      AND (choice.type = ${GAME_REMINDER_OFF_CHOICE_EVENT} AND ${chose.off ?? true} OR choice.type = ${EVERY_DAY_CHOICE_EVENT} AND ${chose.everyDay}
        OR choice.type = ${MINUTES_CHOICE_EVENT} AND (${chose.minutes === true} OR seat.game_id = ANY(${Array.isArray(chose.minutes) ? chose.minutes : []}::text[])))
    ORDER BY seat.game_id, choice.type
    ON CONFLICT (command_key) DO NOTHING
  `;
}

/** Caller holds the game lock: it blocks new choice facts via their FK; existing facts protect their fields. */
export async function carryOverGameReminderPreferencesTx(tx: Prisma.TransactionClient, gameId: string, memberId: string,
  previous: { reminderOff: boolean; reminderEveryDay: boolean; reminderMinutes: number | null }): Promise<void> {
  const choices = await tx.gameEvent.findMany({ where: { commandKey: { in: [GAME_REMINDER_OFF_CHOICE_EVENT, EVERY_DAY_CHOICE_EVENT, MINUTES_CHOICE_EVENT]
    .map(type => choiceKey(gameId, memberId, type)) } }, select: { type: true } });
  const explicit = new Set(choices.map(choice => choice.type));
  const data = {
    ...(!explicit.has(GAME_REMINDER_OFF_CHOICE_EVENT) ? { reminderOff: previous.reminderOff } : {}),
    ...(!explicit.has(EVERY_DAY_CHOICE_EVENT) ? { reminderEveryDay: previous.reminderEveryDay } : {}),
    ...(!explicit.has(MINUTES_CHOICE_EVENT) ? { reminderMinutes: previous.reminderMinutes } : {}),
  };
  if (Object.keys(data).length) await tx.gamePlayer.updateMany({ where: { gameId, memberId }, data });
}
