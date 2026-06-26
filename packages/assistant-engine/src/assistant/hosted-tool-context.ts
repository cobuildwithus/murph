import type {
  HostedComputerReturnContactKind,
} from '@murphai/hosted-execution/computer-use'
import type {
  AssistantSession,
  AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'

export interface AssistantHostedDeliveryContext {
  conversationId: string | null
  recipientKey: string | null
  returnContactKind: HostedComputerReturnContactKind | null
}

export type AssistantHostedVaultFileSendResult =
  | {
      approvalUrl: string
      filename: string
      status: 'pending'
    }
  | {
      file: AssistantVaultFileResponseMedia
      filename: string
      status: 'approved'
    }
  | {
      filename: string
      status: 'denied' | 'expired'
    }

export interface AssistantHostedToolContext {
  readonly connectedApps?: AssistantConnectedAppsPort | null
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentHostedMailboxItemIds(): readonly string[]
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
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  messageInput: AssistantMessageInput
  sendVaultFile?: (ref: string) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const readDeliveryContext = () => input.getDeliveryContext?.() ?? {
    messageInput: input.messageInput,
    session: input.session,
  }

  return {
    connectedApps: input.connectedApps ?? null,
    computerToolsAvailable: input.computerToolsAvailable === true,
    currentHostedDeliveryContext: () => {
      const deliveryContext = readDeliveryContext()
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      const conversationId = context?.conversationId ?? null
      const recipientKey = context?.recipientKey ?? null
      const returnContactKind = resolveAssistantHostedReturnContactKind(
        deliveryContext.messageInput.channel,
      )
      return conversationId || recipientKey || returnContactKind
        ? { conversationId, recipientKey, returnContactKind }
        : null
    },
    currentHostedMailboxItemIds: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.hostedDeliveryIdempotency
        ?.inboundMailboxItemIds ?? []
    },
    sendVaultFile: input.sendVaultFile ?? (async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: typeof input.sendVaultFile === 'function',
  }
}

function resolveAssistantHostedReturnContactKind(
  channel: string | null | undefined,
): HostedComputerReturnContactKind | null {
  switch (channel?.trim().toLowerCase()) {
    case 'linq':
      return 'text'
    case 'telegram':
      return 'telegram'
    case 'email':
      return 'email'
    default:
      return null
  }
}
