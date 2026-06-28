import type {
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

export interface HostedAssistantLinqDeliveryContext {
  directRecipientPhoneNumber: string | null;
  fromPhoneNumber: string | null;
  replyToMessageId: string | null;
  routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority | null;
  target: string | null;
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
    target: normalizeHostedLinqDeliveryContextText(wake.message.linqMessage.chatId),
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

  const replyToMessageId = normalizeHostedLinqDeliveryContextText(input.replyToMessageId);
  if (!replyToMessageId || replyToMessageId !== input.context.replyToMessageId) {
    return null;
  }

  if (!input.context.routeAuthority) {
    return input.context;
  }

  return (
    input.context.target !== null
    && input.context.routeAuthority.threadId === input.context.target
    && looksLikeHostedAssistantRedactedLinqTarget(target)
  )
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

function looksLikeHostedAssistantRedactedLinqTarget(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return (
    /^h1_[a-f0-9]{24}$/iu.test(value)
    || /(?:^|:)hid_[A-Za-z0-9_-]+/u.test(value)
    || /(?:^|:)ain_[A-Za-z0-9_-]+/u.test(value)
    || value.includes("hbid:")
    || value.includes("hbidx:")
    || value.startsWith("[redacted")
  );
}
