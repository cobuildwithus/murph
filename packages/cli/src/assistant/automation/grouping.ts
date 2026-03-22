import type { InboxListResult } from '../../inbox-cli-contracts.js'
import {
  loadTelegramAutoReplyMetadata,
  type TelegramAutoReplyMetadata,
} from './prompt-builder.js'

export interface AssistantAutoReplyGroupItem {
  summary: InboxListResult['items'][number]
  telegramMetadata: TelegramAutoReplyMetadata | null
}

export async function collectAssistantAutoReplyGroup(input: {
  captures: InboxListResult['items']
  startIndex: number
  vault: string
}): Promise<{
  endIndex: number
  items: AssistantAutoReplyGroupItem[]
}> {
  const first = input.captures[input.startIndex]
  if (!first) {
    return {
      endIndex: input.startIndex,
      items: [],
    }
  }

  const firstMetadata = await loadTelegramAutoReplyMetadata(
    input.vault,
    first.source === 'telegram' ? first.envelopePath : null,
  )
  if (
    first.source !== 'telegram' ||
    firstMetadata === null ||
    firstMetadata.mediaGroupId === null
  ) {
    return {
      endIndex: input.startIndex,
      items: [
        {
          summary: first,
          telegramMetadata: firstMetadata,
        },
      ],
    }
  }

  const items: AssistantAutoReplyGroupItem[] = [
    {
      summary: first,
      telegramMetadata: firstMetadata,
    },
  ]
  let endIndex = input.startIndex

  for (let index = input.startIndex + 1; index < input.captures.length; index += 1) {
    const candidate = input.captures[index]
    if (
      !candidate ||
      candidate.source !== first.source ||
      candidate.threadId !== first.threadId ||
      candidate.actorId !== first.actorId
    ) {
      break
    }

    const candidateMetadata = await loadTelegramAutoReplyMetadata(
      input.vault,
      candidate.envelopePath,
    )
    if (candidateMetadata?.mediaGroupId !== firstMetadata.mediaGroupId) {
      break
    }

    items.push({
      summary: candidate,
      telegramMetadata: candidateMetadata,
    })
    endIndex = index
  }

  return {
    endIndex,
    items,
  }
}
