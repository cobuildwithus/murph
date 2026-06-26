import { VaultCliError, type VaultCliErrorDetails } from '../vault-cli-errors.js'

export const assistantDeliveryFailureClassValues = [
  'transient',
  'blocked',
  'terminal',
] as const

export type AssistantDeliveryFailureClass =
  typeof assistantDeliveryFailureClassValues[number]

export const assistantDeliveryResumeTriggerValues = [
  'time',
  'approval_state_change',
  'recipient_inbound',
  'line_health_change',
  'manual_ops',
  'deploy_or_config_change',
  'never',
] as const

export type AssistantDeliveryResumeTrigger =
  typeof assistantDeliveryResumeTriggerValues[number]

export interface AssistantDeliveryFailureDetails {
  assistantDeliveryFailureClass: AssistantDeliveryFailureClass
  assistantDeliveryResumeTrigger: AssistantDeliveryResumeTrigger
  retryable: boolean
}

export function createAssistantDeliveryTransientError(
  code: string,
  message: string,
  details: VaultCliErrorDetails = undefined,
): VaultCliError & { retryable: true } {
  return Object.assign(
    new VaultCliError(code, message, {
      ...details,
      assistantDeliveryFailureClass: 'transient',
      assistantDeliveryResumeTrigger: 'time',
      retryable: true,
    }),
    { retryable: true as const },
  )
}

export function createAssistantDeliveryBlockedError(
  code: string,
  message: string,
  input: {
    blockKind: string
    details?: VaultCliErrorDetails
    resume: Exclude<AssistantDeliveryResumeTrigger, 'time' | 'never'>
  },
): VaultCliError & { retryable: false } {
  return Object.assign(
    new VaultCliError(code, message, {
      ...input.details,
      assistantDeliveryFailureClass: 'blocked',
      assistantDeliveryResumeTrigger: input.resume,
      blockKind: input.blockKind,
      retryable: false,
    }),
    { retryable: false as const },
  )
}

export function createAssistantDeliveryTerminalError(
  code: string,
  message: string,
  details: VaultCliErrorDetails = undefined,
): VaultCliError & { retryable: false } {
  return Object.assign(
    new VaultCliError(code, message, {
      ...details,
      assistantDeliveryFailureClass: 'terminal',
      assistantDeliveryResumeTrigger: 'never',
      retryable: false,
    }),
    { retryable: false as const },
  )
}

export function readAssistantDeliveryFailureClass(
  error: unknown,
): AssistantDeliveryFailureClass | null {
  return readAssistantDeliveryFailureClassValue(
    readRecord(error)?.assistantDeliveryFailureClass,
  ) ?? readAssistantDeliveryFailureClassValue(
    readRecord(readRecord(error)?.context)?.assistantDeliveryFailureClass,
  ) ?? readAssistantDeliveryFailureClassValue(
    readRecord(readRecord(error)?.diagnosticContext)?.assistantDeliveryFailureClass,
  ) ?? readAssistantDeliveryFailureClassValue(
    readRecord(readRecord(error)?.details)?.assistantDeliveryFailureClass,
  )
}

function readAssistantDeliveryFailureClassValue(
  value: unknown,
): AssistantDeliveryFailureClass | null {
  return value === 'transient' || value === 'blocked' || value === 'terminal'
    ? value
    : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}
