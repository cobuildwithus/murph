import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'

import { carriesAssistantOutboxPersistedDeliveryCompletionCheckpoint } from '../response-media.js'

/** Receipt evidence includes accepted text even when a later link/media part fails. */
export function getAssistantCronDispatchState(
  intent: AssistantOutboxIntent,
): 'complete' | 'partial' | 'unconfirmed' {
  if (intent.status === 'sent' || carriesAssistantOutboxPersistedDeliveryCompletionCheckpoint(intent)) {
    return 'complete'
  }
  const delivery = intent.delivery
  if (
    delivery !== null
    && delivery.kind !== 'message-reaction'
    && (delivery.providerMessageId !== null || (delivery.providerMessageIds?.length ?? 0) > 0)
  ) {
    return 'partial'
  }
  return 'unconfirmed'
}
