export interface AssistantGroupPhoneCallAuthority {
  assistantInputId: string
}

export interface ResolveAssistantGroupPhoneCallAuthorityInput {
  acceptedInputIds: readonly string[]
  channel?: string | null
  requestInputId?: string | null
}

/**
 * Resolve authority from the current accepted requester message.
 *
 * Group calls intentionally use the same current-request flow as private calls.
 * The exact participant is still reloaded and authorized through `message_ref`
 * before the call starts; no assistant-authored preview or later confirmation is
 * part of this authority boundary.
 */
export async function resolveAssistantGroupPhoneCallAuthority(
  input: ResolveAssistantGroupPhoneCallAuthorityInput,
): Promise<AssistantGroupPhoneCallAuthority | null> {
  const channel = input.channel?.trim().toLowerCase() ?? null
  if (channel !== 'linq' && channel !== 'telegram') {
    return null
  }

  const currentInputId = input.acceptedInputIds.at(-1) ?? null
  if (!currentInputId) {
    return null
  }
  if (input.requestInputId && input.requestInputId !== currentInputId) {
    return null
  }

  return {
    assistantInputId: currentInputId,
  }
}
