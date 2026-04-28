import { describe, expect, it } from 'vitest'
import type {
  AssistantChatProvider,
  AssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantUserMessageContentPart } from '../../src/assistant/content-types.ts'
import type { ResolvedAssistantFailoverRoute } from '../../src/assistant/failover.js'
import {
  assistantRouteSupportsRichUserMessageContent,
  hasAssistantRichUserMessageContent,
  prioritizeAssistantRoutesForRichUserMessageContent,
  resolveAssistantRouteUserMessageContent,
} from '../../src/assistant/rich-content-routing.js'

const TEXT_AND_IMAGE_USER_MESSAGE_CONTENT: AssistantUserMessageContentPart[] = [
  {
    type: 'text',
    text: 'What is in this image?',
  },
  {
    type: 'image',
    image: new Uint8Array([1, 2, 3]),
    mediaType: 'image/png',
    mimeType: 'image/png',
  },
]

const TEXT_ONLY_USER_MESSAGE_CONTENT: AssistantUserMessageContentPart[] = [
  {
    type: 'text',
    text: 'Reply with a short summary.',
  },
]

const TEXT_AND_FILE_USER_MESSAGE_CONTENT: AssistantUserMessageContentPart[] = [
  {
    type: 'text',
    text: 'Review this PDF.',
  },
  {
    type: 'file',
    data: new Uint8Array([9, 8, 7]),
    filename: 'report.pdf',
    mediaType: 'application/pdf',
  },
]

const TEXT_IMAGE_FILE_USER_MESSAGE_CONTENT: AssistantUserMessageContentPart[] = [
  ...TEXT_AND_IMAGE_USER_MESSAGE_CONTENT,
  {
    type: 'file',
    data: new Uint8Array([4, 5, 6]),
    filename: 'report.pdf',
    mediaType: 'application/pdf',
  },
]

describe('rich-content-routing', () => {
  it('detects when a user message contains multimodal evidence', () => {
    expect(hasAssistantRichUserMessageContent(TEXT_ONLY_USER_MESSAGE_CONTENT)).toBe(false)
    expect(hasAssistantRichUserMessageContent(TEXT_AND_IMAGE_USER_MESSAGE_CONTENT)).toBe(true)
  })

  it('keeps Codex CLI eligible when the current rich content is image-only', () => {
    const codexRoute = createRoute('codex-cli')

    const prioritizedRoutes = prioritizeAssistantRoutesForRichUserMessageContent({
      routes: [codexRoute],
      userMessageContent: TEXT_AND_IMAGE_USER_MESSAGE_CONTENT,
    })

    expect(prioritizedRoutes).toEqual([codexRoute])
  })

  it('keeps Codex as the only route even when files must be dropped', () => {
    const codexRoute = createRoute('codex-cli')

    const prioritizedRoutes = prioritizeAssistantRoutesForRichUserMessageContent({
      routes: [codexRoute],
      userMessageContent: TEXT_AND_FILE_USER_MESSAGE_CONTENT,
    })

    expect(prioritizedRoutes).toEqual([codexRoute])
  })

  it('keeps image evidence for Codex CLI but still drops unsupported file parts', () => {
    const codexRoute = createRoute('codex-cli')

    expect(assistantRouteSupportsRichUserMessageContent(codexRoute)).toBe(true)

    expect(
      resolveAssistantRouteUserMessageContent({
        route: codexRoute,
        userMessageContent: TEXT_IMAGE_FILE_USER_MESSAGE_CONTENT,
      }),
    ).toEqual(TEXT_AND_IMAGE_USER_MESSAGE_CONTENT)
    expect(
      resolveAssistantRouteUserMessageContent({
        route: codexRoute,
        userMessageContent: TEXT_AND_IMAGE_USER_MESSAGE_CONTENT,
      }),
    ).toEqual(TEXT_AND_IMAGE_USER_MESSAGE_CONTENT)
    expect(
      resolveAssistantRouteUserMessageContent({
        route: codexRoute,
        userMessageContent: TEXT_AND_FILE_USER_MESSAGE_CONTENT,
      }),
    ).toBeNull()
    expect(
      resolveAssistantRouteUserMessageContent({
        route: codexRoute,
        userMessageContent: TEXT_ONLY_USER_MESSAGE_CONTENT,
      }),
    ).toEqual(TEXT_ONLY_USER_MESSAGE_CONTENT)
  })
})

function createRoute(provider: AssistantChatProvider): ResolvedAssistantFailoverRoute {
  return {
    codexCommand: null,
    cooldownMs: 60_000,
    label: provider,
    provider,
    providerOptions: createProviderOptions(provider),
    routeId: `${provider}-route`,
  }
}

function createProviderOptions(
  provider: AssistantChatProvider,
): AssistantProviderSessionOptions {
  return {
    continuityFingerprint: `${provider}-fingerprint`,
    provider,
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    profile: null,
    oss: false,
    executionDriver: 'codex-app-server',
    modelProvider: null,
    resumeKind: 'codex-thread',
  }
}
