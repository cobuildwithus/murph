import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  getAssistantChannelAdapter,
  type AssistantChannelActivityHandle,
  type AssistantChannelDependencies,
} from './channel-adapters.js'
import {
  type AssistantCurrentAudienceDeliveryPrecedence,
  resolveAssistantCurrentAudienceDeliveryFields,
} from './delivery-service.js'
import type { AssistantMessageInput, AssistantTurnSharedPlan } from './service-contracts.js'

export function startAssistantChannelTypingIndicator(input: {
  channelDependencies?: AssistantChannelDependencies | null
  input: AssistantMessageInput
  precedence?: AssistantCurrentAudienceDeliveryPrecedence
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantChannelActivityHandle | null {
  if (input.input.deliverResponse !== true) {
    return null
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    precedence: input.precedence,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const adapter = getAssistantChannelAdapter(deliveryFields.channel)
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
          bindingDelivery: deliveryFields.bindingDelivery,
          explicitTarget: deliveryFields.explicitTarget,
          identityId: deliveryFields.identityId,
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
    async refreshNow() {
      if (activeIndicator?.refreshNow) {
        const indicator = activeIndicator
        await runAssistantTypingBestEffort(() => indicator.refreshNow!())
        return
      }

      await indicatorReady.then((indicator) => {
        if (indicator?.refreshNow) {
          return runAssistantTypingBestEffort(() => indicator.refreshNow!())
        }

        return undefined
      })
    },
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
