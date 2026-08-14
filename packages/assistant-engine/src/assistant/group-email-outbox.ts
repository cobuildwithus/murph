import type {
  HostedRuntimeGroupEmailScheduledAuthority,
  HostedRuntimeGroupEmailEffectResponse,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'

import type {
  AssistantHostedGroupEmailEffect,
  AssistantHostedGroupTool,
} from './execution-context.js'
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
} from './outbox.js'

type GroupEmailPreparation = {
  authorizationProof: string
  authority: HostedRuntimeGroupEmailScheduledAuthority
  groupId: string
  participantMemberIds: string[]
  skippedNoEmailMemberIds: string[]
}

export function createAssistantGroupEmailOutboxTool(input: {
  automationAuthority?: AssistantOutboxIntent['automationAuthority']
  authority: HostedRuntimeGroupEmailScheduledAuthority | null
  groupTool: AssistantHostedGroupTool
  recordPendingDeliveryIntentId?: (intentId: string) => void
  sessionId: string
  turnId: string
  vault: string
}): AssistantHostedGroupEmailEffect & { closeCapability(): void } {
  let prepareAttempted = false
  let sendAttempted = false
  let preparation: GroupEmailPreparation | null = null
  const closeCapability = () => {
    preparation = null
    prepareAttempted = true
    sendAttempted = true
  }

  return {
    closeCapability,
    async request(request) {
      if (request.action === 'prepare_email') {
        if (prepareAttempted || sendAttempted) {
          closeCapability()
          return groupEmailUnavailable(
            'prepare_email',
            'group_email_capability_consumed',
          )
        }
        prepareAttempted = true
        const prepared = await input.groupTool.request({
          action: 'prepare_email',
          projectionScopes: request.projectionScopes,
        })
        if (prepared.action !== 'prepare_email') {
          closeCapability()
          return groupEmailUnavailable(
            'prepare_email',
            'group_email_effect_response_mismatch',
          )
        }
        const result: HostedRuntimeGroupEmailEffectResponse = {
          action: 'prepare_email',
          result: prepared.result,
        }
        if (
          input.authority
          && result.action === 'prepare_email'
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
        return groupEmailUnavailable(
          'send_email',
          'group_email_capability_consumed',
        )
      }
      sendAttempted = true
      const prepared = preparation
      preparation = null
      if (!input.authority) {
        return groupEmailUnavailable(
          'send_email',
          'scheduled_automation_required',
        )
      }
      if (
        !prepared
        || prepared.authority.automationId !== input.authority.automationId
        || prepared.authority.occurrenceAt !== input.authority.occurrenceAt
      ) {
        return groupEmailUnavailable(
          'send_email',
          'group_email_preparation_required',
        )
      }
      if (prepared.participantMemberIds.length === 0) {
        return {
          action: 'send_email',
          result: {
            participantCount: 0,
            skippedNoEmailMemberIds: prepared.skippedNoEmailMemberIds,
            status: 'no_recipients',
          },
        }
      }

      const deliveryIdempotencyKey = buildGroupEmailDeliveryIdempotencyKey({
        authority: prepared.authority,
        groupId: prepared.groupId,
      })
      const acceptedDeliveryIdempotencyKeys = [
        deliveryIdempotencyKey,
        // Read-only migration support for a parent accepted before the generic
        // effect key shipped. New writes always use deliveryIdempotencyKey.
        [
          'group-newsletter',
          prepared.authority.automationId,
          prepared.authority.occurrenceAt,
          prepared.groupId,
        ].join(':'),
      ]
      const intents = await listAssistantOutboxIntents(input.vault)
      const currentIntents = intents.filter(
        (intent) => acceptedDeliveryIdempotencyKeys.includes(
          intent.deliveryIdempotencyKey ?? '',
        ),
      )
      const parentIntents = currentIntents
        .filter(isGroupEmailParentIntent)
        .sort(compareOutboxIntentCreationOrder)
      const activeParent = parentIntents.find(isActiveOutboxIntent)
      if (activeParent) {
        input.recordPendingDeliveryIntentId?.(activeParent.intentId)
        return groupEmailAccepted(prepared)
      }

      if (parentIntents.some((intent) => intent.status === 'sent')) {
        return groupEmailSent(prepared)
      }

      if (parentIntents.length > 0) {
        return groupEmailFailed(prepared)
      }

      const parentIntent = await createAssistantOutboxIntent({
        automationAuthority: input.automationAuthority ?? null,
        channel: 'email',
        dedupeToken: [
          'group-email-parent',
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
        groupEmailAuthorizationProof: prepared.authorizationProof,
        sessionId: input.sessionId,
        subject: null,
        threadIsDirect: false,
        turnId: input.turnId,
        vault: input.vault,
      })
      input.recordPendingDeliveryIntentId?.(parentIntent.intentId)
      return groupEmailAccepted(prepared)
    },
  }
}

export async function findAssistantGroupEmailParentIntent(input: {
  authority: HostedRuntimeGroupEmailScheduledAuthority
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const deliveryIdempotencyPrefixes = [
    buildGroupEmailDeliveryIdempotencyPrefix(input.authority),
    // Read-only migration support for parents accepted before the generic
    // effect key shipped. Remove after those parents and children drain.
    `group-newsletter:${input.authority.automationId}:${input.authority.occurrenceAt}:`,
  ]
  const parentIntents = (await listAssistantOutboxIntents(input.vault))
    .filter((intent) =>
      deliveryIdempotencyPrefixes.some((prefix) =>
        intent.deliveryIdempotencyKey?.startsWith(prefix)
      )
      && isGroupEmailParentIntent(intent)
    )
    .sort(compareOutboxIntentCreationOrder)
  return parentIntents.find(isActiveOutboxIntent)
    ?? parentIntents.find((intent) => intent.status === 'sent')
    ?? parentIntents[0]
    ?? null
}

function buildGroupEmailDeliveryIdempotencyKey(input: {
  authority: HostedRuntimeGroupEmailScheduledAuthority
  groupId: string
}): string {
  return `${buildGroupEmailDeliveryIdempotencyPrefix(input.authority)}${input.groupId}`
}

function buildGroupEmailDeliveryIdempotencyPrefix(
  authority: HostedRuntimeGroupEmailScheduledAuthority,
): string {
  return `group-email-effect:${authority.automationId}:${authority.occurrenceAt}:`
}

function groupEmailAccepted(
  preparation: GroupEmailPreparation,
): HostedRuntimeGroupEmailEffectResponse {
  return {
    action: 'send_email',
    result: {
      participantCount: preparation.participantMemberIds.length,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'accepted',
    },
  }
}

function groupEmailUnavailable(
  action: 'prepare_email' | 'send_email',
  unavailableReason: string,
): HostedRuntimeGroupEmailEffectResponse {
  return {
    action,
    result: { status: 'unavailable', unavailableReason },
  }
}

function groupEmailSent(
  preparation: GroupEmailPreparation,
): HostedRuntimeGroupEmailEffectResponse {
  return {
    action: 'send_email',
    result: {
      participantCount: preparation.participantMemberIds.length,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'sent',
    },
  }
}

function groupEmailFailed(
  preparation: GroupEmailPreparation,
): HostedRuntimeGroupEmailEffectResponse {
  return {
    action: 'send_email',
    result: {
      failedRecipientCount: preparation.participantMemberIds.length,
      participantCount: preparation.participantMemberIds.length,
      sentRecipientCount: 0,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'partial_failure',
    },
  }
}

function isGroupEmailParentIntent(intent: AssistantOutboxIntent): boolean {
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
