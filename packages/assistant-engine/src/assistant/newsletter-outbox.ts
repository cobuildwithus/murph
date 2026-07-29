import type {
  HostedRuntimeNewsletterScheduledAuthority,
  HostedRuntimeNewsletterToolResponse,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'

import type { AssistantHostedNewsletterTool } from './execution-context.js'
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
} from './outbox.js'

type NewsletterPreparation = {
  authorizationProof: string
  authority: HostedRuntimeNewsletterScheduledAuthority
  groupId: string
  participantMemberIds: string[]
  skippedNoEmailMemberIds: string[]
}

export function createAssistantNewsletterOutboxTool(input: {
  automationAuthority?: AssistantOutboxIntent['automationAuthority']
  authority: HostedRuntimeNewsletterScheduledAuthority | null
  newsletterTool: AssistantHostedNewsletterTool
  recordPendingDeliveryIntentId?: (intentId: string) => void
  sessionId: string
  turnId: string
  vault: string
}): AssistantHostedNewsletterTool & { closeCapability(): void } {
  let prepareAttempted = false
  let sendAttempted = false
  let preparation: NewsletterPreparation | null = null
  const closeCapability = () => {
    preparation = null
    prepareAttempted = true
    sendAttempted = true
  }

  return {
    closeCapability,
    async request(request) {
      if (request.action === 'prepare') {
        if (prepareAttempted || sendAttempted) {
          closeCapability()
          return newsletterUnavailable('prepare', 'newsletter_capability_consumed')
        }
        prepareAttempted = true
        const result = await input.newsletterTool.request({
          action: 'prepare',
        })
        if (
          input.authority
          && result.action === 'prepare'
          && result.result.status === 'ok'
        ) {
          preparation = {
            authorizationProof: result.result.authorizationProof,
            authority: input.authority,
            groupId: result.result.groupId,
            participantMemberIds: result.result.participants
              .filter((participant) => participant.hasEmail)
              .map((participant) => participant.memberId),
            skippedNoEmailMemberIds: result.result.participants
              .filter((participant) => !participant.hasEmail)
              .map((participant) => participant.memberId),
          }
        }
        return result
      }

      if (sendAttempted) {
        return newsletterUnavailable('send', 'newsletter_capability_consumed')
      }
      sendAttempted = true
      const prepared = preparation
      preparation = null
      if (!input.authority) {
        return newsletterUnavailable('send', 'scheduled_automation_required')
      }
      if (
        !prepared
        || prepared.authority.automationId !== input.authority.automationId
        || prepared.authority.occurrenceAt !== input.authority.occurrenceAt
      ) {
        return newsletterUnavailable('send', 'newsletter_preparation_required')
      }
      if (prepared.participantMemberIds.length === 0) {
        return {
          action: 'send',
          result: {
            participantCount: 0,
            skippedNoEmailMemberIds: prepared.skippedNoEmailMemberIds,
            status: 'no_recipients',
          },
        }
      }

      const deliveryIdempotencyKey = buildNewsletterDeliveryIdempotencyKey({
        authority: prepared.authority,
        groupId: prepared.groupId,
      })
      const intents = await listAssistantOutboxIntents(input.vault)
      const currentIntents = intents.filter(
        (intent) => intent.deliveryIdempotencyKey === deliveryIdempotencyKey,
      )
      const parentIntents = currentIntents
        .filter(isNewsletterParentIntent)
        .sort(compareOutboxIntentCreationOrder)
      const activeParent = parentIntents.find(isActiveOutboxIntent)
      if (activeParent) {
        input.recordPendingDeliveryIntentId?.(activeParent.intentId)
        return newsletterAccepted(prepared)
      }

      if (parentIntents.some((intent) => intent.status === 'sent')) {
        return newsletterSent(prepared)
      }

      if (parentIntents.length > 0) {
        return newsletterFailed(prepared)
      }

      const parentIntent = await createAssistantOutboxIntent({
        automationAuthority: input.automationAuthority ?? null,
        channel: 'email',
        dedupeToken: [
          'group-newsletter-parent',
          deliveryIdempotencyKey,
        ].join(':'),
        deliveryIdempotencyKey,
        emailHtml: request.html,
        explicitTarget: serializeHostedEmailThreadTarget({
          groupId: prepared.groupId,
          subject: request.subject,
          targetKind: 'group',
        }),
        message: request.text ?? 'Open this email in an HTML-capable mail client.',
        newsletterAuthorizationProof: prepared.authorizationProof,
        sessionId: input.sessionId,
        subject: null,
        threadIsDirect: false,
        turnId: input.turnId,
        vault: input.vault,
      })
      input.recordPendingDeliveryIntentId?.(parentIntent.intentId)
      return newsletterAccepted(prepared)
    },
  }
}

export async function findAssistantNewsletterParentIntent(input: {
  authority: HostedRuntimeNewsletterScheduledAuthority
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const deliveryIdempotencyPrefix =
    buildNewsletterDeliveryIdempotencyPrefix(input.authority)
  const parentIntents = (await listAssistantOutboxIntents(input.vault))
    .filter((intent) =>
      intent.deliveryIdempotencyKey?.startsWith(deliveryIdempotencyPrefix)
      && isNewsletterParentIntent(intent)
    )
    .sort(compareOutboxIntentCreationOrder)
  return parentIntents.find(isActiveOutboxIntent)
    ?? parentIntents.find((intent) => intent.status === 'sent')
    ?? parentIntents[0]
    ?? null
}

function buildNewsletterDeliveryIdempotencyKey(input: {
  authority: HostedRuntimeNewsletterScheduledAuthority
  groupId: string
}): string {
  return `${buildNewsletterDeliveryIdempotencyPrefix(input.authority)}${input.groupId}`
}

function buildNewsletterDeliveryIdempotencyPrefix(
  authority: HostedRuntimeNewsletterScheduledAuthority,
): string {
  return `group-newsletter:${authority.automationId}:${authority.occurrenceAt}:`
}

function newsletterAccepted(
  preparation: NewsletterPreparation,
): HostedRuntimeNewsletterToolResponse {
  return {
    action: 'send',
    result: {
      participantCount: preparation.participantMemberIds.length,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'accepted',
    },
  }
}

function newsletterUnavailable(
  action: 'prepare' | 'send',
  unavailableReason: string,
): HostedRuntimeNewsletterToolResponse {
  return {
    action,
    result: { status: 'unavailable', unavailableReason },
  }
}

function newsletterSent(
  preparation: NewsletterPreparation,
): HostedRuntimeNewsletterToolResponse {
  return {
    action: 'send',
    result: {
      participantCount: preparation.participantMemberIds.length,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'sent',
    },
  }
}

function newsletterFailed(
  preparation: NewsletterPreparation,
): HostedRuntimeNewsletterToolResponse {
  return {
    action: 'send',
    result: {
      failedRecipientCount: preparation.participantMemberIds.length,
      participantCount: preparation.participantMemberIds.length,
      sentRecipientCount: 0,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'partial_failure',
    },
  }
}

function isNewsletterParentIntent(intent: AssistantOutboxIntent): boolean {
  const target = parseHostedEmailThreadTarget(intent.explicitTarget)
  return target?.targetKind === 'group' && target.recipientMemberId === null
}

function compareOutboxIntentCreationOrder(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return left.createdAt.localeCompare(right.createdAt)
    || left.intentId.localeCompare(right.intentId)
}

function isActiveOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return intent.status === 'awaiting_approval'
    || intent.status === 'pending'
    || intent.status === 'retryable'
    || intent.status === 'sending'
}
