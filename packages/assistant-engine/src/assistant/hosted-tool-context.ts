import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantProgressDeliveryResult,
} from './turn-progress.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'
import type {
  AssistantHostedFamilyPlanTool,
} from './execution-context.js'

export interface AssistantHostedDeliveryContext {
  conversationId: string | null
  recipientKey: string | null
}

export interface AssistantHostedToolContext {
  readonly connectedApps?: AssistantConnectedAppsPort | null
  readonly familyPlanTool?: AssistantHostedFamilyPlanTool | null
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentHostedMailboxItemIds(): readonly string[]
  readonly computerToolsAvailable: boolean
  readonly requiredUserMessageDeliveryAvailable: boolean
  sendRequiredUserMessage(text: string): Promise<AssistantProgressDeliveryResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  connectedApps?: AssistantConnectedAppsPort | null
  familyPlanTool?: AssistantHostedFamilyPlanTool | null
  computerToolsAvailable?: boolean
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  messageInput: AssistantMessageInput
  requiredUserMessageDeliveryAvailable?: boolean
  sendRequiredUserMessage?: (text: string) => Promise<AssistantProgressDeliveryResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const readDeliveryContext = () => input.getDeliveryContext?.() ?? {
    messageInput: input.messageInput,
    session: input.session,
  }

  return {
    connectedApps: input.connectedApps ?? null,
    familyPlanTool: input.familyPlanTool ?? null,
    computerToolsAvailable: input.computerToolsAvailable === true,
    currentHostedDeliveryContext: () => {
      const deliveryContext = readDeliveryContext()
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      const conversationId = context?.conversationId ?? null
      const recipientKey = context?.recipientKey ?? null
      return conversationId || recipientKey
        ? { conversationId, recipientKey }
        : null
    },
    currentHostedMailboxItemIds: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.hostedDeliveryIdempotency
        ?.inboundMailboxItemIds ?? []
    },
    requiredUserMessageDeliveryAvailable:
      input.requiredUserMessageDeliveryAvailable ?? true,
    sendRequiredUserMessage: input.sendRequiredUserMessage ?? (async () => ({
      kind: 'failed',
      source: 'model',
    })),
  }
}
