import type { AssistantUserMessageContentPart } from './content-types.js'

export interface AssistantActiveTurnProviderHistoryMessage {
  content: string | AssistantUserMessageContentPart[]
  role: 'assistant' | 'user'
}

export interface AssistantActiveTurnProviderHistory {
  acceptedInputIds: readonly string[]
  messages: readonly AssistantActiveTurnProviderHistoryMessage[]
  nonReplayableProviderWork: boolean
}

export function appendAssistantActiveTurnProviderExchange(input: {
  acceptedInputIds?: readonly string[] | null
  assistantResponse: string
  history?: AssistantActiveTurnProviderHistory | null
  nonReplayableProviderWork?: boolean | null
  userMessageContent?: readonly AssistantUserMessageContentPart[] | null
  userPrompt: string
}): AssistantActiveTurnProviderHistory {
  const messages = [...(input.history?.messages ?? [])]
  const userMessage = buildAssistantActiveTurnUserHistoryMessage({
    userMessageContent: input.userMessageContent,
    userPrompt: input.userPrompt,
  })
  if (userMessage) {
    messages.push(userMessage)
  }

  const assistantResponse = input.assistantResponse.trim()
  if (assistantResponse) {
    messages.push({
      content: assistantResponse,
      role: 'assistant',
    })
  }

  return {
    acceptedInputIds: [
      ...(input.acceptedInputIds ?? input.history?.acceptedInputIds ?? []),
    ],
    messages,
    nonReplayableProviderWork:
      input.history?.nonReplayableProviderWork === true ||
      input.nonReplayableProviderWork === true,
  }
}

function buildAssistantActiveTurnUserHistoryMessage(input: {
  userMessageContent?: readonly AssistantUserMessageContentPart[] | null
  userPrompt: string
}): AssistantActiveTurnProviderHistoryMessage | null {
  const content = input.userMessageContent
  if (content && content.length > 0) {
    return {
      content: [...content],
      role: 'user',
    }
  }

  const prompt = input.userPrompt.trim()
  return prompt
    ? {
        content: prompt,
        role: 'user',
      }
    : null
}
