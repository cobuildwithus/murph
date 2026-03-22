import type { AssistantStatePaths } from '@healthybob/runtime-state'
import type {
  AssistantApprovalPolicy,
  AssistantBindingDeliveryKind,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSession,
  AssistantTranscriptEntryKind,
} from '../../assistant-cli-contracts.js'
import type { ConversationRef } from '../conversation-ref.js'

export interface AssistantSessionLocator {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface CreateAssistantSessionInput extends AssistantSessionLocator {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  model?: string | null
  now?: Date
  oss?: boolean
  profile?: string | null
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  vault: string
}

export interface ResolveAssistantSessionInput
  extends CreateAssistantSessionInput {
  createIfMissing?: boolean
  maxSessionAgeMs?: number | null
}

export interface ResolvedAssistantSession {
  created: boolean
  paths: AssistantStatePaths
  session: AssistantSession
}

export interface AssistantTranscriptEntryInput {
  createdAt?: string | null
  kind: AssistantTranscriptEntryKind
  text: string
}
