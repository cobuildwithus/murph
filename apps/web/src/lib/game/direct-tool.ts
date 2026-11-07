import "server-only";

import type { HostedGameToolRequest, HostedGameToolResponse } from "@murphai/hosted-execution/runtime-control";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import type { HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { requireHostedRuntimeCallbackTx } from "../hosted-execution/runtime-owner";
import { readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { assertHostedDirectAssistantNotificationRouteAuthority } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { readGamePushRoutes } from "./push-delivery";
import { gameReminderReach } from "./reminders";
import { openGameTexts } from "./crypto";
import { readGame, readGameReminders, runGameCommand } from "./service";

type Request = Extract<HostedGameToolRequest, { action: "my_game_reminders" }>;

async function authorize(memberId: string, runtimeIdentity: HostedRuntimeIdentity | null, request: Request): Promise<boolean> {
  const db = getPrisma();
  await db.$transaction(async tx => {
    await requireHostedRuntimeCallbackTx(tx, memberId, runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(memberId, { prisma: tx });
  });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: request.origin.assistantInputId, memberId, availableAt: new Date(), prisma: db,
  });
  if (!wake || wake.userId !== memberId) return false;
  const route = isHostedLinqConversationMessageWake(wake) && !wake.message.linqMessage.isFromMe
    && wake.message.linqMessage.threadIsDirect === true
    ? { channel: "linq" as const, threadId: wake.message.linqMessage.chatId }
    : isHostedTelegramConversationMessageWake(wake) && wake.message.telegramMessage.threadIsDirect === true
      ? { channel: "telegram" as const, threadId: wake.message.telegramMessage.threadId }
      : null;
  if (!route || "routeAuthority" in wake.message && wake.message.routeAuthority) return false;
  try {
    await assertHostedDirectAssistantNotificationRouteAuthority({ authority: {
      channel: route.channel, containerMemberId: memberId, threadId: route.threadId,
    }, prisma: db, requireThreadDelivery: true });
    return true;
  } catch { return false; }
}

export async function readMyGameReminderProjection(memberId: string) {
  const db = getPrisma();
  const [settings, seats] = await Promise.all([
    readGameReminders(memberId),
    db.gamePlayer.findMany({ where: { memberId, leftAt: null, game: { status: "live" } },
      select: { gameId: true, seat: true, reminderOff: true, reminderEveryDay: true, game: {
        select: { maxPlayers: true, players: { where: { leftAt: null }, select: { memberId: true } } },
      } }, orderBy: { gameId: "asc" }, take: 21 }),
  ]);
  if (seats.length > 20) return null;
  const peerIds = [...new Set(seats.flatMap(seat => seat.game.players.flatMap(player => player.memberId && player.memberId !== memberId ? [player.memberId] : [])))];
  const names = await db.gameProfile.findMany({ where: { memberId: { in: peerIds } }, select: { memberId: true, firstNameEncrypted: true } });
  const opened = await openGameTexts(names.map(name => ({ table: "game_profile" as const, field: "first_name", rowId: name.memberId,
    memberId: name.memberId, value: name.firstNameEncrypted })));
  const byId = new Map(names.map((name, index) => [name.memberId, opened[index] ?? ""]));
  const games = [];
  for (const seat of seats) {
    const view = await readGame(seat.gameId, memberId, seat.game.maxPlayers === 10);
    if (!view || view.status !== "live") continue;
    const ownDay = view.days.find(day => day.index === view.players.find(player => player.isMe)?.dayIndex);
    games.push({ id: view.id, task: view.terms.tasks.find(task => task.seat === seat.seat)?.text ?? view.terms.defaultTask ?? "",
      schedule: view.terms.schedule, today: !ownDay ? "upcoming" as const : ownDay.off ? "off" as const
        : ownDay.mine ? "posted" as const : "open" as const,
      otherFirstNames: seat.game.players.flatMap(player => player.memberId && player.memberId !== memberId ? [byId.get(player.memberId) ?? ""] : []).filter(Boolean),
      on: !seat.reminderOff, everyDay: seat.reminderEveryDay });
  }
  return { minutes: settings.minutes, push: settings.push, text: settings.text, canText: settings.canText, games };
}

export async function handleMyGameRemindersTool(input: { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: Request }): Promise<HostedGameToolResponse> {
  const unavailable = (): HostedGameToolResponse => ({ action: "my_game_reminders", result: { status: "unavailable", error: "Private game reminders are unavailable." } });
  if (process.env.MURPH_GAME_PRIVATE_REMINDERS_ENABLED !== "true" || !await authorize(input.memberId, input.runtimeIdentity, input.request)) return unavailable();
  if (input.request.operation === "set") {
    const error = await setMyGameReminders(input);
    if (error) return error;
  }
  const reminders = await readMyGameReminderProjection(input.memberId);
  if (!reminders) return unavailable();
  const [route] = await readGamePushRoutes(getPrisma(), [input.memberId], true);
  const selectedOn = input.request.gameId ? reminders.games.some(game => game.id === input.request.gameId && game.on)
    : reminders.games.some(game => game.on);
  const reaches = gameReminderReach(reminders, selectedOn, Boolean(route));
  return { action: "my_game_reminders", result: { status: "ok", reminders, reaches } };
}

async function setMyGameReminders(input: { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: Request }): Promise<HostedGameToolResponse | null> {
  const unavailable = (): HostedGameToolResponse => ({ action: "my_game_reminders", result: { status: "unavailable", error: "Private game reminders are unavailable." } });
  const current = await readMyGameReminderProjection(input.memberId);
  if (!current) return unavailable();
  const game = input.request.gameId ? current.games.find(game => game.id === input.request.gameId) : null;
  if (input.request.gameId && !game || (input.request.on !== undefined || input.request.everyDay !== undefined) && !game) return unavailable();
  const off = new Set(current.games.filter(game => !game.on).map(game => game.id));
  const everyDay = new Set(current.games.filter(game => game.everyDay).map(game => game.id));
  if (game && input.request.on !== undefined) input.request.on ? off.delete(game.id) : off.add(game.id);
  if (game && input.request.everyDay !== undefined) input.request.everyDay ? everyDay.add(game.id) : everyDay.delete(game.id);
  const saved = await runGameCommand({ actorMemberId: input.memberId, beforeMutationTx: async tx => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  }, command: { type: "setReminders", minutes: input.request.minutes ?? current.minutes,
    push: input.request.push ?? current.push, text: input.request.text ?? current.text,
    offGameIds: [...off], everyDayGameIds: [...everyDay] } });
  return saved.ok ? null : { action: "my_game_reminders", result: { status: "rejected", error: saved.error.message.slice(0, 128) } };
}
