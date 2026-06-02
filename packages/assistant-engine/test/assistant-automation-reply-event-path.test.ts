import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantInputCandidate } from '../src/assistant/input-source.ts'
import type { AssistantInputConversationRef } from '../src/assistant/input-store.ts'
import type {
  AssistantInputProjectionStatus,
  AssistantInputSourceMetadata,
} from '../src/assistant/input-store.ts'
import {
  assistantAutomationInputSummaryFromCandidate,
} from '../src/assistant/automation/input-summary.ts'
import {
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from '../src/assistant/automation/reply.ts'

const replyEventPathMocks = vi.hoisted(() => ({
  listAssistantTurnReceipts: vi.fn(),
  sendAssistantMessage: vi.fn(),
}))

vi.mock('../src/assistant/receipts.ts', () => ({
  listAssistantTurnReceipts: replyEventPathMocks.listAssistantTurnReceipts,
}))

vi.mock('../src/assistant/service.ts', () => ({
  sendAssistantMessage: replyEventPathMocks.sendAssistantMessage,
}))

const tempRoots: string[] = []

const DEFAULT_TEST_ATTACHMENT_EVIDENCE = {
  attachments: [],
  optionalInboxCaptureId: null,
  reasonCode: null,
  source: null,
  status: 'not_attempted',
  updatedAt: null,
} satisfies AssistantInputCandidate['event']['attachmentEvidence']

beforeEach(() => {
  replyEventPathMocks.listAssistantTurnReceipts.mockReset().mockResolvedValue([])
  replyEventPathMocks.sendAssistantMessage.mockReset().mockResolvedValue({
    delivery: {
      channel: 'email',
      target: 'thread-1',
      sentAt: '2026-04-08T00:10:00.000Z',
    },
    deliveryDeferred: false,
    deliveryError: null,
    deliveryIntentId: null,
    response: 'response text',
    session: {
      sessionId: 'session-1',
    },
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true }),
  ))
})

describe('assistant auto-reply event-first path', () => {
  it('sends from the staged assistant input without prompt-time inbox loading', async () => {
    const vault = await createTempVault()
    const onEvent = vi.fn()
    const staleProjectionCaptureId = 'capture_stale_projection'
    const candidate = createAssistantInputCandidate({
      optionalInboxCaptureId: staleProjectionCaptureId,
      source: 'email',
      text: 'Received an email message.\nEmail subject - status check',
      threadIsDirect: true,
    })
    const context = createReplyContext(candidate)
    const show = vi.fn().mockRejectedValue(
      Object.assign(new Error('capture not found'), {
        code: 'INBOX_CAPTURE_NOT_FOUND',
      }),
    )

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices: createInboxServices({ show }),
      onEvent,
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(show).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        inputId: candidate.event.inputId,
        safeDetails: expect.stringContaining('inbox_projection'),
        type: 'input.reply-progress',
      }),
    )
    expect(replyEventPathMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
    expect(replyEventPathMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          channel: 'email',
          directness: 'direct',
          threadId: 'thread-1',
        }),
        prompt: expect.stringMatching(
          /Received an email message\.[\s\S]*Email subject - status check/,
        ),
        receiptMetadata: {
          autoReplyInputId: candidate.event.inputId,
          autoReplyInputIds: candidate.event.inputId,
        },
      }),
    )
  })

  it('does not let prompt-time inbox service failures abort event-owned replies', async () => {
    const vault = await createTempVault()
    const candidate = createAssistantInputCandidate({
      optionalInboxCaptureId: 'capture_abort_projection',
      source: 'email',
      text: 'Received an email message.',
      threadIsDirect: true,
    })
    const context = createReplyContext(candidate)
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const show = vi.fn().mockRejectedValue(abortError)

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices: createInboxServices({ show }),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(show).not.toHaveBeenCalled()
    expect(replyEventPathMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('sends degraded email body-unavailable prompts to Codex', async () => {
    const vault = await createTempVault()
    const candidate = createAssistantInputCandidate({
      optionalInboxCaptureId: null,
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: false,
        promptUnavailableReason: 'email.body_unavailable',
      },
      text: [
        'Received an email message.',
        'Sender summary - sender@example.invalid',
        'Email subject - status check',
        'Email body unavailable.',
      ].join('\n'),
      threadIsDirect: true,
    })
    const context = createReplyContext(candidate)

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    expect(result).toMatchObject({
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(replyEventPathMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.prompt).toContain('Message availability:')
    expect(sendInput.prompt).toContain('Email body unavailable.')
    expect(sendInput.prompt).toContain(
      'Use only the available sender, recipient, subject, and thread metadata.',
    )
    expect(sendInput.prompt).toContain('Do not assume missing body content.')
  })
})

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'murph-reply-event-path-'))
  tempRoots.push(root)
  return path.join(root, 'vault')
}

function createReplyContext(candidate: AssistantInputCandidate) {
  const context = createAssistantAutoReplyGroupContext([
    {
      inputCandidate: candidate,
      summary: assistantAutomationInputSummaryFromCandidate(candidate),
      telegramMetadata: null,
    },
  ])
  if (!context) {
    throw new Error('expected auto-reply group context')
  }
  return context
}

function createAssistantInputCandidate(input: {
  inputId?: string
  optionalInboxCaptureId: string | null
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus
  source: string
  sourceMetadata?: AssistantInputSourceMetadata
  text: string | null
  threadIsDirect: boolean | null
}): AssistantInputCandidate {
  const inputId = input.inputId ?? 'ain_11111111111111111111111111111111'
  const occurredAt = '2026-04-08T00:00:00.000Z'
  const conversation: AssistantInputConversationRef = {
    accountId: 'identity-1',
    actorId: 'actor-1',
    actorIsSelf: false,
    source: input.source,
    threadId: 'thread-1',
    threadIsDirect: input.threadIsDirect,
  }

  return {
    acceptedInput: {
      captureIds: input.optionalInboxCaptureId ? [input.optionalInboxCaptureId] : [],
      contentRef: {
        kind: 'assistant-input-event',
        refId: inputId,
        version: 'murph.assistant-input-event.v1',
      },
      id: inputId,
      source: 'assistant-input',
      transcriptRef: null,
    },
    event: {
      attachmentCount: 0,
      attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
      attachmentDescriptors: [],
      conversation,
      cursor: {
        createdAt: occurredAt,
        inputId,
        occurredAt,
        sourceKind: 'hosted-mailbox',
        sourcePosition: '1',
      },
      inputId,
      occurredAt,
      receivedAt: occurredAt,
      replyTarget: {
        channel: input.source,
        messageId: 'message-1',
        threadId: 'thread-1',
      },
      source: input.source,
      sourceMetadata: input.sourceMetadata ?? null,
      sourceRef: {
        dedupeKey: 'dedupe-1',
        eventId: 'event-1',
        itemId: 'item-1',
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: '1',
        payloadSchema: 'payload-schema',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'wake-schema',
      },
      text: input.text,
      transcriptText: null,
      userMessageContent: null,
    },
    projection: {
      captureId: input.optionalInboxCaptureId,
      reasonCode: input.projectionReasonCode ?? null,
      status: input.projectionStatus ?? 'succeeded',
    },
  }
}

function createInboxServices(
  overrides: Partial<InboxServices> = {},
): InboxServices {
  const unreachable = async () => {
    throw new Error('unreachable inbox service call')
  }

  return {
    bootstrap: unreachable,
    init: unreachable,
    sourceAdd: unreachable,
    sourceList: unreachable,
    sourceRemove: unreachable,
    sourceSetEnabled: unreachable,
    doctor: unreachable,
    setup: unreachable,
    parse: unreachable,
    requeue: unreachable,
    backfill: unreachable,
    run: unreachable,
    status: unreachable,
    stop: unreachable,
    list: unreachable,
    listAttachments: unreachable,
    showAttachment: unreachable,
    showAttachmentStatus: unreachable,
    show: unreachable,
    search: unreachable,
    preserveDocumentAttachments: unreachable,
    promoteMeal: unreachable,
    promoteDocument: unreachable,
    promoteJournal: unreachable,
    promoteExperimentNote: unreachable,
    ...overrides,
  }
}
