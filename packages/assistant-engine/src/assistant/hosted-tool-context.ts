import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'
import type {
  AssistantPhoneCallPort,
} from './execution-context.js'

export interface AssistantHostedDeliveryContext {
  conversationId: string | null
  recipientKey: string | null
}

export interface AssistantHostedToolRequestKeyScope {
  acceptedInputIds: readonly string[]
  conversationId: string | null
  inboundMailboxItemIds: readonly string[]
  recipientKey: string | null
}

export type AssistantHostedVaultFileSendResult =
  | {
      approvalUrl: string
      filename: string
      status: 'pending'
    }
  | {
      filename: string
      status: 'approved' | 'denied' | 'expired'
    }

export interface AssistantHostedToolContext {
  readonly connectedApps?: AssistantConnectedAppsPort | null
  readonly phoneCalls?: AssistantPhoneCallPort | null
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentHostedMailboxItemIds(): readonly string[]
  currentPhoneCallToolRequestKeyScope?(): AssistantHostedToolRequestKeyScope | null
  currentHostedToolRequestKeyScope(): AssistantHostedToolRequestKeyScope
  readonly computerToolsAvailable: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(ref: string): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  connectedApps?: AssistantConnectedAppsPort | null
  computerToolsAvailable?: boolean
  getAcceptedInputIds?: () => readonly string[]
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getPhoneCallAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  phoneCalls?: AssistantPhoneCallPort | null
  sendVaultFile?: (ref: string) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const readDeliveryContext = () => input.getDeliveryContext?.() ?? {
    messageInput: input.messageInput,
    session: input.session,
  }
  const buildRequestKeyScope = (
    acceptedInputIds: readonly string[],
  ): AssistantHostedToolRequestKeyScope => {
    const deliveryContext = readDeliveryContext()
    const context = deliveryContext.messageInput.hostedDeliveryIdempotency
    return {
      acceptedInputIds: [...acceptedInputIds],
      conversationId: context?.conversationId ?? null,
      inboundMailboxItemIds: context?.inboundMailboxItemIds ?? [],
      recipientKey: context?.recipientKey ?? null,
    }
  }

  return {
    connectedApps: input.connectedApps ?? null,
    phoneCalls: input.phoneCalls ?? null,
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
    currentHostedToolRequestKeyScope: () =>
      buildRequestKeyScope(input.getAcceptedInputIds?.() ?? []),
    currentPhoneCallToolRequestKeyScope: () => {
      const acceptedInputIds = input.getPhoneCallAcceptedInputIds?.() ?? []
      return acceptedInputIds.length > 0
        ? buildRequestKeyScope(acceptedInputIds)
        : null
    },
    sendVaultFile: input.sendVaultFile ?? (async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: typeof input.sendVaultFile === 'function',
  }
}
