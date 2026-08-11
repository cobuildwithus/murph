import type { AssistantStatePaths } from '@murphai/runtime-state/node'
import type {
  AssistantApprovalPolicy,
  AssistantBindingDeliveryKind,
  AssistantChatProvider,
  AssistantModelTarget,
  AssistantSandbox,
  AssistantSession,
  AssistantTranscriptEntryKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { ConversationRef } from '../conversation-ref.js'

export interface AssistantSessionLocator {
  actorId?: string | null
  alias?: string | null
  bindingDeliveryTarget?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface CreateAssistantSessionInput extends AssistantSessionLocator {
  approvalPolicy?: AssistantApprovalPolicy | null
  codexHome?: string | null
  model?: string | null
  modelProvider?: string | null
  now?: Date
  oss?: boolean
  profile?: string | null
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  target?: AssistantModelTarget | null
  vault: string
}

export interface ResolveAssistantSessionInput
  extends CreateAssistantSessionInput {
  allowBindingRebind?: boolean
  createIfMissing?: boolean
  maxSessionAgeMs?: number | null
}

export type AssistantSessionResolutionLookupSource =
  | 'alias'
  | 'conversation-key'
  | 'created'
  | 'session-id'

export type AssistantConversationLookupScope = 'actor' | 'none' | 'thread'

export interface AssistantSessionResolutionDiagnostics {
  actorFallbackConversationIndexed: boolean | null
  conversationLookupIndexedCandidateCount: number | null
  conversationLookupKeyCount: number
  conversationLookupMatchedScope: AssistantConversationLookupScope | null
  primaryConversationIndexed: boolean | null
  legacyAudienceContinuity?: 'migrated' | 'reset'
  sessionResolutionLookupSource: AssistantSessionResolutionLookupSource
}

export interface ResolvedAssistantSession {
  created: boolean
  paths: AssistantStatePaths
  resolutionDiagnostics?: AssistantSessionResolutionDiagnostics
  session: AssistantSession
}

export interface AssistantTranscriptEntryInput {
  contentReceivedAt?: string | null
  createdAt?: string | null
  kind: AssistantTranscriptEntryKind
  sourceOutboxIntentId?: string | null
  text: string
}

export interface AssistantTranscriptEntryRef {
  entryCreatedAt: string
  entryIndex: number
  entryKind: AssistantTranscriptEntryKind
  sessionId: string
}
