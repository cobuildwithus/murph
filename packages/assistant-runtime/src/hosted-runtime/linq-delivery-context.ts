import type {
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

export interface HostedAssistantLinqDeliveryContext {
  directRecipientPhoneNumber: string | null;
  fromPhoneNumber: string | null;
  replyToMessageId: string | null;
  routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority | null;
  service: string | null;
  target: string | null;
  threadIsDirect: boolean | null;
}

export function buildHostedAssistantLinqDeliveryContextFromWake(
  wake: HostedRuntimeEvent,
): HostedAssistantLinqDeliveryContext | null {
  if (
    wake.kind !== "conversation.message"
    || wake.message.channel !== "linq"
  ) {
    return null;
  }

  return {
    directRecipientPhoneNumber: normalizeHostedLinqDeliveryContextText(wake.message.linqMessage.from),
    fromPhoneNumber: null,
    replyToMessageId: normalizeHostedLinqDeliveryContextText(wake.message.linqMessage.messageId),
    routeAuthority: wake.message.routeAuthority ?? null,
    service: normalizeHostedLinqDeliveryContextText(wake.message.linqMessage.service),
    target: normalizeHostedLinqDeliveryContextText(wake.message.linqMessage.chatId),
    threadIsDirect: typeof wake.message.linqMessage.threadIsDirect === "boolean"
      ? wake.message.linqMessage.threadIsDirect
      : null,
  };
}

export function resolveHostedAssistantLinqDeliveryContextForRequest(input: {
  context: HostedAssistantLinqDeliveryContext | null;
  replyToMessageId: string | null;
  target: string;
  targetKind: string | null;
}): HostedAssistantLinqDeliveryContext | null {
  if (
    !input.context
    || (input.targetKind !== "thread" && input.targetKind !== "explicit")
  ) {
    return null;
  }

  const target = normalizeHostedLinqDeliveryContextText(input.target);
  if (target && target === input.context.target) {
    return input.context;
  }

  if (input.context.routeAuthority) {
    return null;
  }

  const replyToMessageId = normalizeHostedLinqDeliveryContextText(input.replyToMessageId);
  return replyToMessageId && replyToMessageId === input.context.replyToMessageId
    ? input.context
    : null;
}

export function resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest(input: {
  contexts: readonly HostedAssistantLinqDeliveryContext[];
  replyToMessageId: string | null;
  target: string;
  targetKind: string | null;
}): HostedAssistantLinqDeliveryContext | null {
  for (const context of input.contexts) {
    const resolved = resolveHostedAssistantLinqDeliveryContextForRequest({
      context,
      replyToMessageId: input.replyToMessageId,
      target: input.target,
      targetKind: input.targetKind,
    });
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function resolveHostedAssistantLinqReactionDeliveryContextForRequest(input: {
  context: HostedAssistantLinqDeliveryContext | null;
  target: string;
  targetMessageId: string;
}): HostedAssistantLinqDeliveryContext | null {
  const context = resolveHostedAssistantLinqDeliveryContextForRequest({
    context: input.context,
    replyToMessageId: input.targetMessageId,
    target: input.target,
    targetKind: "thread",
  });

  if (!context?.routeAuthority) {
    return context;
  }

  const targetMessageId = normalizeHostedLinqDeliveryContextText(input.targetMessageId);
  return targetMessageId && targetMessageId === context.replyToMessageId
    ? context
    : null;
}

export function resolveHostedAssistantLinqReactionDeliveryContextFromCandidatesForRequest(input: {
  contexts: readonly HostedAssistantLinqDeliveryContext[];
  target: string;
  targetMessageId: string;
}): HostedAssistantLinqDeliveryContext | null {
  for (const context of input.contexts) {
    const resolved = resolveHostedAssistantLinqReactionDeliveryContextForRequest({
      context,
      target: input.target,
      targetMessageId: input.targetMessageId,
    });
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function normalizeHostedLinqDeliveryContextText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
