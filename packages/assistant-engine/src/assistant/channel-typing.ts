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
import type { AssistantChannelActivityStopOptions } from './channels/types.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'

const ASSISTANT_TYPING_STOP_WAIT_MS = 2_000

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
  let requestedStopOptions: AssistantChannelActivityStopOptions = {}
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
        void runAssistantTypingBestEffort(() => indicator.stop(requestedStopOptions), {
          timeoutMs: ASSISTANT_TYPING_STOP_WAIT_MS,
        })
        return null
      }

      activeIndicator = indicator
      return indicator
    })
    .catch(() => null)

  return {
    async refreshNow() {
      if (stopRequested) {
        return
      }

      if (activeIndicator?.refreshNow) {
        const indicator = activeIndicator
        await runAssistantTypingBestEffort(() => indicator.refreshNow!())
        return
      }

      await indicatorReady.then((indicator) => {
        if (!stopRequested && indicator?.refreshNow) {
          return runAssistantTypingBestEffort(() => indicator.refreshNow!())
        }

        return undefined
      })
    },
    async stop(options: AssistantChannelActivityStopOptions = {}) {
      stopRequested = true
      requestedStopOptions = options
      if (activeIndicator) {
        const indicator = activeIndicator
        activeIndicator = null
        await runAssistantTypingBestEffort(() => indicator.stop(options), {
          timeoutMs: ASSISTANT_TYPING_STOP_WAIT_MS,
        })
        return
      }

      return
    },
  }
}

export async function stopAssistantChannelTypingIndicator(
  indicator: AssistantChannelActivityHandle | null,
  options: AssistantChannelActivityStopOptions = {},
): Promise<void> {
  if (!indicator) {
    return
  }

  await indicator.stop(options)
}

export function assistantDeliveryOutcomeSupersedesTypingIndicator(
  kind: AssistantDeliveryOutcome['kind'] | null,
): boolean {
  return kind === 'sent' || kind === 'queued'
}

async function runAssistantTypingBestEffort(
  task: () => Promise<unknown>,
  options: {
    timeoutMs?: number
  } = {},
): Promise<void> {
  try {
    const taskPromise = task()
    if (options.timeoutMs) {
      await withAssistantTypingTimeout(taskPromise, options.timeoutMs)
      return
    }

    await taskPromise
  } catch {}
}

async function withAssistantTypingTimeout(
  taskPromise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('ASSISTANT_TYPING_STOP_TIMEOUT'))
    }, timeoutMs)
    if (typeof timeout.unref === 'function') {
      timeout.unref()
    }
  })
  taskPromise.catch(() => {})

  try {
    await Promise.race([taskPromise, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
