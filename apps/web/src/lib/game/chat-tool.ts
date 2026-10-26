import "server-only";
import { handleGameChatPhoto } from "./chat-photo";
import type { Prisma } from "@prisma/client";
import { hostedGameChatStateSchema, type HostedGameToolRequest, type HostedGameToolResponse } from "@murphai/hosted-execution/runtime-control";
import type { HostedExecutionExternalThreadRouteAuthority, HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { resolveHostedGroupMessageSenderMemberId } from "../hosted-groups/group-message-sender";
import { assertHostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import { readGameChatState, runGameCommand } from "./service";
import { gamePairWhere, readGameChatPlayerIds, requireExactGameChat, sameGamePlayers } from "./chat-membership";
import { isGameEnabled, isGameOn } from "./access";

type Input = { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: HostedGameToolRequest; playerMemberIds?: readonly string[] };

/** The signed runtime selects only a game and accepted Message ref, never an actor. */
export async function handleGameChatTool(input: Input): Promise<HostedGameToolResponse> {
  if (!isGameEnabled()) return { action: input.request.action, result: { status: "unavailable", error: "game_unavailable" } };
  const prisma = getPrisma();
  const actor = await prisma.$transaction((tx) => authorizeGameChatActorTx(input, tx));
  if (!actor) return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  const playerMemberIds = await requireExactGameChat(input.memberId);
  if (!playerMemberIds.includes(actor)) return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  let dayOutcome: Extract<Awaited<ReturnType<typeof runGameCommand>>, { ok: true }>["dayOutcome"];
  let photoResult: Awaited<ReturnType<typeof handleGameChatPhoto>> | null = null;
  if (input.request.action === "game_photo") {
    photoResult = await handleGameChatPhoto({ actor, containerMemberId: input.memberId, playerMemberIds,
      messageRef: input.request.origin.assistantInputId, photo: input.request.photo,
      authorize: async (tx, messageRef) => {
        const scoped = { ...input, playerMemberIds, request: { ...input.request, origin: { kind: "accepted_input" as const, assistantInputId: messageRef } } };
        const sourceActor = await authorizeGameChatActorTx(scoped, tx);
        const wake = sourceActor ? await readHostedMailboxConversationWakeByAssistantInputId({ assistantInputId: messageRef, availableAt: new Date(), memberId: input.memberId, prisma: tx }) : null;
        return { actor: sourceActor, wake };
      },
    });
    if (photoResult.status !== "ok") return { action: input.request.action, result: photoResult };
  }
  if (input.request.action === "update_game") {
    const update = input.request.update;
    const command = "date" in update
      ? { type: "setDayCompletion", gameId: update.gameId, date: update.date, incomplete: update.operation === "mark_incomplete" }
      : update.operation === "cancel_game"
      ? { type: "cancelInvite", gameId: update.gameId }
      : update.operation === "propose"
      ? { type: "proposeChange", gameId: update.gameId, proposalId: update.proposalId, expectedTermsVersion: update.expectedTermsVersion, change: update.change }
      : { type: "respondChange", gameId: update.gameId, proposalId: update.proposalId, decision: update.operation };
    const result = await runGameCommand({
      actorMemberId: actor,
      chatContainerMemberId: input.memberId,
      chatPlayerMemberIds: playerMemberIds,
      command,
      beforeMutationTx: async (tx) => {
        if (await authorizeGameChatActorTx({ ...input, playerMemberIds }, tx) !== actor) throw new TypeError("Game player authority changed.");
      },
    });
    // GameView is a personal app view. Never pass it into the shared runtime.
    // Rule messages name only the rule and next step, so Murph can explain a refusal.
    if (!result.ok) return { action: input.request.action, result: { status: "rejected", error: `${result.error.code}: ${result.error.message}`.slice(0, 128) } };
    dayOutcome = result.dayOutcome;
    const latestPlayers = await requireExactGameChat(input.memberId);
    if (!sameGamePlayers(latestPlayers, playerMemberIds)) throw new TypeError("Game chat participants changed.");
  }
  if (input.request.action === "game_photo" && !sameGamePlayers(await requireExactGameChat(input.memberId), playerMemberIds)) throw new TypeError("Game chat participants changed.");
  const state = hostedGameChatStateSchema.parse(await readGameChatState(input.memberId, playerMemberIds, actor));
  return { action: input.request.action, result: { status: "ok", state, ...(dayOutcome ? { dayOutcome } : {}), ...(photoResult?.photoOutcome ? { photoOutcome: photoResult.photoOutcome } : {}) } };
}

/** A free player may agree to their game without gaining personal AI access. */
export async function authorizeGameChatActorTx(input: Input, tx: Prisma.TransactionClient): Promise<string | null> {
  await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
  await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.request.origin.assistantInputId, availableAt: new Date(), memberId: input.memberId, prisma: tx,
  });
  if (!wake || wake.userId !== input.memberId) return null;
  const route = readGameIncomingRoute(wake, input.memberId);
  if (!route) return null;
  await assertHostedThreadRouteEgressAuthority({ authority: route, prisma: tx });
  const actor = await resolveHostedGroupMessageSenderMemberId({ prisma: tx, routeAuthority: route, wake });
  if (!actor) return null;
  const players = await readGameChatPlayerIds(input.memberId, tx);
  if (!players.includes(actor) || (input.playerMemberIds && !sameGamePlayers(players, input.playerMemberIds))) return null;
  const game = await tx.game.findFirst({
    where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] }, ...(input.request.action === "update_game" ? { id: input.request.update.gameId } : input.request.action === "game_photo" ? { id: input.request.photo.gameId } : {}) },
    select: { id: true, players: { select: { memberId: true }, take: 3 } },
  });
  if (!game || !areGamePlayersAllowed(game, input.playerMemberIds)) return null;
  return actor;
}

function readGameIncomingRoute(wake: HostedExecutionConversationMessageWake, containerMemberId: string): HostedExecutionExternalThreadRouteAuthority | null {
  const message = wake.message;
  if (message.channel !== "linq" && message.channel !== "telegram") return null;
  const route = message.routeAuthority;
  if (!route || route.containerMemberId !== containerMemberId) return null;
  if (message.channel === "linq") {
    return message.linqMessage.isFromMe === false && message.linqMessage.threadIsDirect === false && route.channel === "linq" && route.threadId === message.linqMessage.chatId ? route : null;
  }
  if (message.channel === "telegram") {
    return message.telegramMessage.threadIsDirect === false && route.channel === "telegram" && route.threadId === message.telegramMessage.threadId ? route : null;
  }
  return null;
}


function areGamePlayersAllowed(game: { players: readonly { memberId: string }[] }, expected?: readonly string[]): boolean {
  if (game.players.length !== 2 || !isGameOn(game)) return false;
  return expected === undefined || sameGamePlayers(game.players.map((player) => player.memberId), expected);
}
