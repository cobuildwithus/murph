import { resolveAssistantConversationKey } from './bindings.js'
import { registerAutomationFollowUp } from '@murphai/core'
import { listAutomations, readAutomation, type AutomationQueryRecord } from '@murphai/query'
import type { AssistantOutboxIntent, AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { readAssistantOutboxIntent } from './outbox/store.js'
import { readLatestAssistantInputCursor, compareAssistantInputCursors } from './input-store.js'
import type { AssistantMessageInput } from './service-contracts.js'

/** Called inside required delivery confirmation; failure uses outbox reconciliation. */
export async function registerDeliveredAssistantFollowUp(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<void> {
  const { intent, vault } = input
  const request = intent.followUpRequest
  if (!request || !intent.delivery || intent.delivery.kind === 'message-reaction'
    || intent.threadIsDirect !== true || !intent.message.trim()) return
  const dueAt = new Date(Date.parse(intent.delivery.sentAt) + request.afterMinutes * 60_000)
  const activeUntil = new Date(dueAt.getTime() + 60 * 60_000)
  if (activeUntil.getTime() <= Date.now()) return
  await registerAutomationFollowUp({
    vaultRoot: vault,
    followUpSourceIntentId: intent.intentId,
    ...(intent.automationAuthority ? {
      followUpParentAutomationId: intent.automationAuthority.automationId,
      parentExpectedUpdatedAt: intent.automationAuthority.expectedUpdatedAt,
    } : {}),
    title: 'Optional follow-up',
    instructions: request.instructions,
    status: 'active',
    schedule: { kind: 'at', at: dueAt.toISOString() },
    activeUntil: activeUntil.toISOString(),
    continuityPolicy: 'preserve',
    assistantTargetOverride: { model: 'gpt-5.6-terra' },
    contextReferences: intent.automationContextReferences ?? [],
    route: {
      channel: intent.channel ?? intent.delivery.channel,
      deliverySource: intent.deliverySource,
      deliveryTarget: intent.explicitTarget ?? intent.delivery.target,
      identityId: intent.identityId,
      participantId: intent.actorId,
      threadId: intent.threadId,
      threadIsDirect: true,
    },
  })
}

export function assistantFollowUpMatchesSession(
  record: AutomationQueryRecord,
  session: Pick<AssistantSession, 'binding'>,
): boolean {
  const route = record.route
  const binding = session.binding
  const key = resolveAssistantConversationKey({
    ...route, actorId: route.participantId,
  })
  return route.threadIsDirect === true && binding.threadIsDirect === true
    && key !== null && key === resolveAssistantConversationKey(binding)
}

export async function readAssistantPendingFollowUps(input: {
  vault: string
  session: Pick<AssistantSession, 'binding'>
}): Promise<AutomationQueryRecord[]> {
  const records = await listAutomations(input.vault, { status: ['active', 'paused'] }).catch(() => [])
  return records.filter((record) => record.followUpSourceIntentId
    && record.activeUntil && Date.parse(record.activeUntil) > Date.now()
    && assistantFollowUpMatchesSession(record, input.session)).slice(0, 2)
}

export function renderAssistantPendingFollowUps(records: readonly AutomationQueryRecord[]): string | null {
  if (!records.length) return null
  return [
    'Pending optional follow-ups in this private conversation:',
    'Resolve only the particular matter that was answered, declined, completed, or reopened naturally. Unrelated messages leave it pending. Use ordinary automation inspect then versioned patch to archive or defer; never revive consumed work or create follow-up chains.',
    JSON.stringify(records.map((record) => ({
      automationId: record.automationId, updatedAt: record.updatedAt,
      instructions: record.instructions, schedule: record.schedule, activeUntil: record.activeUntil,
    }))),
  ].join('\n')
}

export async function readAssistantFollowUpSourceContext(input: {
  record: AutomationQueryRecord
  vault: string
}): Promise<string> {
  const source = input.record.followUpSourceIntentId
    ? await readAssistantOutboxIntent(input.vault, input.record.followUpSourceIntentId)
    : null
  if (!source || source.status !== 'sent' || !source.delivery) {
    return 'Optional follow-up: original dispatch evidence is unavailable. Return skip.'
  }
  return [
    'This is the only optional follow-up attached to the delivered message below. Reconsider the specific unresolved matter against current conversation and canonical evidence. An unrelated reply does not resolve it. Complete history with no later human reply means the matter is unanswered, not that history is missing. This one optional check may ask about completion without evidence of a failure or miss. Skip if answered, completed, declined, superseded, already followed up, no longer useful, or if relevant history/evidence is incomplete. Silence is valid. Send at most one brief natural check-in; no guilt, pressure, or follow-up chain. You have read-only authority: do not change records or schedule more work.',
    JSON.stringify({
      automationId: input.record.automationId, updatedAt: input.record.updatedAt,
      instructions: input.record.instructions, contextReferences: input.record.contextReferences,
      deliveredAt: source.delivery.sentAt, originalMessage: source.message,
    }),
    'The canonical follow-up and confirmed dispatch above are supplied by the host. An empty contextReferences list means this check has no linked canonical action record to inspect; do not treat that as missing completion evidence.',
  ].join('\n')
}

export async function readAssistantFollowUpForInvocation(vault: string, automationId?: string | null) {
  if (!automationId) return null
  const record = await readAutomation(vault, automationId)
  return record?.followUpSourceIntentId ? record : null
}

export async function prepareAssistantFollowUpEvaluationInput(
  input: AssistantMessageInput,
): Promise<AssistantMessageInput> {
  const record = await readAssistantFollowUpForInvocation(input.vault, input.scheduledInvocationAuthority?.automationId)
  return record ? {
    ...input, outboxFollowUpEvaluatedThrough: await readLatestAssistantInputCursor({ vault: input.vault }),
  } : input
}

export async function resolveAssistantFollowUpTurnContext(input: {
  message: AssistantMessageInput
  session: Pick<AssistantSession, 'binding'>
  privateConversation: boolean
  interactiveConversation: boolean
  systemNotification: boolean
  outputOnly: boolean
  providerTools: boolean
  onboardingGoalCheckin: boolean
  supportsNativeResume: boolean
}) {
  const record = input.privateConversation
    ? await readAssistantFollowUpForInvocation(input.message.vault, input.message.scheduledInvocationAuthority?.automationId)
    : null
  const invocation = record !== null
  const attachmentAllowed = input.privateConversation && !invocation
    && !input.systemNotification && !input.outputOnly && !input.onboardingGoalCheckin && input.providerTools
  const pending = input.privateConversation && input.interactiveConversation
    && !input.message.scheduledInvocationAuthority
    ? await readAssistantPendingFollowUps({ vault: input.message.vault, session: input.session })
    : []
  const context = record
    ? await readAssistantFollowUpSourceContext({ record, vault: input.message.vault })
    : renderAssistantPendingFollowUps(pending)
  return {
    invocation, attachmentAllowed, context,
    requiresExplicitHistory: invocation || input.onboardingGoalCheckin,
    supportsNativeResume: input.supportsNativeResume && !invocation,
  }
}

export function assistantFollowUpContextChangedCanRetry(input: {
  code?: string | null
  source: { kind: string; followUpSourceIntentId?: string; status: string; activeUntil?: string | null } | null
  at: string
}): boolean {
  return input.code === 'ASSISTANT_FOLLOW_UP_CONTEXT_CHANGED'
    && input.source?.kind === 'automation' && !!input.source.followUpSourceIntentId
    && input.source.status === 'active' && typeof input.source.activeUntil === 'string'
    && Date.parse(input.at) < Date.parse(input.source.activeUntil)
}

/** Captured before evaluation, checked again at the existing provider entry fence. */
export async function assistantFollowUpHasNewInput(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<boolean> {
  if (input.intent.followUpEvaluatedThrough === undefined) return true
  const latest = await readLatestAssistantInputCursor({ vault: input.vault })
  const evaluated = input.intent.followUpEvaluatedThrough
  return latest && evaluated
    ? compareAssistantInputCursors(latest, evaluated) !== 0
    : latest !== evaluated
}
