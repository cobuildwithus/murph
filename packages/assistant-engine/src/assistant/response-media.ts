import {
  assistantResponseMediaSchema,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
const MAX_ASSISTANT_RESPONSE_MEDIA = 40

export function normalizeAssistantResponseMediaList(
  values: readonly unknown[] | null | undefined,
): AssistantResponseMedia[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const media: AssistantResponseMedia[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const parsed = assistantResponseMediaSchema.parse(value)
    if (seen.has(parsed.url)) {
      continue
    }
    seen.add(parsed.url)
    media.push(parsed)
  }

  if (media.length > MAX_ASSISTANT_RESPONSE_MEDIA) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_MEDIA_LIMIT_EXCEEDED',
      `Assistant responses may attach at most ${MAX_ASSISTANT_RESPONSE_MEDIA} media items.`,
    )
  }

  return media
}
