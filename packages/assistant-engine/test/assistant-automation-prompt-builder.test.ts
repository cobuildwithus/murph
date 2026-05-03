import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  inboxShowResultSchema,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  inboxModelAttachmentBundleSchema,
  type InboxModelAttachmentBundle,
} from '../src/inbox-model-contracts.ts'
import type { AssistantUserMessageContentPart } from '../src/assistant/content-types.ts'
import type {
  AssistantInputAttachmentDescriptor,
  AssistantInputProjectionStatus,
  AssistantInputSourceMetadata,
} from '../src/assistant/input-store.ts'

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
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptInput,
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
          parseState: 'succeeded',
          ...overrides,
        },
      ],
    },
  }).capture.attachments[0]
}

function createPromptInput(input: {
  attachmentDescriptors?: readonly AssistantInputAttachmentDescriptor[]
  attachments?: readonly InboxShowResult['capture']['attachments'][number][]
  captureOverrides?: Partial<InboxShowResult['capture']>
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus | null
  sourceMetadata?: AssistantInputSourceMetadata | null
  telegramMetadata?: TelegramAutoReplyMetadata | null
} = {}): AssistantAutoReplyPromptInput {
  const attachments = [...(input.attachments ?? [])]
  const resolvedAttachments = input.captureOverrides?.attachments ?? attachments
  const capture = {
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
    envelopePath: 'inbox/telegram/capture-1.json',
    eventId: 'event-1',
    promotions: [],
    createdAt: '2026-04-08T00:00:01.000Z',
    ...input.captureOverrides,
  }
  const parsedCapture = inboxShowResultSchema.parse({
    vault: '/tmp/assistant-engine-prompt-builder-vault',
    capture: {
      ...capture,
      attachmentCount:
        input.captureOverrides?.attachmentCount ?? resolvedAttachments.length,
      attachments: resolvedAttachments,
    },
  }).capture
  const projectionStatus = input.projectionStatus ?? null
  const projectionReasonCode = input.projectionReasonCode ?? null
  const hasProjection =
    projectionStatus !== null ||
    projectionReasonCode !== null ||
    input.attachmentDescriptors !== undefined ||
    parsedCapture.attachments.length > 0
  return {
    attachmentDescriptors: input.attachmentDescriptors ?? [],
    actorIsSelf: parsedCapture.actorIsSelf,
    conversation: {
      accountId: parsedCapture.accountId,
      actorId: parsedCapture.actorId,
      actorIsSelf: parsedCapture.actorIsSelf,
      source: parsedCapture.source,
      threadId: parsedCapture.threadId,
      threadIsDirect: parsedCapture.threadIsDirect,
    },
    enrichment: parsedCapture.attachments.length > 0
      ? {
          attachments: parsedCapture.attachments,
          inboxCaptureId: parsedCapture.captureId,
        }
      : null,
    inputId: parsedCapture.eventId,
    occurredAt: parsedCapture.occurredAt,
    projection: hasProjection
      ? {
          inboxCaptureId: parsedCapture.captureId,
          reasonCode: projectionReasonCode,
          status: projectionStatus ?? 'succeeded',
        }
      : null,
    receivedAt: parsedCapture.receivedAt,
    replyTarget: null,
    source: parsedCapture.source,
    sourceMetadata: input.sourceMetadata ?? null,
    telegramMetadata: input.telegramMetadata ?? null,
    text: parsedCapture.text,
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
    byteSize: 128,
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
  it('renders parser status instead of deferring pending attachments', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachments: [
          createAttachment({
            parseState: 'running',
          }),
        ],
      }),
    ])

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'Attachment parser status: parser output is not available yet.',
      ),
    })
  })

  it('skips captures with no message text or parsed attachment content', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
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
      reason: 'input has no text or parsed attachment content',
    })
  })

  it('renders projection failure context when inbox enrichment is unavailable', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        captureOverrides: {
          attachments: [],
          text: 'Please look at the voice memo when it is available.',
        },
        projectionReasonCode: 'conversation-import.projection-failed',
        projectionStatus: 'failed',
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Message enrichment:')
    expect(result.prompt).toContain(
      'inbox/parser enrichment failed (conversation-import.projection-failed); use the staged message text and available metadata only.',
    )
    expect(result.prompt).toContain(
      'Message text:\nPlease look at the voice memo when it is available.',
    )
  })

  it('renders minimized assistant-input attachment descriptors without inbox projection', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachmentDescriptors: [
          {
            attachmentId: 'att_photo_1',
            contentType: 'image/jpeg',
            fileName: 'private-photo.jpg',
            kind: 'photo',
            sizeBytes: 1024,
          },
          {
            attachmentId: 'att_voice_1',
            contentType: 'audio/ogg',
            fileName: 'private-voice.ogg',
            kind: 'voice',
            sizeBytes: 2048,
          },
        ],
        captureOverrides: {
          attachmentCount: 2,
          attachments: [],
          text: null,
        },
        projectionReasonCode: 'conversation-import.projection-failed',
        projectionStatus: 'failed',
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Attachment context:\n2 attachments')
    expect(result.prompt).toContain('kinds: image, voice_memo')
    expect(result.prompt).toContain('mime types: audio/ogg, image/jpeg')
    expect(result.prompt).toContain('total size: 3072 bytes')
    expect(result.prompt).toContain(
      'parser/search enrichment: failed (conversation-import.projection-failed)',
    )
    expect(result.prompt).not.toContain('private-photo.jpg')
    expect(result.prompt).not.toContain('private-voice.ogg')
    expect(result.prompt).not.toContain('att_photo_1')
    expect(result.prompt).not.toContain('att_voice_1')
  })

  it('keeps telegram reply context as sufficient textual evidence on its own', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        captureOverrides: {
          text: null,
        },
        telegramMetadata: {
          mediaGroupId: null,
          messageId: '123',
          replyContext: 'Replying to: Poll Lunch? [Pizza | Salad]',
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain(
      'Reply context:\nReplying to: Poll Lunch? [Pizza | Salad]',
    )
    expect(result.prompt).not.toContain('Message text:')
  })

  it('builds grouped prompt text with reply context and attachment excerpts', () => {
    const transcript = 'T'.repeat(2_005)
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
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
      createPromptInput({
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
    expect(result.prompt).toContain('Thread: thread-1')
    expect(result.prompt).toContain('Actor: telegram-user-42 | self=false')
    expect(result.prompt).toContain('Grouped inputs: 2')
    expect(result.prompt).toContain('Telegram media group: present')
    expect(result.prompt).not.toContain('media-group-7')
    expect(result.prompt).toContain('Input 1:')
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
    expect(result.prompt).toContain('Input 2:\nMessage text:\nSecond message')
  })

  it('omits telegram media-group context when grouped captures span different albums', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        captureOverrides: {
          text: 'First message',
        },
        telegramMetadata: {
          mediaGroupId: 'media-group-7',
          messageId: '123',
          replyContext: null,
        },
      }),
      createPromptInput({
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
    expect(result.prompt).toContain('Grouped inputs: 2')
    expect(result.prompt).not.toContain('Telegram media group:')
  })

  it('keeps telegram media-group context when the first grouped capture lacks metadata but later captures agree', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        captureOverrides: {
          text: 'First message',
        },
      }),
      createPromptInput({
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
      createPromptInput({
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
    expect(result.prompt).toContain('Grouped inputs: 3')
    expect(result.prompt).toContain('Telegram media group: present')
    expect(result.prompt).not.toContain('media-group-7')
  })

  it('renders degraded email body-unavailable instructions instead of skipping', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        captureOverrides: {
          source: 'email',
          text: [
            'Received an email message.',
            'Sender summary - sender@example.invalid',
            'Email subject - follow up',
            'Email body unavailable.',
          ].join('\n'),
        },
        sourceMetadata: {
          kind: 'email',
          promptReady: false,
          promptUnavailableReason: 'email.body_unavailable',
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Message availability:')
    expect(result.prompt).toContain('Email body unavailable.')
    expect(result.prompt).toContain(
      'Use only the available sender, recipient, subject, and thread metadata.',
    )
    expect(result.prompt).toContain('Do not assume missing body content.')
    expect(result.prompt).toContain('Message text:\nReceived an email message.')
  })
})

describe('prepareAssistantAutoReplyInput', () => {
  it('prepares descriptor-only attachment context without inbox projection', async () => {
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachmentDescriptors: [
            {
              attachmentId: 'att_photo_1',
              contentType: 'image/jpeg',
              fileName: 'private-photo.jpg',
              kind: 'photo',
              sizeBytes: 1024,
            },
            {
              attachmentId: 'att_voice_1',
              contentType: 'audio/ogg',
              fileName: 'private-voice.ogg',
              kind: 'voice',
              sizeBytes: null,
            },
          ],
          captureOverrides: {
            attachmentCount: 2,
            attachments: [],
            text: null,
          },
          projectionStatus: 'pending',
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Attachment context:\n2 attachments')
    expect(result.prompt).toContain('kinds: image, voice_memo')
    expect(result.prompt).toContain('mime types: audio/ogg, image/jpeg')
    expect(result.prompt).toContain(
      'known total size: 1024 bytes (some sizes unknown)',
    )
    expect(result.prompt).toContain('parser/search enrichment: pending')
    expect(result.prompt).not.toContain('private-photo.jpg')
    expect(result.prompt).not.toContain('private-voice.ogg')
    expect(result.userMessageContent).toBeNull()
    expect(promptBuilderMocks.buildInboxModelAttachmentBundles).not.toHaveBeenCalled()
  })

  it('prepares staged text with projection pending context when no attachment bundle is available', async () => {
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          captureOverrides: {
            attachments: [],
            text: 'Audio note incoming.',
          },
          projectionStatus: 'pending',
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Message enrichment:')
    expect(result.prompt).toContain(
      'inbox/parser enrichment is pending; use the staged message text and available metadata only.',
    )
    expect(result.prompt).toContain('Message text:\nAudio note incoming.')
  })

  it('prepares metadata/status input when parser work is still pending', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle({
        parseState: 'pending',
      }),
    ])
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
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
      kind: 'ready',
      prompt: expect.stringContaining(
        'Attachment parser status: parser output is not available yet.',
      ),
      userMessageContent: null,
    })
    expect(promptBuilderMocks.buildInboxModelAttachmentBundles).toHaveBeenCalled()
    expect(
      promptBuilderMocks.prepareInboxMultimodalUserMessageContent,
    ).toHaveBeenCalled()
  })

  it('emits a safe nonblocking event when attachment bundle preparation fails', async () => {
    const onEvent = vi.fn()
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockRejectedValueOnce(
      new Error('parser bundle failed for private input'),
    )

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [createAttachment()],
          captureOverrides: {
            text: 'Please review the attachment.',
          },
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
      { onEvent },
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Message text:\nPlease review the attachment.')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'input.reply-progress',
      inputId: 'event-1',
      details: 'nonblocking inbox attachment bundle preparation failed',
      safeDetails: 'inbox_attachment_bundle_preparation_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
  })

  it('skips when neither text nor rich evidence can be prepared', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle({
        fileName: null,
        mime: null,
        storedPath: null,
      }),
    ])
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: 'rich evidence unavailable',
      inputMode: 'text-only',
      userMessageContent: null,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
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

  it('prepares multimodal user message content when only raw image evidence remains', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'image',
        mime: 'image/png',
        fileName: 'lunch.png',
        storedPath: 'inbox/attachments/lunch.png',
        routingImage: {
          eligible: true,
          reason: 'supported-format',
          mediaType: 'image/png',
          extension: '.png',
        },
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'metadata',
            path: null,
            text: 'mime: image/png',
            truncated: false,
          },
        ],
        combinedText: '[metadata]\nmime: image/png',
      }),
    ])
    promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(
      true,
    )
    const userMessageContent = createRichUserMessageContent(
      'Attachment image 1 (lunch.png).',
    )
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'multimodal',
      userMessageContent,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'No parsed attachment text is available. If local attachment paths are present in the context, inspect those files with local tools; do not claim a QR or barcode payload was decoded unless it appears in parsed attachment text.',
      ),
      userMessageContent,
    })
  })

  it('keeps PDF-only input as stored-path metadata without routed file evidence', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        storedPath: 'inbox/attachments/scan.pdf',
        parseState: 'succeeded',
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'metadata',
            path: null,
            text: [
              'mime: application/pdf',
              'storedPath: inbox/attachments/scan.pdf',
            ].join('\n'),
            truncated: false,
          },
        ],
        combinedText:
          '[metadata]\nmime: application/pdf\nstoredPath: inbox/attachments/scan.pdf',
      }),
    ])
    promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(
      false,
    )
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'No parsed PDF text is available. The storedPath above is local attachment metadata; inspect that PDF with local tools only if needed.',
      ),
      userMessageContent: null,
    })
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt.')
    }
    expect(result.prompt).toContain('storedPath: inbox/attachments/scan.pdf')
  })

  it('keeps multimodal evidence alongside capture text when rich input is available', async () => {
    const userMessageContent = createRichUserMessageContent(
      'Attachment image 1 (lunch.png).',
    )
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'multimodal',
      userMessageContent,
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
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
      userMessageContent,
    })
  })
})
