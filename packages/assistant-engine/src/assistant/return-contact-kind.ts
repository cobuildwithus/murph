import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'

export function resolveAssistantHostedReturnContactKind(
  channel: string | null | undefined,
): HostedReturnContactKind | null {
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
