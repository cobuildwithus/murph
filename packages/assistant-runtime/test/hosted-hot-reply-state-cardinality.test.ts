import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import * as assistantEngine from '@murphai/assistant-engine'
import {
  saveAssistantAutomationState,
} from '@murphai/assistant-engine/assistant-state'
import {
  assertStateCardinalityInvariant,
  describeStateCardinality,
  type StateCardinalityProbe,
} from '../../../config/state-cardinality-test.ts'
import {
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
} from '../src/hosted-runtime/pending-input-index.ts'

const cleanupPaths: string[] = []

const hostedInputProbe = {
  name: 'foreground input discovery ignores unrelated durable state',
  prepare: prepareForegroundInput,
} satisfies StateCardinalityProbe

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describeStateCardinality('hosted foreground state-cardinality invariant', () => {
  it(hostedInputProbe.name, async () => {
    await assertStateCardinalityInvariant(hostedInputProbe)
  }, 180_000)
})

async function prepareForegroundInput(unrelatedStateCount: number) {
  const vaultRoot = await createTempVault(
    `murph-hosted-cardinality-${unrelatedStateCount}-`,
  )
  await enableLinqAutoReply(vaultRoot)

  for (let index = 0; index < unrelatedStateCount; index += 1) {
    const staged = await assistantEngine.upsertAssistantInputEvent({
      event: createAssistantInputEvent({
        causalSeq: String(index + 1),
        dedupeKey: `dedupe_pending_${index}`,
        eventId: `event_pending_${index}`,
        itemId: `item_pending_${index}`,
        laneSeq: String(index + 1),
        messageId: `message_pending_${index}`,
        occurredAt: new Date(
          Date.parse('2026-08-14T00:00:00.000Z') + index * 2_000,
        ).toISOString(),
        receivedAt: new Date(
          Date.parse('2026-08-14T00:00:01.000Z') + index * 2_000,
        ).toISOString(),
        threadId: `thread-pending-${index}`,
      }),
      vault: vaultRoot,
    })
    await enqueueHostedPendingAssistantInputId({
      inputId: staged.inputId,
      vaultRoot,
    })
  }

  const fresh = await assistantEngine.upsertAssistantInputEvent({
    event: createAssistantInputEvent({
      causalSeq: '1000',
      dedupeKey: 'dedupe_fresh',
      eventId: 'event_fresh',
      itemId: 'item_fresh',
      laneSeq: '1000',
      messageId: 'message_fresh',
      occurredAt: '2026-08-15T12:00:00.000Z',
      receivedAt: '2026-08-15T12:00:01.000Z',
      text: 'Current member reply.',
      threadId: 'thread-current',
    }),
    vault: vaultRoot,
  })

  return {
    root: vaultRoot,
    async loadOperation() {
      const { selectHostedAssistantInputIds } =
        await import('../src/hosted-runtime/turn-input.ts')

      return async () => {
        const selection = await selectHostedAssistantInputIds({
          freshAssistantInputIds: [fresh.inputId],
          mode: 'foreground',
          vaultRoot,
        })

        expect(selection.inputIds).toEqual([fresh.inputId])
        expect(selection.pendingInputIds).toEqual([])
      }
    },
  }
}

async function createTempVault(prefix: string): Promise<string> {
  const parentRoot = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.push(parentRoot)
  return path.join(parentRoot, 'vault')
}

async function enableLinqAutoReply(vaultRoot: string): Promise<void> {
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: 'linq',
      eligibleAfter: null,
      enabledAt: '2026-08-14T00:00:00.000Z',
    }],
    updatedAt: '2026-08-14T00:00:00.000Z',
    version: 1,
  })
  await ensureHostedPendingAssistantInputIndex({ vaultRoot })
}

function createAssistantInputEvent(input: {
  causalSeq: string
  dedupeKey: string
  eventId: string
  itemId: string
  laneSeq: string
  messageId: string
  occurredAt: string
  receivedAt: string
  text?: string
  threadId: string
}) {
  const text = input.text ?? 'Unrelated pending message.'
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [{
        text,
        type: 'text' as const,
      }],
    },
    conversation: {
      accountId: 'account-test',
      actorId: 'actor-test',
      actorIsSelf: false,
      source: 'linq',
      threadId: input.threadId,
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget: {
      channel: 'linq',
      messageId: input.messageId,
      threadId: input.threadId,
    },
    sourceMetadata: {
      externalThreadRouteAuthorityPresent: true,
      kind: 'linq' as const,
      partCount: 1,
      reactionEligible: false,
      replyToMessageId: null,
      service: 'iMessage',
    },
    sourceRef: {
      causalSeq: input.causalSeq,
      dedupeKey: input.dedupeKey,
      eventId: input.eventId,
      itemId: input.itemId,
      kind: 'hosted-mailbox' as const,
      lane: 'conversation' as const,
      laneSeq: input.laneSeq,
      payloadSchema: 'murph.hosted-mailbox-payload.v1',
      payloadSource: 'inline' as const,
      source: 'hosted-mailbox' as const,
      wakeSchema: 'murph.hosted-execution-wake.v1',
    },
  }
}
