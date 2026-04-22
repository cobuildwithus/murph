import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import { isSameAssistantConversationCapture } from '../conversation-ref.js'
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
    await createAssistantAutoReplyGroupItem(input.vault, first),
  ]
  let endIndex = input.startIndex

  for (let index = input.startIndex + 1; index < input.captures.length; index += 1) {
    const candidate = input.captures[index]
    if (!candidate || !shouldGroupAdjacentConversationCapture(first, candidate)) {
      break
    }

    items.push(await createAssistantAutoReplyGroupItem(input.vault, candidate))
    endIndex = index
  }

  return {
    endIndex,
    items,
  }
}

export async function loadAssistantAutoReplyGroupItems(input: {
  captures: readonly InboxListResult['items'][number][]
  vault: string
}): Promise<AssistantAutoReplyGroupItem[]> {
  return Promise.all(
    input.captures.map((capture) =>
      createAssistantAutoReplyGroupItem(input.vault, capture),
    ),
  )
}

async function createAssistantAutoReplyGroupItem(
  vault: string,
  capture: InboxListResult['items'][number],
): Promise<AssistantAutoReplyGroupItem> {
  return {
    summary: capture,
    telegramMetadata: await loadCaptureTelegramMetadata(vault, capture),
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
  return isSameAssistantConversationCapture(first, candidate)
}
