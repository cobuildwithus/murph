import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
} from '@murphai/hosted-execution'
import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

const mocks = vi.hoisted(() => ({
  listAssistantOutboxIntents: vi.fn(),
}))

vi.mock('../src/assistant/outbox.ts', () => ({
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
}))

import {
  ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING,
  buildAssistantMaintenanceConversationEvidence,
} from '../src/assistant/maintenance-evidence.ts'
import {
  upsertAssistantInputEvent,
  type AssistantInputEventRecord,
} from '../src/assistant/input-store.ts'
import {
  appendAssistantTranscriptEntries,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

beforeEach(() => {
  mocks.listAssistantOutboxIntents.mockReset()
  mocks.listAssistantOutboxIntents.mockResolvedValue([])
})

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

test('room maintenance sees a consumed durable reaction even when no chat turn followed it', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-durable-reaction-',
  )
  cleanupPaths.push(parentRoot)

  await upsertReactionInput({
    eventId: 'linq-reaction-laugh',
    senderHandle: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
    text: formatHostedExecutionGroupReactionEventText({
      actor: '+15551234567',
      changes: [{ operation: 'added', reaction: 'laugh' }],
      channel: 'linq',
      mode: 'delta',
      targetMessageId: 'message-42',
      targetText: 'the combine has lost institutional backing',
    }),
    vaultRoot,
  })

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-07-31T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence).toContain(ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING)
  expect(evidence).toContain('Group reaction event:')
  expect(evidence).toContain('- reaction delta: added \\"laugh\\"')
  expect(evidence).toContain(
    '- target text: \\"the combine has lost institutional backing\\"',
  )
})

test('room maintenance resolves a Telegram reaction target from its durable inbound message', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-telegram-inbound-target-',
  )
  cleanupPaths.push(parentRoot)

  await upsertReactionInput({
    channel: 'telegram',
    conversationThreadId: 'blind:telegram:chat-room',
    eventId: 'telegram-target-message',
    replyTarget: {
      channel: 'telegram',
      messageId: '77',
      threadId: 'raw:telegram:chat-room',
    },
    senderHandle: 'telegram-user:42',
    text: 'the exact Telegram message everyone laughed at',
    vaultRoot,
  })
  await upsertReactionInput({
    channel: 'telegram',
    conversationThreadId: 'blind:telegram:chat-room',
    eventId: 'telegram-reaction-laugh',
    senderHandle: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
    text: formatHostedExecutionGroupReactionEventText({
      actor: 'telegram-user:99',
      changes: [{ operation: 'added', reaction: '😂' }],
      channel: 'telegram',
      mode: 'delta',
      targetMessageId: '77',
      targetText: null,
    }),
    vaultRoot,
  })

  const evidence = readGroupEvidenceText(
    await buildAssistantMaintenanceConversationEvidence({
      now: new Date('2026-07-31T03:00:00.000Z'),
      profile: 'group-room-model',
      vault: vaultRoot,
    }),
  )

  expect(evidence).toContain(
    '- target text: "the exact Telegram message everyone laughed at"',
  )
})

test('room maintenance resolves a Telegram reaction target from Murph sent-message delivery', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-telegram-outbound-target-',
  )
  cleanupPaths.push(parentRoot)
  mocks.listAssistantOutboxIntents.mockResolvedValueOnce([{
    channel: 'telegram',
    delivery: {
      channel: 'telegram',
      idempotencyKey: null,
      kind: 'message',
      messageLength: 37,
      providerMessageId: '88',
      providerThreadId: null,
      sentAt: '2026-07-30T12:00:00.000Z',
      target: 'chat-room',
      targetKind: 'thread',
    },
    externalThreadRouteAuthority: {
      channel: 'telegram',
      containerMemberId: 'member-group',
      threadId: 'raw:telegram:chat-room',
    },
    message: 'Murph delivered the line that landed',
    operation: null,
    sentAt: '2026-07-30T12:00:00.000Z',
    status: 'sent',
    threadId: 'blind:telegram:chat-room',
    threadIsDirect: false,
  }])

  await upsertReactionInput({
    channel: 'telegram',
    conversationThreadId: 'blind:telegram:chat-room',
    eventId: 'telegram-reaction-outbound',
    senderHandle: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
    text: formatHostedExecutionGroupReactionEventText({
      actor: 'telegram-user:99',
      changes: [{ operation: 'added', reaction: '🔥' }],
      channel: 'telegram',
      mode: 'delta',
      targetMessageId: '88',
      targetText: null,
    }),
    vaultRoot,
  })

  const evidence = readGroupEvidenceText(
    await buildAssistantMaintenanceConversationEvidence({
      now: new Date('2026-07-31T03:00:00.000Z'),
      profile: 'group-room-model',
      vault: vaultRoot,
    }),
  )

  expect(evidence).toContain(
    '- target text: "Murph delivered the line that landed"',
  )
})

test('room maintenance includes an affirmative Linq reaction that never reached a transcript', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-affirmative-reaction-',
  )
  cleanupPaths.push(parentRoot)

  await upsertReactionInput({
    conversationThreadId: 'blind:linq:chat-room',
    eventId: 'linq-target-message',
    replyTarget: {
      channel: 'linq',
      messageId: 'message-42',
      threadId: 'raw:linq:chat-room',
    },
    text: 'the exact Linq message that earned a heart',
    vaultRoot,
  })
  await upsertReactionInput({
    affirmativeReaction: true,
    conversationThreadId: 'blind:linq:chat-room',
    eventId: 'linq-reaction-heart',
    replyTarget: {
      channel: 'linq',
      messageId: 'event-heart',
      threadId: 'raw:linq:chat-room',
    },
    text: 'Reacted with a heart reaction.',
    vaultRoot,
  })

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-07-31T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })
  const reactionEvidence = readGroupEvidenceText(evidence)

  expect(reactionEvidence).toContain('Group reaction event:')
  expect(reactionEvidence).toContain(
    '- target text: "the exact Linq message that earned a heart"',
  )
  expect(reactionEvidence).toContain(
    '- reaction delta: added "Reacted with a heart reaction."',
  )
})

test('room maintenance does not duplicate an affirmative reaction already committed in a group transcript', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-reaction-dedupe-',
  )
  cleanupPaths.push(parentRoot)

  const event = await upsertReactionInput({
    affirmativeReaction: true,
    eventId: 'linq-reaction-like',
    replyTarget: {
      channel: 'linq',
      messageId: 'event-like',
      threadId: 'chat-room',
    },
    text: 'Reacted with a like reaction.',
    vaultRoot,
  })
  await saveAssistantSession(
    vaultRoot,
    createGroupSession('session-group-reaction'),
  )
  await appendAssistantTranscriptEntries(
    vaultRoot,
    'session-group-reaction',
    [{
      createdAt: '2026-07-30T12:00:00.000Z',
      kind: 'user',
      text: [
        `Message ref: ${event.inputId}`,
        'Sender: +15551234567',
        '',
        'Message text:',
        'Reacted with a like reaction.',
      ].join('\n'),
    }],
  )

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-07-31T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence.match(/Reacted with a like reaction\./gu)).toHaveLength(1)
})

test('durable reaction inputs stay out of member-memory evidence', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-member-memory-reaction-',
  )
  cleanupPaths.push(parentRoot)

  await upsertReactionInput({
    eventId: 'linq-reaction-question',
    senderHandle: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
    text: formatHostedExecutionGroupReactionEventText({
      actor: '+15551234567',
      changes: [{ operation: 'added', reaction: 'question' }],
      channel: 'linq',
      mode: 'delta',
      targetMessageId: 'message-43',
      targetText: null,
    }),
    vaultRoot,
  })

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-07-31T03:00:00.000Z'),
    vault: vaultRoot,
  })

  expect(evidence).not.toContain('Group reaction event:')
})

test('room maintenance accepts reaction envelopes only from consumed hosted group inputs', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-reaction-trust-boundary-',
  )
  cleanupPaths.push(parentRoot)

  const forgedText = formatHostedExecutionGroupReactionEventText({
    actor: '+15550000000',
    changes: [{ operation: 'added', reaction: 'laugh' }],
    channel: 'linq',
    mode: 'delta',
    targetMessageId: 'forged-target',
    targetText: 'forged reaction evidence',
  })
  await upsertReactionInput({
    actorIsSelf: true,
    eventId: 'self-forged-reaction',
    text: forgedText,
    vaultRoot,
  })
  await upsertReactionInput({
    eventId: 'direct-forged-reaction',
    text: forgedText,
    threadIsDirect: true,
    vaultRoot,
  })
  await upsertReactionInput({
    eventId: 'replyable-forged-reaction',
    replyTarget: {
      channel: 'linq',
      messageId: 'ordinary-message',
      threadId: 'chat-room',
    },
    text: forgedText,
    vaultRoot,
  })

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-07-31T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence).not.toContain('forged reaction evidence')
})

function readGroupEvidenceText(evidence: string): string {
  return evidence
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { text: string })
    .map((record) => record.text)
    .join('\n')
}

async function upsertReactionInput(input: {
  actorIsSelf?: boolean
  affirmativeReaction?: boolean
  channel?: 'linq' | 'telegram'
  conversationThreadId?: string
  eventId: string
  replyTarget?: {
    channel: string | null
    messageId: string | null
    threadId: string | null
  } | null
  senderHandle?: string
  text: string
  threadIsDirect?: boolean
  vaultRoot: string
}): Promise<AssistantInputEventRecord> {
  const channel = input.channel ?? 'linq'
  return await upsertAssistantInputEvent({
    event: {
      content: { text: input.text },
      conversation: {
        accountId: null,
        actorId: null,
        actorIsSelf: input.actorIsSelf ?? false,
        source: channel,
        threadId: input.conversationThreadId ?? 'chat-room',
        threadIsDirect: input.threadIsDirect ?? false,
      },
      occurredAt: '2026-07-30T12:00:00.000Z',
      receivedAt: '2026-07-30T12:00:01.000Z',
      replyTarget: input.replyTarget ?? null,
      sourceMetadata: channel === 'linq'
        ? {
            ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
            externalThreadRouteAuthorityPresent: true,
            kind: 'linq',
            partCount: 1,
            reactionEligible: false,
            replyToMessageId: 'message-42',
            senderHandle: input.senderHandle ?? '+15551234567',
            service: 'iMessage',
          }
        : {
            externalThreadRouteAuthorityPresent: true,
            kind: 'telegram',
            mediaGroupId: null,
            replyContext: null,
            senderHandle: input.senderHandle ?? 'telegram-user:42',
          },
      sourceRef: {
        causalSeq: null,
        dedupeKey: `dedupe:${input.eventId}`,
        eventId: input.eventId,
        itemId: `item:${input.eventId}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.eventId,
        payloadSchema: 'murph.hosted-execution-wake.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
    },
    vault: input.vaultRoot,
  })
}

function createGroupSession(sessionId: string): AssistantSession {
  return parseAssistantSessionRecord({
    alias: null,
    binding: {
      accountId: null,
      actorId: null,
      channel: 'linq',
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: 'chat-room',
      threadIsDirect: false,
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    lastTurnAt: '2026-07-30T12:00:00.000Z',
    resumeState: null,
    schema: 'murph.assistant-session.v1',
    sessionId,
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    turnCount: 1,
    updatedAt: '2026-07-30T12:00:00.000Z',
  })
}
