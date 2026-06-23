import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxServices } from '@murphai/inbox-services'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'
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
  listAssistantOutboxIntents: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  listAssistantTurnReceipts: vi.fn(),
  resolveAssistantSession: vi.fn(),
  sendAssistantMessage: vi.fn(),
}))

vi.mock('../src/assistant/receipts.ts', () => ({
  listAssistantTurnReceipts: replyEventPathMocks.listAssistantTurnReceipts,
}))

vi.mock('../src/assistant/service.ts', () => ({
  sendAssistantMessage: replyEventPathMocks.sendAssistantMessage,
}))

vi.mock('../src/assistant/outbox.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/outbox.ts')
  >('../src/assistant/outbox.ts')
  return {
    ...actual,
    listAssistantOutboxIntents: replyEventPathMocks.listAssistantOutboxIntents,
  }
})

vi.mock('../src/assistant/store.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
    '../src/assistant/store.ts',
  )
  return {
    ...actual,
    listAssistantTranscriptEntries:
      replyEventPathMocks.listAssistantTranscriptEntries,
    resolveAssistantSession: replyEventPathMocks.resolveAssistantSession,
  }
})

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
  replyEventPathMocks.listAssistantOutboxIntents.mockReset().mockResolvedValue([])
  replyEventPathMocks.listAssistantTranscriptEntries
    .mockReset()
    .mockResolvedValue([])
  replyEventPathMocks.listAssistantTurnReceipts.mockReset().mockResolvedValue([])
  replyEventPathMocks.resolveAssistantSession.mockReset().mockRejectedValue(
    Object.assign(new Error('session not found'), {
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    }),
  )
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

  it('injects the latest confirmed cross-session delivery without replacing the chat session', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:02:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        intentId: 'intent-before-last-turn',
        message: 'old reminder',
        sentAt: '2026-04-08T00:01:00.000Z',
        sessionId: 'session-old',
      }),
      createOutboxMessage({
        intentId: 'intent-cross-session',
        message: 'latest cross-session reminder',
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
      }),
      createOutboxMessage({
        intentId: 'intent-same-session',
        message: 'same-session message',
        sentAt: '2026-04-08T00:06:00.000Z',
        sessionId: 'session-chat',
      }),
      createOutboxMessage({
        intentId: 'intent-queued',
        message: 'queued message',
        sentAt: '2026-04-08T00:07:00.000Z',
        sessionId: 'session-queued',
        status: 'pending',
      }),
      createOutboxMessage({
        intentId: 'intent-other-target',
        message: 'other target message',
        sentAt: '2026-04-08T00:08:00.000Z',
        sessionId: 'session-other',
        target: 'thread-2',
      }),
      createOutboxMessage({
        identityId: 'identity-2',
        intentId: 'intent-other-account',
        message: 'other account message',
        sentAt: '2026-04-08T00:09:00.000Z',
        sessionId: 'session-other-account',
      }),
      createOutboxMessage({
        intentId: 'intent-after-input',
        message: 'future message',
        sentAt: '2026-04-08T00:11:00.000Z',
        sessionId: 'session-future',
      }),
    ])
    const candidate = createAssistantInputCandidate({
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      source: 'email',
      text: 'What do I do for this reset?',
      threadIsDirect: true,
    })

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
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
    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.turnContext).toBe([
      'Conversation context:',
      'The assistant previously sent this message in the same conversation from another assistant run:',
      '',
      'latest cross-session reminder',
      '',
      'Use it only to interpret the current user message.',
    ].join('\n'))
    expect(sendInput.prompt).toContain('What do I do for this reset?')
  })

  it('uses the conversation thread only as legacy outbox-history fallback', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:02:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        channel: 'telegram',
        intentId: 'intent-wrong-channel',
        message: 'wrong channel reminder',
        sentAt: '2026-04-08T00:06:00.000Z',
        sessionId: 'session-other-channel',
        target: 'thread-1',
      }),
      createOutboxMessage({
        intentId: 'intent-provider-thread',
        message: 'provider thread reminder',
        providerThreadId: 'thread-1',
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
        target: 'opaque-delivery-target',
      }),
    ])
    const candidate = createAssistantInputCandidate({
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      replyTarget: null,
      source: 'email',
      text: 'Reply in this older projected thread',
      threadIsDirect: true,
    })

    await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
      enabledChannels: ['email'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.deliveryTarget).toBeNull()
    expect(sendInput.turnContext).toContain('provider thread reminder')
    expect(sendInput.turnContext).not.toContain('wrong channel reminder')
  })

  it('matches Telegram sent outbox history with normalized conversation identity', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:02:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        channel: 'telegram',
        identityId: null,
        intentId: 'intent-telegram',
        message: 'telegram reminder',
        providerThreadId: 'thread-1',
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
      }),
    ])
    const candidate = createAssistantInputCandidate({
      accountId: 'telegram-account-1',
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      source: 'telegram',
      text: 'What about this one?',
      threadIsDirect: true,
    })

    await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.turnContext).toContain('telegram reminder')
  })

  it('matches Linq materialized provider threads before cron route fields align', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:02:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        actorId: null,
        channel: 'linq',
        identityId: null,
        intentId: 'intent-linq-materialized',
        message: 'participant-bound cron reminder',
        providerMessageId: 'linq-cron-message-1',
        providerThreadId: 'raw-linq-chat-1',
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
        target: 'raw-linq-chat-1',
        threadId: null,
      }),
    ])
    const candidate = createAssistantInputCandidate({
      accountId: 'lid_linq_identity_1',
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      replyTarget: {
        channel: 'linq',
        messageId: 'linq-user-reply-1',
        threadId: 'raw-linq-chat-1',
      },
      source: 'linq',
      text: 'What is this about?',
      threadIsDirect: true,
    })

    await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
      enabledChannels: ['linq'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.deliveryTarget).toBe('raw-linq-chat-1')
    expect(sendInput.turnContext).toContain('participant-bound cron reminder')
  })

  it('matches hosted email history by stable conversation thread when serialized targets rotate', async () => {
    const vault = await createTempVault()
    const outboundTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<sent-email-message@example.test>',
      references: ['<root-email-message@example.test>'],
      subject: 'Thread context',
      to: ['sender@example.test'],
    })
    const inboundTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<reply-email-message@example.test>',
      references: [
        '<root-email-message@example.test>',
        '<sent-email-message@example.test>',
      ],
      subject: 'Thread context',
      to: ['assistant@example.test'],
    })
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:02:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        intentId: 'intent-hosted-email',
        message: 'serialized target context',
        providerThreadId: null,
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
        target: outboundTarget,
        threadId: 'thread-1',
      }),
    ])
    const candidate = createAssistantInputCandidate({
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      replyTarget: {
        channel: 'email',
        messageId: '<reply-email-message@example.test>',
        threadId: inboundTarget,
      },
      source: 'email',
      text: 'What did you just send?',
      threadIsDirect: true,
    })

    await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
      enabledChannels: ['email'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput.deliveryTarget).toBe(inboundTarget)
    expect(sendInput.turnContext).toContain('serialized target context')
  })

  it('does not repeat cross-session context after the chat session advances', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:06:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantOutboxIntents.mockResolvedValue([
      createOutboxMessage({
        intentId: 'intent-already-seen',
        message: 'already seen reminder',
        sentAt: '2026-04-08T00:05:00.000Z',
        sessionId: 'session-automation',
      }),
    ])
    const candidate = createAssistantInputCandidate({
      occurredAt: '2026-04-08T00:10:00.000Z',
      optionalInboxCaptureId: null,
      source: 'email',
      text: 'Follow-up',
      threadIsDirect: true,
    })

    await processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: createReplyContext(candidate),
      enabledChannels: ['email'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    const sendInput = replyEventPathMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(sendInput).not.toHaveProperty('turnContext')
  })

  it('suppresses a self-authored echo using recent assistant transcript despite timestamp skew', async () => {
    const vault = await createTempVault()
    replyEventPathMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:05:01.000Z',
        sessionId: 'session-chat',
      },
    })
    replyEventPathMocks.listAssistantTranscriptEntries.mockResolvedValue([
      {
        createdAt: '2026-04-08T00:05:01.000Z',
        kind: 'assistant',
        schema: 'murph.assistant-transcript-entry.v1',
        text: 'Reminder sent',
      },
    ])
    const candidate = createAssistantInputCandidate({
      actorIsSelf: true,
      occurredAt: '2026-04-08T00:05:00.000Z',
      optionalInboxCaptureId: null,
      source: 'email',
      text: '  Reminder   sent  ',
      threadIsDirect: true,
    })

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context: createReplyContext(candidate),
      enabledChannels: ['email'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault,
    })

    expect(result).toMatchObject({
      failed: 0,
      replied: 0,
      skipped: 1,
    })
    expect(replyEventPathMocks.sendAssistantMessage).not.toHaveBeenCalled()
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
  accountId?: string | null
  actorIsSelf?: boolean
  inputId?: string
  occurredAt?: string
  optionalInboxCaptureId: string | null
  projectionReasonCode?: string | null
  projectionStatus?: AssistantInputProjectionStatus
  replyTarget?: AssistantInputCandidate['event']['replyTarget']
  source: string
  sourceMetadata?: AssistantInputSourceMetadata
  text: string | null
  threadIsDirect: boolean | null
}): AssistantInputCandidate {
  const inputId = input.inputId ?? 'ain_11111111111111111111111111111111'
  const occurredAt = input.occurredAt ?? '2026-04-08T00:00:00.000Z'
  const conversation: AssistantInputConversationRef = {
    accountId: input.accountId === undefined ? 'identity-1' : input.accountId,
    actorId: 'actor-1',
    actorIsSelf: input.actorIsSelf ?? false,
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
      replyTarget: input.replyTarget === undefined
        ? {
            channel: input.source,
            messageId: 'message-1',
            threadId: 'thread-1',
          }
        : input.replyTarget,
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

function createOutboxMessage(input: {
  actorId?: string | null
  channel?: string
  identityId?: string | null
  intentId: string
  message: string
  providerMessageId?: string | null
  providerMessageIds?: string[]
  providerThreadId?: string | null
  sentAt: string
  sessionId: string
  status?: 'pending' | 'sent'
  target?: string
  threadId?: string | null
}) {
  const status = input.status ?? 'sent'
  const target = input.target ?? 'thread-1'
  const providerThreadId = input.providerThreadId === undefined
    ? target
    : input.providerThreadId
  const channel = input.channel ?? 'email'
  return {
    actorId: input.actorId === undefined ? 'actor-1' : input.actorId,
    channel,
    delivery:
      status === 'sent'
        ? {
            channel,
            idempotencyKey: null,
            kind: 'message',
            messageLength: input.message.length,
            providerMessageId: input.providerMessageId ?? null,
            ...(input.providerMessageIds
              ? { providerMessageIds: input.providerMessageIds }
              : {}),
            providerThreadId,
            sentAt: input.sentAt,
            target,
            targetKind: 'thread',
          }
        : null,
    identityId: input.identityId === undefined ? 'identity-1' : input.identityId,
    intentId: input.intentId,
    message: input.message,
    operation: null,
    sentAt: status === 'sent' ? input.sentAt : null,
    sessionId: input.sessionId,
    status,
    threadId: input.threadId === undefined ? providerThreadId : input.threadId,
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
