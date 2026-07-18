import {
  ASSISTANT_GROUP_CHALLENGE_PREPARED_BODY_MAX_LENGTH,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
} from './scheduled-task-authority.js'

export {
  ASSISTANT_GROUP_CHALLENGE_PREPARED_BODY_MAX_LENGTH,
} from '@murphai/operator-config/assistant-cli-contracts'

export function buildAssistantGroupChallengeDispatchCommit(input: {
  authority: AssistantScheduledTaskAuthority | null | undefined
  occurrenceAt: string | null | undefined
  outboxAutomationAuthority:
    AssistantOutboxIntent['automationAuthority'] | null | undefined
  privateSummary: string
}): AssistantOutboxIntent['groupChallengeDispatch'] {
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (authority.kind !== 'group_challenge') {
    return null
  }
  if (
    input.outboxAutomationAuthority?.automationId !== authority.automationId ||
    input.outboxAutomationAuthority?.expectedUpdatedAt !==
      authority.expectedUpdatedAt
  ) {
    throw new VaultCliError(
      'ASSISTANT_GROUP_CHALLENGE_AUTHORITY_INVALID',
      'A group-challenge send requires matching scheduled and outbox authority.',
    )
  }

  const preparedBody = input.privateSummary.trim()
  if (
    preparedBody.length === 0 ||
    preparedBody.length > ASSISTANT_GROUP_CHALLENGE_PREPARED_BODY_MAX_LENGTH
  ) {
    throw new VaultCliError(
      'ASSISTANT_GROUP_CHALLENGE_DISPATCH_RECORD_INVALID',
      'A group-challenge send requires one bounded private dispatch record.',
    )
  }

  const occurrenceAt = input.occurrenceAt?.trim() ?? ''
  const occurrence = new Date(occurrenceAt)
  if (
    !occurrenceAt ||
    Number.isNaN(occurrence.getTime()) ||
    occurrence.toISOString() !== occurrenceAt
  ) {
    throw new VaultCliError(
      'ASSISTANT_GROUP_CHALLENGE_OCCURRENCE_INVALID',
      'A group-challenge send requires the exact trusted scheduled occurrence.',
    )
  }

  return {
    occurrenceAt,
    preparedBody,
    scheduledTask: {
      kind: 'group_challenge',
      knowledgeSlug: authority.slug,
      projectionScopeKey: authority.projectionScopeKey,
    },
  }
}
