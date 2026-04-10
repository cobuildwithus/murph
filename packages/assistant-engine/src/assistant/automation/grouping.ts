import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
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
  const items: AssistantAutoReplyGroupItem[] = [
    {
      summary: first,
      telegramMetadata: await loadCaptureTelegramMetadata(input.vault, first),
    },
  ]
  let endIndex = input.startIndex

  for (let index = input.startIndex + 1; index < input.captures.length; index += 1) {
    const candidate = input.captures[index]
    if (!candidate || !shouldGroupAdjacentConversationCapture(first, candidate)) {
      break
    }

    items.push({
      summary: candidate,
      telegramMetadata: await loadCaptureTelegramMetadata(input.vault, candidate),
    })
    endIndex = index
  }

  return {
    endIndex,
    items,
  }
}

async function loadCaptureTelegramMetadata(
  vault: string,
  capture: InboxListResult['items'][number],
): Promise<TelegramAutoReplyMetadata | null> {
  return await loadTelegramAutoReplyMetadata(
    vault,
    capture.source === 'telegram' ? capture.envelopePath : null,
  )
}

export function shouldGroupAdjacentConversationCapture(
  first: InboxListResult['items'][number],
  candidate: InboxListResult['items'][number],
): boolean {
  return (
    candidate.source === first.source &&
    candidate.threadId === first.threadId &&
    candidate.accountId === first.accountId &&
    candidate.threadIsDirect === first.threadIsDirect &&
    candidate.actorId === first.actorId &&
    candidate.actorIsSelf === first.actorIsSelf
  )
}
