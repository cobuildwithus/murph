import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { afterEach, describe, it } from 'vitest'
import {
  hasPendingAssistantAutoReplyInput,
} from '../src/assistant-automation.ts'
import {
  writeAssistantAutoReplySuppressionEvidence,
} from '../src/assistant/automation/evidence.ts'
import {
  createStoreBackedAssistantInputSource,
} from '../src/assistant/input-source.ts'
import {
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('hasPendingAssistantAutoReplyInput', () => {
  it('reports scanner-visible input after the channel cursor', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-automation-pending-input-',
    )
    tempRoots.push(parentRoot)
    const first = await stageHostedInput({
      eventId: 'evt_pending_first',
      laneSeq: '1',
      occurredAt: '2026-06-02T12:00:00.000Z',
      text: 'first',
      vault: vaultRoot,
    })
    const second = await stageHostedInput({
      eventId: 'evt_pending_second',
      laneSeq: '2',
      occurredAt: '2026-06-02T12:01:00.000Z',
      text: 'second',
      vault: vaultRoot,
    })
    const inputSource = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    assert.equal(
      await hasPendingAssistantAutoReplyInput({
        inputSource,
        state: {
          autoReply: [{
            channel: 'linq',
            eligibleAfter: first.cursor,
            enabledAt: '2026-06-02T12:00:00.000Z',
          }],
        },
        vault: vaultRoot,
      }),
      true,
    )
    assert.equal(
      await hasPendingAssistantAutoReplyInput({
        inputSource,
        state: {
          autoReply: [{
            channel: 'linq',
            eligibleAfter: second.cursor,
            enabledAt: '2026-06-02T12:00:00.000Z',
          }],
        },
        vault: vaultRoot,
      }),
      false,
    )
  })

  it('ignores terminal inputs instead of waking from latest cursor alone', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-automation-pending-input-terminal-',
    )
    tempRoots.push(parentRoot)
    const first = await stageHostedInput({
      eventId: 'evt_terminal_first',
      laneSeq: '1',
      occurredAt: '2026-06-02T12:00:00.000Z',
      text: 'terminal first',
      vault: vaultRoot,
    })
    const second = await stageHostedInput({
      eventId: 'evt_terminal_second',
      laneSeq: '2',
      occurredAt: '2026-06-02T12:01:00.000Z',
      text: 'terminal second',
      vault: vaultRoot,
    })
    const inputSource = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })
    const state = {
      autoReply: [{
        channel: 'linq',
        eligibleAfter: null,
        enabledAt: '2026-06-02T12:00:00.000Z',
      }],
    }

    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [],
      inputIds: [first.inputId],
      reason: 'already handled',
      recordedAt: '2026-06-02T12:02:00.000Z',
      vault: vaultRoot,
    })

    assert.equal(
      await hasPendingAssistantAutoReplyInput({
        inputSource,
        state,
        vault: vaultRoot,
      }),
      true,
    )

    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [],
      inputIds: [second.inputId],
      reason: 'already handled',
      recordedAt: '2026-06-02T12:03:00.000Z',
      vault: vaultRoot,
    })

    assert.equal(
      await hasPendingAssistantAutoReplyInput({
        inputSource,
        state,
        vault: vaultRoot,
      }),
      false,
    )
  })
})

function stageHostedInput(input: {
  eventId: string
  laneSeq: string
  occurredAt: string
  text: string
  vault: string
}) {
  return upsertAssistantInputEvent({
    now: new Date(input.occurredAt),
    vault: input.vault,
    event: {
      content: {
        text: input.text,
        transcriptText: input.text,
        userMessageContent: [
          {
            text: input.text,
            type: 'text',
          },
        ],
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread_1',
        threadIsDirect: true,
      },
      occurredAt: input.occurredAt,
      receivedAt: input.occurredAt,
      replyTarget: {
        channel: 'linq',
        messageId: `message_${input.eventId}`,
        threadId: 'thread_1',
      },
      sourceRef: {
        dedupeKey: `dedupe_${input.eventId}`,
        eventId: input.eventId,
        itemId: `item_${input.eventId}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.laneSeq,
        payloadSchema: 'murph.hosted-mailbox-payload.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
    },
  })
}
