import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  getAssistantChannelAdapter,
  type AssistantChannelActivityHandle,
  type AssistantChannelDependencies,
} from './channel-adapters.js'
import type { AssistantMessageInput, AssistantTurnSharedPlan } from './service-contracts.js'

export function startAssistantChannelTypingIndicator(input: {
  channelDependencies?: AssistantChannelDependencies | null
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantChannelActivityHandle | null {
  if (input.input.deliverResponse !== true) {
    return null
  }

  const audience = input.sharedPlan.conversationPolicy.audience
  const channel = audience.channel ?? input.session.binding.channel ?? null
  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter?.startTypingIndicator) {
    return null
  }
  const startTypingIndicator = adapter.startTypingIndicator

  let activeIndicator: AssistantChannelActivityHandle | null = null
  let stopRequested = false
  const indicatorReady = Promise.resolve()
    .then(() =>
      startTypingIndicator(
        {
          bindingDelivery:
            audience.bindingDelivery ?? input.session.binding.delivery ?? null,
          explicitTarget: audience.explicitTarget,
          identityId:
            audience.identityId ?? input.session.binding.identityId ?? null,
        },
        input.channelDependencies ?? {},
      ),
    )
    .then(async (indicator) => {
      if (!indicator) {
        return null
      }

      if (stopRequested) {
        await runAssistantTypingBestEffort(() => indicator.stop())
        return null
      }

      activeIndicator = indicator
      return indicator
    })
    .catch(() => null)

  return {
    async stop() {
      stopRequested = true
      if (activeIndicator) {
        const indicator = activeIndicator
        activeIndicator = null
        void runAssistantTypingBestEffort(() => indicator.stop())
        return
      }

      void indicatorReady.then((indicator) => {
        if (indicator) {
          activeIndicator = null
          return runAssistantTypingBestEffort(() => indicator.stop())
        }

        return undefined
      })
    },
  }
}

export async function stopAssistantChannelTypingIndicator(
  indicator: AssistantChannelActivityHandle | null,
): Promise<void> {
  if (!indicator) {
    return
  }

  await indicator.stop()
}

async function runAssistantTypingBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task()
  } catch {}
}
