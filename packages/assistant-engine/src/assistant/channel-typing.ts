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
}): (AssistantChannelActivityHandle & {
  recordAcceptedInputs: (acceptedInputIds: readonly string[]) => void
}) | null {
  if (input.input.deliverResponse !== true) {
    return null
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    precedence: input.precedence,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const channel = deliveryFields.channel
  const adapter = getAssistantChannelAdapter(channel)
  if (!channel || !adapter?.startTypingIndicator) {
    return null
  }
  const startTypingIndicator = adapter.startTypingIndicator

  let activeIndicator: AssistantChannelActivityHandle | null = null
  let acceptedAt: string | null = null
  let stopRequested = false
  let requestedStopOptions: AssistantChannelActivityStopOptions = {}
  const indicatorReady = Promise.resolve()
    .then(() =>
      startTypingIndicator(
        {
          bindingDelivery: deliveryFields.bindingDelivery,
          explicitTarget: deliveryFields.explicitTarget,
          identityId: deliveryFields.identityId,
          replyToMessageId: deliveryFields.replyToMessageId,
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

      acceptedAt = new Date().toISOString()
      activeIndicator = indicator
      return indicator
    })
    .catch(() => null)

  return {
    recordAcceptedInputs(acceptedInputIds) {
      if (!input.channelDependencies?.onTypingAccepted || acceptedInputIds.length === 0) {
        return
      }
      // Admission and provider acceptance may happen in either order. Both belong
      // to this turn's existing handle; diagnostic I/O never blocks admission.
      void indicatorReady.then((indicator) => {
        if (!indicator || !acceptedAt || stopRequested || input.input.abortSignal?.aborted
          || indicator.isActive?.() === false) {
          return
        }
        return input.channelDependencies?.onTypingAccepted?.({
          acceptedInputIds,
          at: acceptedAt,
          channel,
        })
      }).catch(() => {})
    },
    async refreshAfterMessage() {
      await refreshAssistantChannelTypingIndicator({
        activeIndicator,
        indicatorReady,
        preferAfterMessageRefresh: true,
        stopRequested: () => stopRequested,
      })
    },
    async refreshNow() {
      await refreshAssistantChannelTypingIndicator({
        activeIndicator,
        indicatorReady,
        preferAfterMessageRefresh: false,
        stopRequested: () => stopRequested,
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

async function refreshAssistantChannelTypingIndicator(input: {
  activeIndicator: AssistantChannelActivityHandle | null
  indicatorReady: Promise<AssistantChannelActivityHandle | null>
  preferAfterMessageRefresh: boolean
  stopRequested: () => boolean
}): Promise<void> {
  if (input.stopRequested()) {
    return
  }

  if (input.activeIndicator) {
    const indicator = input.activeIndicator
    const refresh = selectAssistantChannelTypingRefresh(
      indicator,
      input.preferAfterMessageRefresh,
    )
    if (refresh) {
      await runAssistantTypingBestEffort(() => refresh.call(indicator))
    }
    return
  }

  await input.indicatorReady.then((indicator) => {
    if (!indicator || input.stopRequested()) {
      return undefined
    }
    const refresh = selectAssistantChannelTypingRefresh(
      indicator,
      input.preferAfterMessageRefresh,
    )
    return refresh
      ? runAssistantTypingBestEffort(() => refresh.call(indicator))
      : undefined
  })
}

function selectAssistantChannelTypingRefresh(
  indicator: AssistantChannelActivityHandle,
  preferAfterMessageRefresh: boolean,
): (() => Promise<void>) | undefined {
  return preferAfterMessageRefresh
    ? indicator.refreshAfterMessage ?? indicator.refreshNow
    : indicator.refreshNow
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
