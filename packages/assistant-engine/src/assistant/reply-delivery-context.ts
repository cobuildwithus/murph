import type { AssistantMessageInput } from './service-contracts.js'

export type AssistantReplyDeliveryContext = Pick<
  AssistantMessageInput,
  | 'deliveryDispatchMode'
  | 'deliveryIdempotencyKey'
  | 'deliveryMessageReactionsAvailable'
  | 'deliveryReactionTargetMessageId'
  | 'deliveryReplyToMessageId'
  | 'deliverySource'
  | 'deliverySubject'
  | 'deliveryTarget'
  | 'hostedDeliveryIdempotency'
>

export type AssistantReplyDeliveryContextOverrides =
  Partial<AssistantReplyDeliveryContext>

export function pickAssistantReplyDeliveryContext(
  input: AssistantMessageInput,
): AssistantReplyDeliveryContext {
  return {
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryMessageReactionsAvailable:
      input.deliveryMessageReactionsAvailable,
    deliveryReactionTargetMessageId:
      input.deliveryReactionTargetMessageId,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId,
    deliverySource: input.deliverySource ?? null,
    deliverySubject: input.deliverySubject,
    deliveryTarget: input.deliveryTarget,
    hostedDeliveryIdempotency: input.hostedDeliveryIdempotency ?? null,
  }
}

export function pickDefinedAssistantReplyDeliveryContext(
  input: Partial<AssistantReplyDeliveryContext>,
): AssistantReplyDeliveryContextOverrides {
  return {
    ...(input.deliveryDispatchMode === undefined
      ? {}
      : { deliveryDispatchMode: input.deliveryDispatchMode }),
    ...(input.deliveryIdempotencyKey === undefined
      ? {}
      : { deliveryIdempotencyKey: input.deliveryIdempotencyKey }),
    ...(input.deliveryMessageReactionsAvailable === undefined
      ? {}
      : {
          deliveryMessageReactionsAvailable:
            input.deliveryMessageReactionsAvailable,
        }),
    ...(input.deliveryReactionTargetMessageId === undefined
      ? {}
      : {
          deliveryReactionTargetMessageId:
            input.deliveryReactionTargetMessageId,
        }),
    ...(input.deliveryReplyToMessageId === undefined
      ? {}
      : { deliveryReplyToMessageId: input.deliveryReplyToMessageId }),
    ...(input.deliverySource === undefined
      ? {}
      : { deliverySource: input.deliverySource }),
    ...(input.deliverySubject === undefined
      ? {}
      : { deliverySubject: input.deliverySubject }),
    ...(input.deliveryTarget === undefined
      ? {}
      : { deliveryTarget: input.deliveryTarget }),
    ...(input.hostedDeliveryIdempotency === undefined
      ? {}
      : { hostedDeliveryIdempotency: input.hostedDeliveryIdempotency }),
  }
}

export function mergeAssistantReplyDeliveryContextOverrides(
  first: Partial<AssistantReplyDeliveryContext>,
  second: Partial<AssistantReplyDeliveryContext> | null | undefined,
): AssistantReplyDeliveryContextOverrides {
  return pickDefinedAssistantReplyDeliveryContext({
    deliveryDispatchMode:
      second?.deliveryDispatchMode === undefined
        ? first.deliveryDispatchMode
        : second.deliveryDispatchMode,
    deliveryIdempotencyKey:
      second?.deliveryIdempotencyKey === undefined
        ? first.deliveryIdempotencyKey
        : second.deliveryIdempotencyKey,
    deliveryMessageReactionsAvailable:
      second?.deliveryMessageReactionsAvailable === undefined
        ? first.deliveryMessageReactionsAvailable
        : second.deliveryMessageReactionsAvailable,
    deliveryReactionTargetMessageId:
      second?.deliveryReactionTargetMessageId === undefined
        ? first.deliveryReactionTargetMessageId
        : second.deliveryReactionTargetMessageId,
    deliveryReplyToMessageId:
      second?.deliveryReplyToMessageId === undefined
        ? first.deliveryReplyToMessageId
        : second.deliveryReplyToMessageId,
    deliverySource:
      second?.deliverySource === undefined
        ? first.deliverySource
        : second.deliverySource,
    deliverySubject:
      second?.deliverySubject === undefined
        ? first.deliverySubject
        : second.deliverySubject,
    deliveryTarget:
      second?.deliveryTarget === undefined
        ? first.deliveryTarget
        : second.deliveryTarget,
    hostedDeliveryIdempotency:
      second?.hostedDeliveryIdempotency === undefined
        ? first.hostedDeliveryIdempotency
        : second.hostedDeliveryIdempotency,
  })
}

export function applyAssistantReplyDeliveryContext(input: {
  context: AssistantReplyDeliveryContext | null
  input: AssistantMessageInput
}): AssistantMessageInput {
  if (!input.context) {
    return input.input
  }

  return {
    ...input.input,
    deliveryDispatchMode: input.context.deliveryDispatchMode,
    deliveryIdempotencyKey: input.context.deliveryIdempotencyKey,
    deliveryMessageReactionsAvailable:
      input.context.deliveryMessageReactionsAvailable,
    deliveryReactionTargetMessageId:
      input.context.deliveryReactionTargetMessageId,
    deliveryReplyToMessageId: input.context.deliveryReplyToMessageId,
    deliverySource: input.context.deliverySource,
    deliverySubject: input.context.deliverySubject,
    deliveryTarget: input.context.deliveryTarget,
    hostedDeliveryIdempotency: input.context.hostedDeliveryIdempotency,
  }
}

export function applyAssistantReplyDeliveryContextOverrides(input: {
  input: AssistantMessageInput
  overrides: Partial<AssistantReplyDeliveryContext> | null | undefined
}): AssistantMessageInput {
  if (!input.overrides) {
    return input.input
  }

  return {
    ...input.input,
    ...pickDefinedAssistantReplyDeliveryContext(input.overrides),
  }
}
