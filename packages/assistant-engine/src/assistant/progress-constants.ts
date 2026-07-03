import type {
  AssistantCodexTurnPromptProfile,
  AssistantCodexTurnToolProfile,
} from './codex-turn/planning.js'
import type {
  AssistantMessageInput,
} from './service-contracts.js'

export const MAX_PROGRESS_UPDATES_PER_TURN = 3

export function shouldCreateAssistantProgressDelivery(
  input: Pick<
    AssistantMessageInput,
    'channel' | 'deliverResponse' | 'deliveryDispatchMode' | 'turnTrigger'
  >,
  profile?: {
    promptProfile?: AssistantCodexTurnPromptProfile | null
    toolProfile?: AssistantCodexTurnToolProfile | null
  } | null,
): boolean {
  // Queue-only dispatch means the outbox owns final-reply delivery, which is
  // how every hosted-runner turn runs. Progress updates are ephemeral
  // current-audience sends that cannot be queued (they would arrive after the
  // final reply), so queue-only suppresses them only when no user is actively
  // waiting: an auto-reply turn answers a live inbound message, while cron
  // and other background turns have no current audience.
  const queueOnlySuppressesProgress =
    input.deliveryDispatchMode === 'queue-only' &&
    input.turnTrigger !== 'automation-auto-reply'
  return input.deliverResponse === true &&
    !queueOnlySuppressesProgress &&
    input.channel !== 'email' &&
    (profile?.toolProfile ?? 'provider-turn') === 'provider-turn' &&
    (profile?.promptProfile ?? 'conversation') !== 'notification-decision'
}
