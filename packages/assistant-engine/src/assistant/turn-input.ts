import type { AssistantUserMessageContentPart } from './content-types.js'
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'

export interface AssistantTurnInputRefreshInput {
  signal?: AbortSignal
}

export interface AssistantTurnInputRefreshResult {
  progressed: boolean
  reason:
    | 'no_port'
    | 'no_new_input'
    | 'ingested_input'
    | 'source_unavailable'
}

export interface AssistantActiveTurnInputAdmissionBaseInput {
  knownProjectionCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
  signal?: AbortSignal
  sessionId: string
  turnId: string
  vault: string
}

export interface AssistantActiveTurnInputAdmissionInput
  extends AssistantActiveTurnInputAdmissionBaseInput {}

export type AssistantActiveTurnInputAdmissionResult =
  | {
      kind: 'no-new-input'
    }
  | {
      acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
      deliveryIdempotencyKey?: string | null
      deliveryReplyToMessageId?: string | null
      deliveryTarget?: string | null
      prompt: string
      receiptMetadata?: Record<string, string> | null
      transcriptText?: string | null
      userMessageContent?: AssistantUserMessageContentPart[] | null
      providerAlreadySteered?: boolean
      kind: 'accepted'
    }

export type AssistantActiveTurnInputAdmissionHook = (
  input: AssistantActiveTurnInputAdmissionInput,
) => Promise<AssistantActiveTurnInputAdmissionResult>

export interface AssistantActiveTurnInputCheckpointInput {
  acceptedInputIds: readonly string[]
  providerRequestOrdinal: number
  sessionId: string
  signal?: AbortSignal
  turnId: string
  vault: string
}

export type AssistantActiveTurnInputCheckpointHook = (
  input: AssistantActiveTurnInputCheckpointInput,
) => Promise<void>

export interface AssistantActiveTurnLiveProviderSteerInput {
  prompt: string
  userMessageContent?: readonly AssistantUserMessageContentPart[] | null
}

export interface AssistantActiveTurnLiveProviderTurn {
  interrupt(): Promise<void>
  codexThreadId: string
  providerTurnId: string
  sessionId: string
  steer(input: AssistantActiveTurnLiveProviderSteerInput): Promise<void>
  turnId: string
}

export interface AssistantActiveTurnLiveProviderSteering {
  registerLiveProviderTurn(input: AssistantActiveTurnLiveProviderTurn): () => void
}

export class AssistantActiveTurnInputBudgetExceededError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input kept arriving during the turn; retry the expanded turn later.',
    )
    this.name = 'AssistantActiveTurnInputBudgetExceededError'
  }
}

export class AssistantActiveTurnInputUnavailableError extends
  AssistantActiveTurnInputBudgetExceededError {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input source is temporarily unavailable; retry the turn later.',
    )
    this.name = 'AssistantActiveTurnInputUnavailableError'
  }
}

export class AssistantActiveTurnInputCheckpointRejectedError extends
  AssistantActiveTurnInputUnavailableError {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input checkpoint was rejected; retry from the last durable checkpoint.',
    )
    this.name = 'AssistantActiveTurnInputCheckpointRejectedError'
  }
}

export function isAssistantActiveTurnInputBudgetExceededError(
  value: unknown,
): value is AssistantActiveTurnInputBudgetExceededError {
  return (
    value instanceof AssistantActiveTurnInputBudgetExceededError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputBudgetExceededError')
  )
}

export function isAssistantActiveTurnInputUnavailableError(
  value: unknown,
): value is AssistantActiveTurnInputUnavailableError {
  return (
    value instanceof AssistantActiveTurnInputUnavailableError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputUnavailableError')
  )
}

export function isAssistantActiveTurnInputCheckpointRejectedError(
  value: unknown,
): value is AssistantActiveTurnInputCheckpointRejectedError {
  return (
    value instanceof AssistantActiveTurnInputCheckpointRejectedError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputCheckpointRejectedError')
  )
}
