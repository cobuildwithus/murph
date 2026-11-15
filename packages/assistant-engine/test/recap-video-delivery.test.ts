import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assistantOutboxIntentSchema, assistantOutboxRecapVideoSchema } from '@murphai/operator-config/assistant-cli-contracts'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'
import { createAssistantOutboxIntent, dispatchAssistantOutboxIntent, readAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { sendLinqMessage } from '../src/assistant/channels/runtime.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

const identity = { generationId: 'a'.repeat(32), hash: 'b'.repeat(64), byteLength: 3_100_000 }
const handed = identity
const line = 'Leo took the week, seven to six.\nWatch the recap: https://www.withmurph.ai/recap/synthetic'

async function vault() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recap-video-delivery-'))
  roots.push(root)
  return root
}
const create = (root: string, extra: Partial<Parameters<typeof createAssistantOutboxIntent>[0]> = {}) => createAssistantOutboxIntent({
  vault: root, sessionId: 'asess_' + 'c'.repeat(32), turnId: 'turn-recap', channel: 'linq', explicitTarget: 'linq-group-chat',
  message: line, deliveryIdempotencyKey: 'game-recap:synthetic-game', dedupeToken: 'game-recap:synthetic-game', recapVideo: handed, ...extra,
})

describe('the recap video an outbox intent carries', () => {
  it('is bounded: the identity and one decision, never a file path the model could edit', () => {
    for (const valid of [identity, { ...identity, form: 'line' }, { ...identity, form: 'attachment', attachmentId: 'att-1' }]) {
      expect(assistantOutboxRecapVideoSchema.safeParse(valid).success).toBe(true)
    }
    for (const invalid of [{ ...identity, form: 'attachment' }, { ...identity, attachmentId: 'att-1' }, { ...identity, prepared: { attachmentId: 'x' } },
      { ...identity, file: '/synthetic/vault/bank/automations/a.md' }, { ...identity, form: 'video' }]) {
      expect(assistantOutboxRecapVideoSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('rides a text-only Linq message, and a replayed create never adds, replaces or repeats it', async () => {
    const root = await vault()
    const first = await create(root)
    expect(first.recapVideo).toEqual(handed)
    // A retried turn or replayed wake queues the same message: the stored intent and its decision stand.
    const replayed = await create(root, { recapVideo: { ...identity, hash: 'd'.repeat(64) } })
    expect(replayed.intentId).toBe(first.intentId)
    expect(replayed.recapVideo).toEqual(handed)
    const withoutVideo = await create(root, { recapVideo: null })
    expect(withoutVideo.intentId).toBe(first.intentId)
    expect(withoutVideo.recapVideo).toEqual(handed)
  })

  it('is left off any message that is not a text-only Linq message', async () => {
    const extras: Partial<Parameters<typeof createAssistantOutboxIntent>[0]>[] = [{ channel: 'telegram', explicitTarget: '12345' }, { media: [{ kind: 'image', url: 'https://example.com/a.jpg', alt: null, source: null }] }]
    for (const extra of extras) {
      const intent = await create(await vault(), extra)
      expect(intent).not.toHaveProperty('recapVideo')
    }
  })

  it('is handed to the Linq sender, which saves one decision before its request, and the message is then sent', async () => {
    const root = await vault()
    const intent = await create(root)
    const sendLinq = vi.fn(async (request: Parameters<NonNullable<NonNullable<Parameters<typeof dispatchAssistantOutboxIntent>[0]['dependencies']>['sendLinq']>>[0]) => {
      expect(request.recapVideo?.video).toEqual(handed)
      // The decision is on disk before any message request.
      await request.recapVideo!.persist({ ...identity, form: 'attachment', attachmentId: 'synthetic-attachment' })
      expect((await readAssistantOutboxIntent(root, intent.intentId))?.recapVideo).toEqual({ ...identity, form: 'attachment', attachmentId: 'synthetic-attachment' })
      return { providerMessageId: 'linq-message-1', providerMessageIds: ['linq-message-1', 'linq-message-2'], target: 'linq-group-chat' }
    })
    const sent = await dispatchAssistantOutboxIntent({ force: true, intentId: intent.intentId, vault: root, dependencies: { sendLinq } })
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(sendLinq.mock.calls[0]![0].message).toBe(line)
    expect(sent.intent.status).toBe('sent')
    // The ownership-checked rewrite to "sent" kept the decision; the file's path is gone with the file.
    expect(sent.intent.recapVideo).toEqual({ ...identity, form: 'attachment', attachmentId: 'synthetic-attachment' })
    expect(JSON.parse(await readFile(path.join(root, '.runtime/operations/assistant/outbox', `${intent.intentId}.json`), 'utf8')).recapVideo)
      .toEqual({ ...identity, form: 'attachment', attachmentId: 'synthetic-attachment' })
  })

  it('only ever moves a saved decision toward the line alone, for the same video', async () => {
    const root = await vault()
    const intent = await create(root)
    const attempts: Array<() => Promise<void>> = []
    const sendLinq = vi.fn(async (request: { recapVideo?: { persist(next: unknown): Promise<void> } }) => {
      const persist = (next: unknown) => request.recapVideo!.persist(next as never)
      await persist({ ...identity, form: 'attachment', attachmentId: 'first' })
      for (const conflict of [{ ...identity, form: 'attachment', attachmentId: 'second' }, { ...identity, hash: 'e'.repeat(64), form: 'line' }, { ...identity }]) {
        attempts.push(() => persist(conflict))
        await expect(persist(conflict)).rejects.toThrow(/does not follow/u)
      }
      await persist({ ...identity, form: 'line' })
      await expect(persist({ ...identity, form: 'attachment', attachmentId: 'first' })).rejects.toThrow(/does not follow/u)
      return { providerMessageId: 'linq-message-1', target: 'linq-group-chat' }
    })
    const sent = await dispatchAssistantOutboxIntent({ force: true, intentId: intent.intentId, vault: root, dependencies: { sendLinq: sendLinq as never } })
    expect(sent.intent.status).toBe('sent')
    expect(sent.intent.recapVideo).toEqual({ ...identity, form: 'line' })
    expect(attempts).toHaveLength(3)
  })

  it('reads an intent stored with an unknown shape as text alone, never quarantined', () => {
    const parsed = assistantOutboxIntentSchema.safeParse({ ...assistantOutboxIntentSchema.parse(JSON.parse(JSON.stringify(baseIntent()))), recapVideo: { ...identity, prepared: {} } })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.recapVideo).toBeUndefined()
  })
})

function baseIntent() {
  return {
    schema: 'murph.assistant-outbox-intent.v1', intentId: 'outbox_synthetic', sessionId: 'asess_' + 'c'.repeat(32), turnId: 'turn-recap',
    createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z', lastAttemptAt: null, nextAttemptAt: '2026-11-15T00:00:00.000Z',
    sentAt: null, attemptCount: 0, status: 'pending', message: line, dedupeKey: 'd'.repeat(64), targetFingerprint: 'e'.repeat(64),
    channel: 'linq', identityId: null, actorId: null, threadId: null, threadIsDirect: false, replyToMessageId: null, bindingDelivery: null,
    explicitTarget: 'linq-group-chat', delivery: null, deliveryConfirmationPending: false, deliveryIdempotencyKey: 'game-recap:synthetic-game',
    deliveryTransportIdempotent: true, lastError: null,
  }
}

describe('a Linq send with a prepared attachment', () => {
  it('keeps the line, puts the video after it in the first send, and sends the link alone', async () => {
    const requests: Array<{ body: { message?: { parts?: unknown[] } }; url: string }> = []
    const fetchImplementation: LinqFetch = vi.fn(async (url, init) => {
      requests.push({ body: JSON.parse(String(init.body)) as never, url })
      return new Response(JSON.stringify({ message: { id: `linq-message-${requests.length}` } }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
    })
    await sendLinqMessage({ idempotencyKey: 'game-recap:synthetic-game', message: line, preparedAttachmentIds: ['synthetic-attachment'],
      target: 'linq-group-chat', targetKind: 'thread', threadIsDirect: false }, { env: { LINQ_API_TOKEN: 'linq-token' }, fetchImplementation })
    expect(requests).toHaveLength(2)
    expect(requests[0]!.body.message?.parts).toEqual([{ type: 'text', value: 'Leo took the week, seven to six.\nWatch the recap:' }, { type: 'media', attachment_id: 'synthetic-attachment' }])
    expect(requests[1]!.body.message?.parts).toEqual([{ type: 'link', value: 'https://www.withmurph.ai/recap/synthetic' }])
  })
})
