export const ASSISTANT_OPERATOR_AUTHORITY_VALUES = [
  'direct-operator',
] as const

export type AssistantOperatorAuthority =
  (typeof ASSISTANT_OPERATOR_AUTHORITY_VALUES)[number]

export function isAssistantOperatorAuthority(
  value: unknown,
): value is AssistantOperatorAuthority {
  return (
    typeof value === 'string' &&
    ASSISTANT_OPERATOR_AUTHORITY_VALUES.includes(
      value as AssistantOperatorAuthority,
    )
  )
}

export function resolveAssistantOperatorAuthority(
  value: unknown,
): AssistantOperatorAuthority {
  return isAssistantOperatorAuthority(value) ? value : 'direct-operator'
}

export function resolveTrustedLocalAssistantOperatorAuthority(
  value: unknown,
): AssistantOperatorAuthority {
  return isAssistantOperatorAuthority(value) ? value : 'direct-operator'
}
