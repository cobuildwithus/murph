import type {
  HostedPhoneCallBrief,
} from '@murphai/hosted-execution/phone-calls'

import {
  resolveAssistantGroupPhoneCallAuthority,
  type AssistantGroupPhoneCallAuthority,
} from './group-phone-call-authority.js'

/**
 * @deprecated Compatibility alias for the old group-preview call sites.
 * Group call authority now comes directly from the current accepted requester
 * message; no preview rendering or delivery lookup occurs here.
 */
export type AssistantGroupPhoneCallPreviewAuthority =
  AssistantGroupPhoneCallAuthority

/** @deprecated Use `resolveAssistantGroupPhoneCallAuthority`. */
export async function resolveDeliveredAssistantGroupPhoneCallPreviewAuthority(
  input: {
    acceptedInputIds: readonly string[]
    brief?: HostedPhoneCallBrief
    channel?: string | null
    confirmationInputId?: string
    sessionId: string
    vault: string
  },
): Promise<AssistantGroupPhoneCallPreviewAuthority | null> {
  return resolveAssistantGroupPhoneCallAuthority({
    acceptedInputIds: input.acceptedInputIds,
    channel: input.channel,
    requestInputId: input.confirmationInputId ?? null,
  })
}
