import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  inboxShowResultSchema,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  attachmentPromptBundleSchema,
  type AttachmentPromptBundle,
} from '../src/attachment-prompt-contracts.ts'
import type {
  AssistantInputAttachmentEvidenceReadFailure,
  AssistantInputAttachmentPromptBundleSource,
} from '../src/assistant/attachment-evidence-model.ts'
import type { AssistantUserMessageContentPart } from '../src/assistant/content-types.ts'
import type {
  AssistantInputAttachmentEvidence,
  AssistantInputAttachmentEvidenceItem,
  AssistantInputAttachmentDescriptor,
  AssistantInputProjectionStatus,
  AssistantInputSourceMetadata,
} from '../src/assistant/input-store.ts'

const promptBuilderMocks = vi.hoisted(() => ({
  buildAssistantInputAttachmentPromptBundles: vi.fn(),
  hasAssistantInputAttachmentEvidenceCandidate: vi.fn(),
  prepareAssistantInputMultimodalUserMessageContent: vi.fn(),
}))

vi.mock('../src/assistant/attachment-evidence-model.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/attachment-evidence-model.ts')>(
    '../src/assistant/attachment-evidence-model.ts',
  )

  return {
    ...actual,
    buildAssistantInputAttachmentPromptBundles:
      promptBuilderMocks.buildAssistantInputAttachmentPromptBundles,
    hasAssistantInputAttachmentEvidenceCandidate:
      promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate,
    prepareAssistantInputMultimodalUserMessageContent:
      promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent,
  }
})

import {
  buildAssistantAutoReplyPrompt,
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptInput,
  type TelegramAutoReplyMetadata,
} from '../src/assistant/automation/prompt-builder.ts'

beforeEach(() => {
  promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([])
  promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(false)
  promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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
  attachmentEvidence?: AssistantInputAttachmentEvidence
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
    attachmentEvidence:
      input.attachmentEvidence ??
      createAttachmentEvidence({
        attachments: parsedCapture.attachments,
        captureId: parsedCapture.captureId,
      }),
    actorIsSelf: parsedCapture.actorIsSelf,
    conversation: {
      accountId: parsedCapture.accountId,
      actorId: parsedCapture.actorId,
      actorIsSelf: parsedCapture.actorIsSelf,
      source: parsedCapture.source,
      threadId: parsedCapture.threadId,
      threadIsDirect: parsedCapture.threadIsDirect,
    },
    inputId: parsedCapture.eventId,
    occurredAt: parsedCapture.occurredAt,
    projection: hasProjection
      ? {
          optionalInboxCaptureId: parsedCapture.captureId,
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

function createAttachmentEvidence(input: {
  attachments: readonly InboxShowResult['capture']['attachments'][number][]
  captureId: string
}): AssistantInputAttachmentEvidence {
  if (input.attachments.length === 0) {
    return {
      attachments: [],
      optionalInboxCaptureId: null,
      reasonCode: null,
      source: null,
      status: 'not_attempted',
      updatedAt: null,
    }
  }

  return {
    attachments: input.attachments.map((attachment) =>
      createAttachmentEvidenceItem(attachment),
    ),
    optionalInboxCaptureId: input.captureId,
    reasonCode: null,
    source: 'manual',
    status: 'available',
    updatedAt: '2026-04-08T00:00:01.000Z',
  }
}

function createAttachmentEvidenceItem(
  attachment: InboxShowResult['capture']['attachments'][number],
): AssistantInputAttachmentEvidenceItem {
  const inlineFragments: AssistantInputAttachmentEvidenceItem['inlineFragments'] = []
  const rawPath = normalizeAttachmentEvidenceRawPath(attachment.storedPath)
  if (attachment.transcriptText) {
    inlineFragments.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      text: attachment.transcriptText,
      truncated: false,
    })
  }
  if (attachment.extractedText) {
    inlineFragments.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      text: attachment.extractedText,
      truncated: false,
    })
  }

  return {
    byteSize: attachment.byteSize ?? null,
    derived: null,
    descriptorAttachmentId: attachment.attachmentId ?? `attachment-${attachment.ordinal}`,
    fileName: attachment.fileName ?? null,
    inlineFragments,
    kind: normalizeAttachmentEvidenceItemKind(attachment.kind),
    mime: attachment.mime ?? null,
    ordinal: attachment.ordinal,
    parseState: normalizeAttachmentEvidenceParseState(attachment.parseState),
    raw: rawPath
      ? {
          byteSize: attachment.byteSize ?? null,
          kind: 'vault-relative-file',
          mediaType: attachment.mime ?? null,
          path: rawPath,
          sha256: attachment.sha256 ?? null,
        }
      : null,
    sourceAttachmentId: attachment.attachmentId ?? `attachment-${attachment.ordinal}`,
  }
}

function normalizeAttachmentEvidenceRawPath(value: string | null | undefined): string | null {
  return value?.startsWith('raw/inbox/')
    ? value
    : null
}

function normalizeAttachmentEvidenceItemKind(
  value: InboxShowResult['capture']['attachments'][number]['kind'],
): AssistantInputAttachmentEvidenceItem['kind'] {
  switch (value) {
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'other':
      return value
    default:
      return 'other'
  }
}

function normalizeAttachmentEvidenceParseState(
  value: InboxShowResult['capture']['attachments'][number]['parseState'],
): AssistantInputAttachmentEvidenceItem['parseState'] {
  switch (value) {
    case 'pending':
    case 'running':
    case 'succeeded':
    case 'failed':
      return value
    default:
      return null
  }
}

function createRawZipAttachmentEvidence(input: {
  parseState: AssistantInputAttachmentEvidenceItem['parseState']
  rawPath: string | null
}): AssistantInputAttachmentEvidence {
  return {
    attachments: [
      {
        byteSize: 4096,
        derived: null,
        descriptorAttachmentId: 'att_zip_1',
        fileName: 'vault-migration-clean-2026-05-04.zip',
        inlineFragments: [],
        kind: 'other',
        mime: 'application/zip',
        ordinal: 1,
        parseState: input.parseState,
        raw: input.rawPath
          ? {
              byteSize: 4096,
              kind: 'vault-relative-file',
              mediaType: 'application/zip',
              path: input.rawPath,
              sha256: null,
            }
          : null,
        sourceAttachmentId: 'att_zip_1',
      },
    ],
    optionalInboxCaptureId: 'capture-1',
    reasonCode: null,
    source: 'manual',
    status: 'available',
    updatedAt: '2026-04-08T00:00:01.000Z',
  }
}

function createAttachmentBundle(
  overrides: Partial<AttachmentPromptBundle> = {},
): AttachmentPromptBundle {
  return attachmentPromptBundleSchema.parse({
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
            kind: 'audio',
            mime: 'audio/mpeg',
            fileName: 'voice-note.mp3',
            parseState: 'running',
          }),
        ],
      }),
    ])

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'Attachment parser status: audio/video transcript is not available yet.',
      ),
    })
  })

  it('renders lifecycle context for captures with attachment evidence but no parsed content', () => {
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

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Attachment evidence:')
    expect(result.prompt).toContain('- provider descriptors: 0')
    expect(result.prompt).toContain('- inbox projection: succeeded')
    expect(result.prompt).toContain('- raw evidence: partial')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).not.toContain('parseState:')
    expect(result.prompt).toContain('Attachment 1\nfileName: attachment-1.txt')
  })

  it('renders raw inbox PDF refs as inspectable metadata in the direct prompt path', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachments: [
          createAttachment({
            kind: 'document',
            mime: 'application/pdf',
            parseState: 'succeeded',
            storedPath: 'raw/inbox/capture-1/attachments/01__scan.pdf',
          }),
        ],
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain(
      'storedPath: raw/inbox/capture-1/attachments/01__scan.pdf',
    )
    expect(result.prompt).toContain(
      'For PDFs, inspect the storedPath with local PDF tools when needed.',
    )
  })

  it('renders raw non-image non-PDF refs with unsupported parser status in the direct prompt path', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachmentEvidence: createRawZipAttachmentEvidence({
          parseState: 'unsupported',
          rawPath:
            'raw/inbox/capture-1/attachments/001.zip',
        }),
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Attachment 1 (other)')
    expect(result.prompt).toContain('fileName: vault-migration-clean-2026-05-04.zip')
    expect(result.prompt).not.toContain('attachmentId:')
    expect(result.prompt).toContain('mime: application/zip')
    expect(result.prompt).toContain('byteSize: 4096')
    expect(result.prompt).toContain('- raw evidence: available')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('rawPath: raw/inbox/')
    expect(result.prompt).toContain(
      'storedPath: raw/inbox/capture-1/attachments/001.zip',
    )
    expect(result.prompt).not.toContain('parseState: unsupported')
    expect(result.prompt).not.toContain('Attachment parser status:')
    expect(result.prompt).toContain(
      'Raw attachment file is available at the storedPath above. Inspect the local file with tools when needed; do not claim file contents unless you have inspected the file or the contents are otherwise present in this turn.',
    )
  })

  it('does not render legacy or unsafe raw paths in direct prompt lifecycle details', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachmentEvidence: createRawZipAttachmentEvidence({
          parseState: 'unsupported',
          rawPath:
            'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.zip',
        }),
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).not.toContain('raw/assistant-input/')
    expect(result.prompt).not.toContain('storedPath:')
    expect(result.prompt).toContain('rawPath: missing')
    expect(result.prompt).not.toContain(
      'Raw attachment file is available at the storedPath above.',
    )
  })

  it('renders mixed parser output lifecycle state when attachment evidence spans multiple parser states', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachments: [
          createAttachment({
            fileName: 'scan-incoming.txt',
            parseState: 'pending',
          }),
          createAttachment({
            fileName: 'vault-migration-clean-2026-05-04.zip',
            ordinal: 2,
            kind: 'document',
            mime: 'application/zip',
            parseState: 'failed',
            storedPath:
              'raw/inbox/capture-1/attachments/001.zip',
          }),
        ],
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Attachment evidence:')
    expect(result.prompt).toContain('- provider descriptors: 0')
    expect(result.prompt).toContain('- raw evidence: partial')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('Attachment 1\nfileName: scan-incoming.txt')
    expect(result.prompt).not.toContain('parseState: pending')
    expect(result.prompt).toContain(
      'Attachment 2\nfileName: vault-migration-clean-2026-05-04.zip',
    )
    expect(result.prompt).not.toContain('parseState: failed')
    expect(result.prompt).toContain('storedPath: raw/inbox/')
    expect(result.prompt).toContain(
      'Raw attachment file is available at the storedPath above. Inspect the local file with tools when needed; do not claim file contents unless you have inspected the file or the contents are otherwise present in this turn.',
    )
  })

  it('recognizes MIME-less from inbox PDF refs from the stored path extension', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachments: [
          createAttachment({
            kind: 'document',
            mime: null,
            parseState: 'succeeded',
            storedPath:
              'raw/inbox/capture-1/attachments/001.pdf',
          }),
        ],
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain(
      'storedPath: raw/inbox/capture-1/attachments/001.pdf',
    )
    expect(result.prompt).toContain(
      'For PDFs, inspect the storedPath with local PDF tools when needed.',
    )
  })

  it('does not render attachment evidence context for text-only projection failures', () => {
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
    expect(result.prompt).toContain(
      'Message text:\nPlease look at the voice memo when it is available.',
    )
    expect(result.prompt).not.toContain('Message evidence:')
    expect(result.prompt).not.toContain('attachment evidence')
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
    expect(result.prompt).toContain('Attachment context:\nAttachment evidence:')
    expect(result.prompt).toContain('- provider descriptors: 2')
    expect(result.prompt).toContain(
      '- inbox projection: failed(conversation-import.projection-failed)',
    )
    expect(result.prompt).toContain('- raw evidence: not_attempted')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('Attachment 1\nfileName: private-photo.jpg')
    expect(result.prompt).toContain('kind: image')
    expect(result.prompt).toContain('mime: image/jpeg')
    expect(result.prompt).toContain('byteSize: 1024')
    expect(result.prompt).toContain('rawPath: missing')
    expect(result.prompt).not.toContain('parseState: unknown')
    expect(result.prompt).toContain('Attachment 2\nfileName: private-voice.ogg')
    expect(result.prompt).toContain('kind: voice_memo')
    expect(result.prompt).toContain('mime: audio/ogg')
    expect(result.prompt).toContain('byteSize: 2048')
    expect(result.prompt).toContain(
      '- raw evidence: not_attempted',
    )
    expect(result.prompt).not.toContain('att_photo_1')
    expect(result.prompt).not.toContain('att_voice_1')
  })

  it('renders lifecycle detail for each provider descriptor without ids', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachmentDescriptors: Array.from({ length: 10 }, (_, index) => ({
          attachmentId: `att_file_${index + 1}`,
          contentType: 'application/zip',
          fileName: `archive-${index + 1}.zip`,
          kind: 'document',
          sizeBytes: 4096,
        })),
        captureOverrides: {
          attachmentCount: 10,
          attachments: [],
          text: null,
        },
        projectionStatus: 'pending',
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain('Attachment 1\nfileName: archive-1.zip')
    expect(result.prompt).toContain('Attachment 8\nfileName: archive-8.zip')
    expect(result.prompt).toContain('Attachment 9\nfileName: archive-9.zip')
    expect(result.prompt).toContain('Attachment 10\nfileName: archive-10.zip')
    expect(result.prompt).not.toContain('att_file_1')
  })

  it('renders quarantined projection status distinctly in lifecycle context', () => {
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
        ],
        captureOverrides: {
          attachmentCount: 1,
          attachments: [],
          text: null,
        },
        projectionReasonCode: 'conversation-import.unsafe-payload',
        projectionStatus: 'quarantined',
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt result.')
    }
    expect(result.prompt).toContain(
      '- inbox projection: quarantined(conversation-import.unsafe-payload)',
    )
    expect(result.prompt).not.toContain(
      '- inbox projection: failed(conversation-import.unsafe-payload)',
    )
    expect(result.prompt).not.toContain('att_photo_1')
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
      'Attachment 1 (audio)',
    )
    expect(result.prompt).toContain('fileName: voice-note.m4a')
    expect(result.prompt).toContain(
      'Large audio/video attachment transcript content omitted from prompt to keep context small: transcript (2005 chars).',
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
    expect(result.prompt).toContain('Attachment context:\nAttachment evidence:')
    expect(result.prompt).toContain('- provider descriptors: 2')
    expect(result.prompt).toContain('- inbox projection: pending')
    expect(result.prompt).toContain('- raw evidence: not_attempted')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('Attachment 1\nfileName: private-photo.jpg')
    expect(result.prompt).toContain('kind: image')
    expect(result.prompt).toContain('mime: image/jpeg')
    expect(result.prompt).toContain('byteSize: 1024')
    expect(result.prompt).toContain('Attachment 2\nfileName: private-voice.ogg')
    expect(result.prompt).toContain('kind: voice_memo')
    expect(result.prompt).toContain('mime: audio/ogg')
    expect(result.prompt).toContain('byteSize: unknown')
    expect(result.userMessageContent).toBeNull()
    expect(promptBuilderMocks.buildAssistantInputAttachmentPromptBundles).not.toHaveBeenCalled()
  })

  it('prepares staged text without attachment context for text-only pending projections', async () => {
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
    expect(result.prompt).toContain('Message text:\nAudio note incoming.')
    expect(result.prompt).not.toContain('Message evidence:')
    expect(result.prompt).not.toContain('attachment evidence')
  })

  it('renders projection not-attempted context distinctly from pending', async () => {
    const descriptorResult = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachmentDescriptors: [
            {
              attachmentId: 'att_photo_1',
              contentType: 'image/jpeg',
              fileName: null,
              kind: 'photo',
              sizeBytes: null,
            },
          ],
          captureOverrides: {
            attachments: [],
            text: 'Photo incoming.',
          },
          projectionStatus: 'not_attempted',
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(descriptorResult.kind).toBe('ready')
    if (descriptorResult.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(descriptorResult.prompt).toContain('- inbox projection: not_attempted')
    expect(descriptorResult.prompt).toContain('- raw evidence: not_attempted')

    const messageResult = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          captureOverrides: {
            attachments: [],
            text: 'Photo incoming.',
          },
          projectionStatus: 'not_attempted',
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(messageResult.kind).toBe('ready')
    if (messageResult.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(messageResult.prompt).toContain('Message text:\nPhoto incoming.')
    expect(messageResult.prompt).not.toContain('Message evidence:')
    expect(messageResult.prompt).not.toContain('attachment evidence')
  })

  it('prepares metadata/status input when media transcript work is still pending', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'audio',
        mime: 'audio/mpeg',
        fileName: 'voice-note.mp3',
        parseState: 'pending',
      }),
    ])
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'audio',
              mime: 'audio/mpeg',
              fileName: 'voice-note.mp3',
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
        'Attachment parser status: audio/video transcript is not available yet.',
      ),
      userMessageContent: null,
    })
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('- raw evidence: partial')
    expect(result.prompt).toContain('parseState: pending')
    expect(promptBuilderMocks.buildAssistantInputAttachmentPromptBundles).toHaveBeenCalled()
    expect(
      promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent,
    ).toHaveBeenCalled()
  })

  it('prepares raw non-image non-PDF attachment evidence with unsupported parser status', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'other',
        mime: 'application/zip',
        fileName: 'vault-migration-clean-2026-05-04.zip',
        byteSize: 4096,
        storedPath:
          'raw/inbox/capture-1/attachments/001.zip',
        parseState: 'unsupported',
        routingImage: {
          eligible: false,
          reason: 'not-image',
          mediaType: null,
          extension: '.zip',
        },
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'attachment-1-metadata',
            path:
              'raw/inbox/capture-1/attachments/001.zip',
            text: [
              'ordinal: 1',
              'kind: other',
              'mime: application/zip',
              'byteSize: 4096',
              'storedPath: raw/inbox/capture-1/attachments/001.zip',
              'parseState: unsupported',
              'routingImageEligible: false',
              'routingImageReason: not-image',
              'routingImageMediaType: unknown',
              'routingImageExtension: .zip',
            ].join('\n'),
            truncated: false,
          },
        ],
        combinedText: [
          '[attachment-1-metadata]',
          'ordinal: 1',
          'kind: other',
          'mime: application/zip',
          'byteSize: 4096',
          'storedPath: raw/inbox/capture-1/attachments/001.zip',
          'parseState: unsupported',
          'routingImageEligible: false',
          'routingImageReason: not-image',
          'routingImageMediaType: unknown',
          'routingImageExtension: .zip',
        ].join('\n'),
      }),
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachmentEvidence: createRawZipAttachmentEvidence({
            parseState: 'unsupported',
            rawPath:
              'raw/inbox/capture-1/attachments/001.zip',
          }),
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('- raw evidence: available')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('rawPath: raw/inbox/')
    expect(result.prompt).toContain('Attachment 1 (other)')
    expect(result.prompt).toContain('storedPath: raw/inbox/')
    expect(result.prompt).not.toContain('parseState: unsupported')
    expect(result.prompt).not.toContain('Attachment parser status:')
    expect(result.prompt).toContain(
      'Raw attachment file is available at the storedPath above. Inspect the local file with tools when needed; do not claim file contents unless you have inspected the file or the contents are otherwise present in this turn.',
    )
    expect(result.userMessageContent).toBeNull()
  })

  it('does not render untrusted prepared bundle combinedText', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        byteSize: 4096,
        storedPath: 'raw/inbox/capture-1/attachments/001.pdf',
        parseState: null,
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'attachment-1-metadata',
            path: 'raw/inbox/capture-1/attachments/001.pdf',
            text: [
              'ordinal: 1',
              'kind: document',
              'mime: application/pdf',
              'byteSize: 4096',
              'storedPath: raw/inbox/capture-1/attachments/001.pdf',
              'routingImageEligible: false',
              'routingImageReason: not-image',
            ].join('\n'),
            truncated: false,
          },
        ],
        combinedText: [
          'provider secret marker',
          'https://provider.example/download?token=secret',
          '/tmp/provider-download.pdf',
          'storedPath: raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.pdf',
        ].join('\n'),
      }),
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachmentEvidence: createRawZipAttachmentEvidence({
            parseState: null,
            rawPath: 'raw/inbox/capture-1/attachments/001.pdf',
          }),
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('storedPath: raw/inbox/capture-1/attachments/001.pdf')
    expect(result.prompt).not.toContain('provider secret marker')
    expect(result.prompt).not.toContain('provider.example')
    expect(result.prompt).not.toContain('/tmp/provider-download.pdf')
    expect(result.prompt).not.toContain('raw/assistant-input/')
  })

  it('keeps raw inbox paths even when filenames look sensitive', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        byteSize: 4096,
        storedPath: 'raw/inbox/capture-1/attachments/api-key.pdf',
        parseState: null,
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'attachment-1-metadata',
            path: 'raw/inbox/capture-1/attachments/api-key.pdf',
            text: 'storedPath: raw/inbox/capture-1/attachments/api-key.pdf',
            truncated: false,
          },
        ],
        combinedText: 'storedPath: raw/inbox/capture-1/attachments/api-key.pdf',
      }),
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachmentEvidence: createRawZipAttachmentEvidence({
            parseState: null,
            rawPath: 'raw/inbox/capture-1/attachments/001.pdf',
          }),
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('raw/inbox/capture-1/attachments/api-key.pdf')
    expect(result.prompt).not.toContain('storedPath: missing')
  })

  it('prepares metadata-only projected attachments whose raw artifact is missing', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'other',
        mime: 'application/zip',
        fileName: 'vault-migration-clean-2026-05-04.zip',
        byteSize: 4096,
        storedPath: null,
        parseState: 'succeeded',
        routingImage: {
          eligible: false,
          reason: 'not-image',
          mediaType: null,
          extension: '.zip',
        },
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'attachment-1-metadata',
            path: null,
            text: [
              'ordinal: 1',
              'kind: other',
              'mime: application/zip',
              'byteSize: 4096',
              'storedPath: missing',
              'parseState: succeeded',
              'routingImageEligible: false',
              'routingImageReason: not-image',
              'routingImageMediaType: unknown',
              'routingImageExtension: .zip',
            ].join('\n'),
            truncated: false,
          },
        ],
        combinedText: [
          '[attachment-1-metadata]',
          'ordinal: 1',
          'kind: other',
          'mime: application/zip',
          'byteSize: 4096',
          'storedPath: missing',
          'parseState: succeeded',
          'routingImageEligible: false',
          'routingImageReason: not-image',
          'routingImageMediaType: unknown',
          'routingImageExtension: .zip',
        ].join('\n'),
      }),
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'other',
              mime: 'application/zip',
              parseState: 'succeeded',
              storedPath: null,
            }),
          ],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Attachment 1 (other)')
    expect(result.prompt).toContain('storedPath: missing')
    expect(result.prompt).not.toContain('parseState: succeeded')
    expect(result.prompt).not.toContain(
      'Raw attachment file is available at the storedPath above.',
    )
  })

  it('renders prepared media parser text without raw-file instructions', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'audio',
        mime: 'audio/mpeg',
        fileName: 'voice-note.mp3',
        storedPath: 'raw/inbox/capture-1/attachments/01__voice-note.mp3',
        parseState: 'succeeded',
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'attachment-1-metadata',
            path: null,
            text: 'mime: text/plain',
            truncated: false,
          },
          {
            kind: 'derived_plain_text',
            label: 'attachment-1-text',
            path: null,
            text: 'Parsed note text.',
            truncated: false,
          },
        ],
        combinedText: [
          '[attachment-1-metadata]',
          'mime: text/plain',
          '',
          '[attachment-1-text]',
          'Parsed note text.',
        ].join('\n'),
      }),
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'audio',
              mime: 'audio/mpeg',
              storedPath:
                'raw/inbox/capture-1/attachments/01__voice-note.mp3',
            }),
          ],
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Attachment 1 (audio)')
    expect(result.prompt).toContain('[attachment-1-text]\nParsed note text.')
    expect(result.prompt).not.toContain(
      'Raw attachment file is available at the storedPath above.',
    )
    expect(result.prompt).not.toContain('Attachment parser status:')
    expect(result.userMessageContent).toBeNull()
  })

  it('emits a safe nonblocking event when attachment bundle preparation fails', async () => {
    const onEvent = vi.fn()
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockRejectedValueOnce(
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
      details: 'nonblocking attachment evidence bundle preparation failed',
      safeDetails: 'attachment_evidence_bundle_preparation_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
  })

  it('emits a safe nonblocking event when rich attachment evidence cannot be read', async () => {
    const onEvent = vi.fn()
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValueOnce([
      createAttachmentBundle({
        kind: 'image',
        mime: 'image/jpeg',
        routingImage: {
          eligible: true,
          reason: 'supported-format',
          mediaType: 'image/jpeg',
          extension: '.jpg',
        },
      }),
    ])
    promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(true)
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockImplementationOnce(
      async (input: {
        onEvidenceReadFailure?: (
          failure: AssistantInputAttachmentEvidenceReadFailure,
        ) => void
      }) => {
        input.onEvidenceReadFailure?.({
          attachmentOrdinal: 1,
          details: 'attachment 1 image evidence unavailable',
          errorCode: 'image_read_failed',
          kind: 'image',
        })
        return {
          fallbackError: null,
          inputMode: 'text-only',
          userMessageContent: null,
        }
      },
    )

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'image',
              mime: 'image/jpeg',
              storedPath: 'raw/inbox/capture-1/attachments/01__image.jpg',
            }),
          ],
          captureOverrides: {
            text: 'Please review the attachment.',
          },
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
      { onEvent },
    )

    expect(result.kind).toBe('ready')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'input.reply-progress',
      inputId: 'event-1',
      details: 'nonblocking attachment evidence read failed',
      errorCode: 'image_read_failed',
      failureContext: {
        attachmentOrdinal: 1,
      },
      safeDetails: 'attachment_evidence_read_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
  })

  it('attributes grouped attachment read failures by input id when ordinals repeat', async () => {
    const onEvent = vi.fn()
    const firstBundle = createAttachmentBundle({
      attachmentId: 'bundle-1',
      kind: 'image',
      mime: 'image/jpeg',
      ordinal: 1,
      routingImage: {
        eligible: true,
        reason: 'supported-format',
        mediaType: 'image/jpeg',
        extension: '.jpg',
      },
    })
    const secondBundle = createAttachmentBundle({
      attachmentId: 'bundle-2',
      kind: 'image',
      mime: 'image/png',
      ordinal: 1,
      routingImage: {
        eligible: true,
        reason: 'supported-format',
        mediaType: 'image/png',
        extension: '.png',
      },
    })
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles
      .mockResolvedValueOnce([firstBundle])
      .mockResolvedValueOnce([secondBundle])
    promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(true)
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockImplementationOnce(
      async (input: {
        attachmentSources: readonly AssistantInputAttachmentPromptBundleSource[]
        onEvidenceReadFailure?: (
          failure: AssistantInputAttachmentEvidenceReadFailure,
        ) => void
      }) => {
        const firstSource = input.attachmentSources[0]
        const secondSource = input.attachmentSources[1]
        if (
          !firstSource ||
          !secondSource ||
          !('bundle' in firstSource) ||
          !('bundle' in secondSource)
        ) {
          throw new Error('Expected paired attachment sources.')
        }

        expect(firstSource.inputId).toBe('event-1')
        expect(firstSource.bundle).toBe(firstBundle)
        expect(secondSource.inputId).toBe('event-2')
        expect(secondSource.bundle).toBe(secondBundle)
        input.onEvidenceReadFailure?.({
          attachmentOrdinal: secondSource.bundle.ordinal,
          details: 'attachment 1 image evidence unavailable',
          errorCode: 'image_read_failed',
          inputId: secondSource.inputId,
          kind: 'image',
        })
        return {
          fallbackError: null,
          inputMode: 'text-only',
          userMessageContent: null,
        }
      },
    )

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'image',
              mime: 'image/jpeg',
              storedPath: 'raw/inbox/capture-1/attachments/01__image.jpg',
            }),
          ],
          captureOverrides: {
            eventId: 'event-1',
            text: 'First photo.',
          },
        }),
        createPromptInput({
          attachments: [
            createAttachment({
              attachmentId: 'attachment-2',
              kind: 'image',
              mime: 'image/png',
              storedPath: 'raw/inbox/capture-2/attachments/01__image.png',
            }),
          ],
          captureOverrides: {
            captureId: 'capture-2',
            eventId: 'event-2',
            text: 'Second photo.',
          },
        }),
      ],
      '/tmp/assistant-engine-prompt-builder-vault',
      { onEvent },
    )

    expect(result.kind).toBe('ready')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'input.reply-progress',
      inputId: 'event-2',
      details: 'nonblocking attachment evidence read failed',
      errorCode: 'image_read_failed',
      failureContext: {
        attachmentOrdinal: 1,
      },
      safeDetails: 'attachment_evidence_read_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
  })

  it('keeps lifecycle context when rich evidence cannot be prepared', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        fileName: null,
        mime: null,
        storedPath: null,
      }),
    ])
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Attachment evidence:')
    expect(result.prompt).toContain('- raw evidence: partial')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.userMessageContent).toBeNull()
    expect(
      promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Source: telegram'),
      }),
    )
  })

  it('prepares multimodal user message content when only raw image evidence remains', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
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
    promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(
      true,
    )
    const userMessageContent = createRichUserMessageContent(
      'Attachment image 1 (lunch.png).',
    )
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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
        'No decoded attachment text is available. Inspect local attachment paths with tools when needed; do not claim a QR or barcode payload was decoded unless it appears in explicit text evidence.',
      ),
      userMessageContent,
    })
  })

  it('keeps PDF-only input as stored-path metadata without routed file evidence', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      createAttachmentBundle({
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        storedPath: 'raw/inbox/capture-1/attachments/scan.pdf',
        parseState: 'succeeded',
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'metadata',
            path: null,
            text: [
              'mime: application/pdf',
              'storedPath: raw/inbox/capture-1/attachments/scan.pdf',
            ].join('\n'),
            truncated: false,
          },
        ],
        combinedText:
          '[metadata]\nmime: application/pdf\nstoredPath: raw/inbox/capture-1/attachments/scan.pdf',
      }),
    ])
    promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(
      false,
    )
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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
        'For PDFs, inspect the storedPath with local PDF tools when needed.',
      ),
      userMessageContent: null,
    })
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt.')
    }
    expect(result.prompt).toContain('storedPath: raw/inbox/capture-1/attachments/scan.pdf')
  })

  it('keeps multimodal evidence alongside capture text when rich input is available', async () => {
    const userMessageContent = createRichUserMessageContent(
      'Attachment image 1 (lunch.png).',
    )
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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
