import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'

export function resolveAssistantHostedReturnContactKind(
  channel: string | null | undefined,
  input?: {
    threadIsDirect?: boolean | null
  },
): HostedReturnContactKind | null {
  switch (channel?.trim().toLowerCase()) {
    case 'linq':
      return input?.threadIsDirect === false ? null : 'text'
    case 'telegram':
      return 'telegram'
    case 'email':
      return 'email'
    default:
      return null
  }
}
