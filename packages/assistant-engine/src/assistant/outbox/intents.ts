import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantOpaqueStateFilePath } from '../state-ids.js'

export type AssistantOutboxRawTargetIdentityInput = {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
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
  }
}

export function buildAssistantOutboxPersistedTarget(
  input: AssistantOutboxPersistedTargetInput,
): AssistantOutboxPersistedTarget {
  return {
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    actorId: normalizeNullableString(input.actorId),
    threadId: normalizeNullableString(input.threadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
    replyToMessageId: normalizeNullableString(input.replyToMessageId),
    bindingDelivery: input.bindingDelivery ?? null,
    explicitTarget: normalizeNullableString(input.explicitTarget),
  }
}

export function hashAssistantOutboxIdentity(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  message: string
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
      }),
    )
    .digest('hex')
}

export function hashAssistantOutboxTargetFingerprint(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
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
      }),
    )
    .digest('hex')
}
