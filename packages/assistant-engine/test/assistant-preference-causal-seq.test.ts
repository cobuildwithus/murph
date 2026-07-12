import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  advanceAssistantPreferenceCausalSeq,
  initializeAssistantPreferenceCausalSeq,
  resolveAssistantPreferenceCausalSeqPath,
} from '../src/assistant/preference-causal-seq.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'

const createdVaultRoots: string[] = []

afterEach(async () => {
  await Promise.all(createdVaultRoots.splice(0).map((vault) =>
    rm(vault, { force: true, recursive: true })
  ))
})

test('advances the live-turn preference sequence before a steered command can run', async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-preference-causal-'))
  createdVaultRoots.push(vault)
  const initial = await createMailboxInput(vault, '7', 1)
  const steered = await createMailboxInput(vault, '12', 2)

  await initializeAssistantPreferenceCausalSeq({
    acceptedInputItems: [initial],
    vault,
  })
  assert.equal(
    (await readFile(resolveAssistantPreferenceCausalSeqPath(vault), 'utf8')).trim(),
    '7',
  )

  await advanceAssistantPreferenceCausalSeq({
    acceptedInputItems: [steered],
    vault,
  })
  assert.equal(
    (await readFile(resolveAssistantPreferenceCausalSeqPath(vault), 'utf8')).trim(),
    '12',
  )

  await advanceAssistantPreferenceCausalSeq({
    acceptedInputItems: [initial],
    vault,
  })
  assert.equal(
    (await readFile(resolveAssistantPreferenceCausalSeqPath(vault), 'utf8')).trim(),
    '12',
  )
})

async function createMailboxInput(vault: string, causalSeq: string, index: number) {
  const event = await upsertAssistantInputEvent({
    event: {
      occurredAt: `2026-07-12T00:00:0${index}.000Z`,
      sourceRef: {
        causalSeq,
        dedupeKey: `dedupe-${index}`,
        eventId: `event-${index}`,
        itemId: `item-${index}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: String(index),
        payloadSchema: 'murph.hosted-mailbox-item.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
    },
    vault,
  })
  return {
    id: event.inputId,
    source: 'assistant-input' as const,
  }
}
