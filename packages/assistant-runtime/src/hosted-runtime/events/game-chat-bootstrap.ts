import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import type { AssistantExecutionContext, sendAssistantNotification } from "@murphai/assistant-engine";
import type { HostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import type { HostedGameChatBootstrapResult } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeGroupToolPort } from "../platform.ts";

type NotificationInput = Parameters<typeof sendAssistantNotification>[0];

/** Only the admitted game wake receives this host-only callback, never a model tool. */
export function buildHostedGameChatBootstrapPolicy(input: {
  wake: HostedExecutionAssistantNotificationRequestedWake;
  executionContext: AssistantExecutionContext;
  groupToolPort?: HostedRuntimeGroupToolPort | null;
}): Pick<NotificationInput, "gameChatBootstrap" | "deferCommitUntilDeliveryAccepted"> {
  const { notification, userId, eventId } = input.wake;
  const bootstrap = notification.gameChatBootstrap;
  if (!bootstrap && notification.route.delivery.kind !== "bootstrap") return {};
  const route = notification.route;
  const sourceBootstrap = requireBootstrapGroupRoute({ bootstrap, route, userId, eventId, memberId: input.executionContext.hosted?.memberId });
  assertBootstrapNotificationMode(notification);
  if (!input.groupToolPort) throw new TypeError("Game bootstrap requires its trusted control port.");
  const port = input.groupToolPort;
  const source = { action: "game_chat_bootstrap" as const, gameId: sourceBootstrap.gameId, eventId };
  const request = async (text?: string): Promise<HostedGameChatBootstrapResult> => {
    const response = await port.request(text === undefined
      ? { ...source, operation: "recover" }
      : { ...source, operation: "send", text });
    if (response.action !== "game_chat_bootstrap") {
      throw new TypeError("Game bootstrap control returned an unrelated receipt.");
    }
    return response.result;
  };
  return { gameChatBootstrap: { recover: () => request(), send: request }, deferCommitUntilDeliveryAccepted: true };
}


function requireBootstrapGroupRoute(input: {
  bootstrap: HostedExecutionAssistantNotificationRequestedWake["notification"]["gameChatBootstrap"];
  route: HostedExecutionAssistantNotificationRequestedWake["notification"]["route"];
  userId: string;
  eventId: string;
  memberId: string | null | undefined;
}): NonNullable<HostedExecutionAssistantNotificationRequestedWake["notification"]["gameChatBootstrap"]> {
  const { bootstrap, route, userId, eventId, memberId } = input;
  if (!bootstrap || bootstrap.eventId !== eventId || memberId !== userId
    || route.channel !== "linq" || route.threadIsDirect !== false || route.threadId !== null
    || route.identityId !== userId || route.actorId !== null
    || route.delivery.kind !== "bootstrap" || route.delivery.target !== userId || route.delivery.source != null) {
    throw new TypeError("Game bootstrap notification requires its exact group runtime and admitted source.");
  }
  return bootstrap;
}

function assertBootstrapNotificationMode(notification: HostedExecutionAssistantNotificationRequestedWake["notification"]): void {
  if (notification.responsePolicy?.kind !== "require_send"
    || notification.notificationPromptProfile != null
    || notification.deliveryDispatchMode === "queue-only"
    || notification.firstContact != null || notification.operatorTask != null
    || notification.groupContextHandoff != null || notification.privateAssistantAskCompletion != null
    || notification.externalThreadRouteAuthority != null) {
    throw new TypeError("Game bootstrap notification cannot carry another notification's authority.");
  }
}

export function assertHostedConversationalControlAction(action: string): void {
  if (action === "game_chat_bootstrap") throw new TypeError("Game bootstrap control is unavailable to conversational tools.");
}

export function isHostedGameBootstrapUnavailable(error: unknown): boolean {
  return error instanceof VaultCliError && error.code === "GAME_CHAT_BOOTSTRAP_UNAVAILABLE";
}
