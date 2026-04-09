import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  inboxShowResultSchema,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  inboxModelAttachmentBundleSchema,
  type InboxModelAttachmentBundle,
} from '../src/inbox-model-contracts.ts'
import { createTempVaultContext } from './test-helpers.ts'
import type { AssistantUserMessageContentPart } from '../src/model-harness.ts'

const promptBuilderMocks = vi.hoisted(() => ({
  buildInboxModelAttachmentBundles: vi.fn(),
  hasInboxMultimodalAttachmentEvidenceCandidate: vi.fn(),
  prepareInboxMultimodalUserMessageContent: vi.fn(),
}))

vi.mock('../src/inbox-multimodal.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inbox-multimodal.ts')>(
    '../src/inbox-multimodal.ts',
  )

  return {
    ...actual,
    buildInboxModelAttachmentBundles:
      promptBuilderMocks.buildInboxModelAttachmentBundles,
    hasInboxMultimodalAttachmentEvidenceCandidate:
      promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate,
    prepareInboxMultimodalUserMessageContent:
      promptBuilderMocks.prepareInboxMultimodalUserMessageContent,
  }
})

import {
  buildAssistantAutoReplyPrompt,
  loadTelegramAutoReplyMetadata,
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptCapture,
  type TelegramAutoReplyMetadata,
} from '../src/assistant/automation/prompt-builder.ts'

beforeEach(() => {
  promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([])
  promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(false)
  promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
    fallbackError: null,
    inputMode: 'text-only',
    userMessageContent: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function createAttachment(
  overrides: Partial<InboxShowResult['capture']['attachments'][number]> = {},
): InboxShowResult['capture']['attachments'][number] {
  return inboxShowResultSchema.parse({
    vault: '/tmp/assistant-engine-prompt-builder-vault',
    capture: {
      captureId: 'fixture-capture',
      source: 'telegram',
      accountId: null,
      externalId: 'external-1',
      threadId: 'thread-1',
      threadTitle: 'Fixture Thread',
      threadIsDirect: true,
      actorId: 'actor-1',
      actorName: 'Fixture Actor',
      actorIsSelf: false,
      occurredAt: '2026-04-08T00:00:00.000Z',
      receivedAt: null,
      text: null,
      attachmentCount: 1,
      envelopePath: 'inbox/telegram/fixture-capture.json',
      eventId: 'event-1',
      promotions: [],
      createdAt: '2026-04-08T00:00:01.000Z',
      attachments: [
        {
          attachmentId: 'attachment-1',
          ordinal: 1,
          externalId: null,
          kind: 'document',
          mime: 'text/plain',
          originalPath: null,
          storedPath: 'inbox/attachments/attachment-1.txt',
          fileName: 'attachment-1.txt',
          byteSize: 128,
          sha256: null,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parserProviderId: null,
          parseState: 'succeeded',
          ...overrides,
        },
      ],
    },
  }).capture.attachments[0]
}

function createPromptCapture(input: {
  attachments?: readonly InboxShowResult['capture']['attachments'][number][]
  captureOverrides?: Partial<InboxShowResult['capture']>
  telegramMetadata?: TelegramAutoReplyMetadata | null
} = {}): AssistantAutoReplyPromptCapture {
  const attachments = [...(input.attachments ?? [])]
  return {
    capture: inboxShowResultSchema.parse({
      vault: '/tmp/assistant-engine-prompt-builder-vault',
      capture: {
        captureId: 'capture-1',
        source: 'telegram',
        accountId: null,
        externalId: 'external-1',
        threadId: 'thread-1',
        threadTitle: 'Family',
        threadIsDirect: true,
        actorId: 'actor-1',
        actorName: 'Taylor',
        actorIsSelf: false,
        occurredAt: '2026-04-08T00:00:00.000Z',
        receivedAt: null,
        text: null,
        attachmentCount: attachments.length,
        envelopePath: 'inbox/telegram/capture-1.json',
        eventId: 'event-1',
        promotions: [],
        createdAt: '2026-04-08T00:00:01.000Z',
        attachments,
        ...input.captureOverrides,
        attachmentCount:
          input.captureOverrides?.attachmentCount ?? attachments.length,
        attachments:
          input.captureOverrides?.attachments !== undefined
            ? input.captureOverrides.attachments
            : attachments,
      },
    }).capture,
    telegramMetadata: input.telegramMetadata ?? null,
  }
}

function createAttachmentBundle(
  overrides: Partial<InboxModelAttachmentBundle> = {},
): InboxModelAttachmentBundle {
  return inboxModelAttachmentBundleSchema.parse({
    attachmentId: 'bundle-1',
    ordinal: 1,
    kind: 'document',
    mime: 'application/pdf',
    fileName: 'scan.pdf',
    storedPath: 'inbox/attachments/scan.pdf',
    parseState: 'succeeded',
    routingImage: {
      eligible: false,
      reason: 'not-image',
      mediaType: null,
      extension: '.pdf',
    },
    fragments: [
      {
        kind: 'attachment_metadata',
        label: 'metadata',
        path: null,
        text: 'mime: application/pdf',
        truncated: false,
      },
    ],
    combinedText: '[metadata]\nmime: application/pdf',
    ...overrides,
  })
}

function createRichUserMessageContent(
  text: string,
): AssistantUserMessageContentPart[] {
  return [
    {
      type: 'text',
      text,
    },
  ]
}

describe('buildAssistantAutoReplyPrompt', () => {
  it('defers when any attachment is still pending parser completion', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        attachments: [
          createAttachment({
            parseState: 'running',
          }),
        ],
      }),
    ])

    expect(result).toEqual({
      kind: 'defer',
      reason: 'waiting for parser completion',
    })
  })

  it('skips captures with no message text or parsed attachment content', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        attachments: [
          createAttachment({
            extractedText: null,
            transcriptText: null,
          }),
        ],
      }),
    ])

    expect(result).toEqual({
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    })
  })

  it('builds grouped prompt text with reply context and attachment excerpts', () => {
    const transcript = 'T'.repeat(2_005)
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        attachments: [
          createAttachment({
            fileName: 'voice-note.m4a',
            kind: 'audio',
            mime: 'audio/m4a',
            transcriptText: transcript,
            extractedText: 'Short extracted text',
          }),
        ],
        captureOverrides: {
          actorId: 'telegram-user-42',
          actorName: null,
          occurredAt: '2026-04-08T10:00:00.000Z',
          text: 'First message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-7',
          messageId: '123',
          replyContext: 'Replying to Alex: Please review the attachment.',
        },
      }),
      createPromptCapture({
        captureOverrides: {
          captureId: 'capture-2',
          occurredAt: '2026-04-08T10:03:00.000Z',
          text: 'Second message',
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    expect(result).toMatchObject({
      kind: 'ready',
    })
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Source: telegram')
    expect(result.prompt).toContain(
      'Occurred at: 2026-04-08T10:00:00.000Z -> 2026-04-08T10:03:00.000Z',
    )
    expect(result.prompt).toContain('Thread: thread-1 (Family)')
    expect(result.prompt).toContain('Actor: telegram-user-42 | self=false')
    expect(result.prompt).toContain('Grouped captures: 2')
    expect(result.prompt).toContain('Telegram media group: media-group-7')
    expect(result.prompt).toContain('Capture 1:')
    expect(result.prompt).toContain(
      'Reply context:\nReplying to Alex: Please review the attachment.',
    )
    expect(result.prompt).toContain(
      'Attachment 1 (audio, voice-note.m4a)',
    )
    expect(result.prompt).toContain(
      'Large parsed attachment content omitted from prompt to keep context small: transcript (2005 chars).',
    )
    expect(result.prompt).toContain('[truncated 1405 characters]')
    expect(result.prompt).toContain('Extracted text:\nShort extracted text')
    expect(result.prompt).toContain('Capture 2:\nMessage text:\nSecond message')
  })

  it('omits telegram media-group context when grouped captures span different albums', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        captureOverrides: {
          text: 'First message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-7',
          messageId: '123',
          replyContext: null,
        },
      }),
      createPromptCapture({
        captureOverrides: {
          captureId: 'capture-2',
          occurredAt: '2026-04-08T10:03:00.000Z',
          text: 'Second message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-8',
          messageId: '124',
          replyContext: null,
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Grouped captures: 2')
    expect(result.prompt).not.toContain('Telegram media group:')
  })

  it('keeps telegram media-group context when the first grouped capture lacks metadata but later captures agree', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        captureOverrides: {
          text: 'First message',
        },
      }),
      createPromptCapture({
        captureOverrides: {
          captureId: 'capture-2',
          occurredAt: '2026-04-08T10:03:00.000Z',
          text: 'Second message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-7',
          messageId: '124',
          replyContext: null,
        },
      }),
      createPromptCapture({
        captureOverrides: {
          captureId: 'capture-3',
          occurredAt: '2026-04-08T10:04:00.000Z',
          text: 'Third message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-7',
          messageId: '125',
          replyContext: null,
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Grouped captures: 3')
    expect(result.prompt).toContain('Telegram media group: media-group-7')
  })
})

describe('prepareAssistantAutoReplyInput', () => {
  it('defers before building multimodal input when parser work is still pending', async () => {
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          attachments: [
            createAttachment({
              parseState: 'pending',
            }),
          ],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'defer',
      reason: 'waiting for parser completion',
    })
    expect(promptBuilderMocks.buildInboxModelAttachmentBundles).not.toHaveBeenCalled()
    expect(
      promptBuilderMocks.prepareInboxMultimodalUserMessageContent,
    ).not.toHaveBeenCalled()
  })

  it('skips when neither text nor rich evidence can be prepared', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle(),
    ])
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: 'rich evidence unavailable',
      inputMode: 'text-only',
      userMessageContent: null,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'skip',
      reason: 'rich evidence unavailable',
    })
    expect(
      promptBuilderMocks.prepareInboxMultimodalUserMessageContent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Source: telegram'),
      }),
    )
  })

  it('requests rich user message content when only multimodal evidence remains', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle(),
    ])
    promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(
      true,
    )
    const userMessageContent = createRichUserMessageContent(
      'Attachment PDF 1 (scan.pdf).',
    )
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'multimodal',
      userMessageContent,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'No parsed attachment text is available. Use attached image or PDF evidence if present.',
      ),
      requiresRichUserMessageContent: true,
      userMessageContent,
    })
  })

  it('keeps rich content optional when capture text already exists', async () => {
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          captureOverrides: {
            text: 'Summarize this incoming message.',
          },
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining('Message text:\nSummarize this incoming message.'),
      requiresRichUserMessageContent: false,
      userMessageContent: null,
    })
  })
})

describe('loadTelegramAutoReplyMetadata', () => {
  it('returns null for blank or unreadable envelope paths', async () => {
    const { vaultRoot } = await createTempVaultContext('assistant-engine-prompt-builder-')

    await expect(loadTelegramAutoReplyMetadata(vaultRoot, null)).resolves.toBeNull()
    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, 'missing/envelope.json'),
    ).resolves.toBeNull()
  })

  it('prefers minimal telegram capture metadata when present', async () => {
    const { vaultRoot } = await createTempVaultContext('assistant-engine-prompt-builder-')
    const relativeEnvelopePath = 'minimal-envelope.json'
    const absoluteEnvelopePath = path.join(vaultRoot, relativeEnvelopePath)

    await writeFile(
      absoluteEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            schema: 'murph.telegram-capture.v1',
            media_group_id: ' media-group-42 ',
            message_id: ' 98765 ',
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, relativeEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: 'media-group-42',
      messageId: '98765',
      replyContext: null,
    })
  })

  it('extracts reply context from business-message telegram envelopes', async () => {
    const { vaultRoot } = await createTempVaultContext('assistant-engine-prompt-builder-')
    const absoluteEnvelopePath = path.join(vaultRoot, 'business-envelope.json')

    await writeFile(
      absoluteEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            business_message: {
              message_id: 444,
              reply_to_message: {
                from: {
                  first_name: 'Alex',
                  last_name: 'Kim',
                },
                contact: {
                  first_name: 'Pat',
                  phone_number: '+15551212',
                },
              },
              quote: {
                text: '   Please call me back soon.   ',
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, absoluteEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '444',
      replyContext:
        'Replying to Alex Kim: Shared contact Pat (+15551212)\nQuoted text: Please call me back soon.',
    })
  })

  it('extracts venue and location reply context from standard telegram messages', async () => {
    const { vaultRoot } = await createTempVaultContext('assistant-engine-prompt-builder-')
    const absoluteEnvelopePath = path.join(vaultRoot, 'venue-envelope.json')

    await writeFile(
      absoluteEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            message: {
              message_id: 445,
              media_group_id: 'venue-group',
              reply_to_message: {
                sender_chat: {
                  title: 'Cafe Bot',
                },
                venue: {
                  title: 'Coffee Shop',
                  address: '1 Main St',
                  location: {
                    latitude: 40.7128,
                    longitude: -74.006,
                  },
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, absoluteEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: 'venue-group',
      messageId: '445',
      replyContext:
        'Replying to Cafe Bot: Shared venue Coffee Shop | 1 Main St | Shared location 40.7128, -74.006',
    })
  })

  it('extracts poll reply context and normalizes username display names', async () => {
    const { vaultRoot } = await createTempVaultContext('assistant-engine-prompt-builder-')
    const absoluteEnvelopePath = path.join(vaultRoot, 'poll-envelope.json')

    await writeFile(
      absoluteEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            message: {
              message_id: '446',
              reply_to_message: {
                from: {
                  username: 'surveybot',
                },
                poll: {
                  question: 'Lunch?',
                  options: [
                    {
                      text: 'Pizza',
                    },
                    {
                      text: 'Salad',
                    },
                  ],
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, absoluteEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '446',
      replyContext: 'Replying to @surveybot: Shared poll Lunch? [Pizza | Salad]',
    })
  })
})
