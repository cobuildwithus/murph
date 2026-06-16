import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  AssistantOutboxIntent,
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantBindingDelivery } from '../bindings.js'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantOpaqueStateFilePath } from '../state-ids.js'

export type AssistantOutboxRawTargetIdentityInput = {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  explicitTarget?: string | null
  identityId?: string | null
  replyToMessageId?: string | null
  threadId?: string | null
}

export type AssistantOutboxPersistedTargetInput = AssistantOutboxRawTargetIdentityInput & {
  threadIsDirect?: boolean | null
}

export type AssistantOutboxPersistedTarget = Pick<
  AssistantOutboxIntent,
  | 'actorId'
  | 'bindingDelivery'
  | 'channel'
  | 'deliverySource'
  | 'explicitTarget'
  | 'identityId'
  | 'replyToMessageId'
  | 'threadId'
  | 'threadIsDirect'
>

export function resolveAssistantOutboxIntentPath(
  outboxDirectory: string,
  intentId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: outboxDirectory,
    extension: '.json',
    kind: 'outbox intent',
    value: intentId,
  })
}

export function resolveAssistantOutboxQuarantineDirectory(
  outboxDirectory: string,
): string {
  return path.join(outboxDirectory, '.quarantine')
}

export function buildAssistantOutboxRawTargetIdentity(
  input: AssistantOutboxRawTargetIdentityInput,
): AssistantOutboxRawTargetIdentityInput {
  return {
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId,
    threadId: input.threadId,
    replyToMessageId: input.replyToMessageId,
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
    deliverySource: input.deliverySource,
  }
}

export function buildAssistantOutboxPersistedTarget(
  input: AssistantOutboxPersistedTargetInput,
): AssistantOutboxPersistedTarget {
  const channel = normalizeNullableString(input.channel)
  const actorId = normalizeNullableString(input.actorId)
  const threadId = normalizeNullableString(input.threadId)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null

  return {
    channel,
    identityId: normalizeNullableString(input.identityId),
    actorId,
    threadId,
    threadIsDirect,
    replyToMessageId: normalizeNullableString(input.replyToMessageId),
    bindingDelivery: input.bindingDelivery === undefined
      ? resolveAssistantBindingDelivery({
          actorId,
          channel,
          threadId,
          threadIsDirect,
        })
      : input.bindingDelivery,
    deliverySource: input.deliverySource ?? null,
    explicitTarget: normalizeNullableString(input.explicitTarget),
  }
}

export function hashAssistantOutboxIdentity(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  subject?: string | null
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  turnId: string
}): string {
  const dedupeToken = normalizeNullableString(input.dedupeToken)
  if (dedupeToken) {
    return createHash('sha1')
      .update(JSON.stringify({ dedupeToken }))
      .digest('hex')
  }

  return createHash('sha1')
    .update(
      JSON.stringify({
        message: input.message,
        media: input.media ?? [],
        subject: normalizeNullableString(input.subject),
        sessionId: input.sessionId,
        dedupeToken: null,
        turnId: input.turnId,
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        replyToMessageId: input.replyToMessageId,
        explicitTarget: input.explicitTarget,
        bindingDelivery: input.bindingDelivery,
        deliverySource: input.deliverySource,
      }),
    )
    .digest('hex')
}

export function hashAssistantOutboxLegacyMediaDedupeIdentity(input: {
  dedupeToken?: string | null
  media?: readonly AssistantResponseMedia[] | null
}): string | null {
  const dedupeToken = normalizeNullableString(input.dedupeToken)
  if (!dedupeToken) {
    return null
  }

  return createHash('sha1')
    .update(JSON.stringify({ dedupeToken, media: input.media ?? [] }))
    .digest('hex')
}

export function hashAssistantOutboxTargetFingerprint(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  explicitTarget?: string | null
  identityId?: string | null
  replyToMessageId?: string | null
  threadId?: string | null
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        replyToMessageId: input.replyToMessageId,
        explicitTarget: input.explicitTarget,
        bindingDelivery: input.bindingDelivery,
        deliverySource: input.deliverySource,
      }),
    )
    .digest('hex')
}
