import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnId,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
  listRecentAssistantTurnReceipts,
  listRecentAssistantTurnReceiptsForSession,
  readAssistantTurnReceipt,
  resolveAssistantTurnReceiptPath,
  updateAssistantTurnReceipt,
} from '../src/assistant/turns.ts'
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

describe('assistant turns', () => {
  it('creates, updates, and finalizes turn receipts with normalized previews and runtime events', async () => {
    const { paths, vaultRoot } = await createAssistantPaths('assistant-turns-roundtrip-')
    const prompt = `  ${'prompt '.repeat(60)}  `
    const providerModel = `  ${'model-'.repeat(50)}  `
    const response = `  ${'response '.repeat(80)}  `

    const created = await createAssistantTurnReceipt({
      deliveryRequested: true,
      metadata: {
        source: 'test',
      },
      prompt,
      provider: 'openai-compatible',
      providerModel,
      sessionId: 'session-alpha',
      startedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-alpha',
      vault: vaultRoot,
    })

    expect(createAssistantTurnId()).toMatch(/^turn_[a-f0-9]{32}$/u)
    expect(created).toMatchObject({
      completedAt: null,
      deliveryDisposition: 'queued',
      deliveryIntentId: null,
      deliveryRequested: true,
      lastError: null,
      promptPreview: normalizePreview(prompt, 240),
      provider: 'openai-compatible',
      providerModel: normalizePreview(providerModel, 240),
      responsePreview: null,
      schema: 'murph.assistant-turn-receipt.v1',
      sessionId: 'session-alpha',
      startedAt: '2026-04-08T00:00:00.000Z',
      status: 'running',
      turnId: 'turn-alpha',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })
    expect(created.timeline).toEqual([
      {
        at: '2026-04-08T00:00:00.000Z',
        detail: null,
        kind: 'turn.started',
        metadata: {
          source: 'test',
        },
      },
    ])

    const receiptPath = resolveAssistantTurnReceiptPath(paths, created.turnId)
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      status: 'running',
      turnId: 'turn-alpha',
    })

    const appended = await appendAssistantTurnReceiptEvent({
      at: '2026-04-08T00:01:00.000Z',
      kind: 'provider.attempt.succeeded',
      turnId: created.turnId,
      vault: vaultRoot,
    })
    expect(appended?.timeline.at(-1)).toEqual({
      at: '2026-04-08T00:01:00.000Z',
      detail: null,
      kind: 'provider.attempt.succeeded',
      metadata: {},
    })

    const updated = await updateAssistantTurnReceipt({
      mutate(receipt) {
        return {
          ...receipt,
          deliveryIntentId: 'intent-123',
        }
      },
      turnId: created.turnId,
      vault: vaultRoot,
    })
    expect(updated?.deliveryIntentId).toBe('intent-123')

    const finalized = await finalizeAssistantTurnReceipt({
      completedAt: '2026-04-08T00:02:00.000Z',
      deliveryDisposition: 'failed',
      error: {
        code: 'DELIVERY_FAILED',
        message: 'provider send failed',
      },
      response,
      status: 'failed',
      turnId: created.turnId,
      vault: vaultRoot,
    })

    expect(finalized).toMatchObject({
      completedAt: '2026-04-08T00:02:00.000Z',
      deliveryDisposition: 'failed',
      deliveryIntentId: 'intent-123',
      lastError: {
        code: 'DELIVERY_FAILED',
        message: 'provider send failed',
      },
      responsePreview: normalizePreview(response, 320),
      status: 'failed',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })
    expect(finalized?.timeline.at(-1)).toEqual({
      at: '2026-04-08T00:02:00.000Z',
      detail: 'provider send failed',
      kind: 'turn.completed',
      metadata: {},
    })

    await expect(readAssistantTurnReceipt(vaultRoot, created.turnId)).resolves.toEqual(
      finalized,
    )

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents[0]).toMatchObject({
      component: 'turns',
      entityId: created.turnId,
      entityType: 'turn-receipt',
      kind: 'turn.receipt.upserted',
      level: 'warn',
    })
    expect(JSON.parse(runtimeEvents[0]?.dataJson ?? 'null')).toEqual({
      deliveryDisposition: 'failed',
      sessionId: 'session-alpha',
      status: 'failed',
    })
  })

  it('returns null for missing receipt operations and preserves defaults for deferred finalization', async () => {
    const { vaultRoot } = await createAssistantPaths('assistant-turns-missing-')

    await expect(readAssistantTurnReceipt(vaultRoot, 'turn-missing')).resolves.toBeNull()
    await expect(
      appendAssistantTurnReceiptEvent({
        kind: 'provider.attempt.succeeded',
        turnId: 'turn-missing',
        vault: vaultRoot,
      }),
    ).resolves.toBeNull()
    await expect(
      updateAssistantTurnReceipt({
        mutate(receipt) {
          return receipt
        },
        turnId: 'turn-missing',
        vault: vaultRoot,
      }),
    ).resolves.toBeNull()
    await expect(
      finalizeAssistantTurnReceipt({
        status: 'completed',
        turnId: 'turn-missing',
        vault: vaultRoot,
      }),
    ).resolves.toBeNull()

    const created = await createAssistantTurnReceipt({
      deliveryRequested: false,
      prompt: '  hello world  ',
      provider: 'openai-compatible',
      providerModel: null,
      sessionId: 'session-defaults',
      startedAt: '2026-04-08T01:00:00.000Z',
      turnId: 'turn-defaults',
      vault: vaultRoot,
    })

    const finalized = await finalizeAssistantTurnReceipt({
      completedAt: '2026-04-08T01:05:00.000Z',
      error: {
        code: null,
        message: 'should be ignored for deferred turns',
      },
      response: '   ',
      status: 'deferred',
      turnId: created.turnId,
      vault: vaultRoot,
    })

    expect(finalized).toMatchObject({
      completedAt: '2026-04-08T01:05:00.000Z',
      deliveryDisposition: 'not-requested',
      deliveryIntentId: null,
      providerModel: null,
      promptPreview: 'hello world',
      responsePreview: null,
      status: 'deferred',
    })
    expect(finalized?.timeline.at(-1)).toEqual({
      at: '2026-04-08T01:05:00.000Z',
      detail: null,
      kind: 'turn.deferred',
      metadata: {},
    })
  })

  it('lists recent receipts in descending updated order, filters by session, and normalizes limits', async () => {
    const { paths, vaultRoot } = await createAssistantPaths('assistant-turns-list-')
    await ensureAssistantState(paths)

    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'first prompt',
      provider: 'openai-compatible',
      providerModel: 'model-a',
      sessionId: 'session-a',
      startedAt: '2026-04-08T02:00:00.000Z',
      turnId: 'turn-a',
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'second prompt',
      provider: 'openai-compatible',
      providerModel: 'model-b',
      sessionId: 'session-b',
      startedAt: '2026-04-08T02:00:01.000Z',
      turnId: 'turn-b',
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'third prompt',
      provider: 'openai-compatible',
      providerModel: 'model-c',
      sessionId: 'session-a',
      startedAt: '2026-04-08T02:00:02.000Z',
      turnId: 'turn-c',
      vault: vaultRoot,
    })

    await appendAssistantTurnReceiptEvent({
      at: '2026-04-08T02:05:00.000Z',
      kind: 'provider.attempt.succeeded',
      turnId: 'turn-a',
      vault: vaultRoot,
    })
    await appendAssistantTurnReceiptEvent({
      at: '2026-04-08T02:03:00.000Z',
      kind: 'provider.attempt.succeeded',
      turnId: 'turn-b',
      vault: vaultRoot,
    })

    await writeFile(path.join(paths.turnsDirectory, 'notes.txt'), 'ignore me', 'utf8')
    await mkdir(path.join(paths.turnsDirectory, 'nested'), {
      recursive: true,
    })

    const recent = await listRecentAssistantTurnReceipts(vaultRoot, 2)
    expect(recent.map((receipt) => receipt.turnId)).toEqual(['turn-a', 'turn-b'])

    const sessionFiltered = await listRecentAssistantTurnReceiptsForSession(
      vaultRoot,
      '  session-a  ',
      10,
    )
    expect(sessionFiltered.map((receipt) => receipt.turnId)).toEqual(['turn-a', 'turn-c'])

    await expect(listRecentAssistantTurnReceipts(vaultRoot, Number.NaN)).resolves.toEqual([])
    await expect(listRecentAssistantTurnReceipts(vaultRoot, -2)).resolves.toEqual([])

    const oneRecent = await listRecentAssistantTurnReceiptsForSession(
      vaultRoot,
      'session-a',
      1.8,
    )
    expect(oneRecent.map((receipt) => receipt.turnId)).toEqual(['turn-a'])
  })

  it('quarantines corrupted turn receipts and skips them from reads and listings', async () => {
    const { paths, vaultRoot } = await createAssistantPaths('assistant-turns-corrupt-')

    const created = await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'prompt',
      provider: 'openai-compatible',
      providerModel: 'model',
      sessionId: 'session-corrupt',
      startedAt: '2026-04-08T03:00:00.000Z',
      turnId: 'turn-corrupt',
      vault: vaultRoot,
    })
    const receiptPath = resolveAssistantTurnReceiptPath(paths, created.turnId)

    await writeFile(receiptPath, '{bad-json', 'utf8')

    await expect(readAssistantTurnReceipt(vaultRoot, created.turnId)).resolves.toBeNull()
    await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(listRecentAssistantTurnReceipts(vaultRoot, 10)).resolves.toEqual([])

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'turn-receipt',
      limit: 10,
    })
    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'turn-receipt',
      originalPath: receiptPath,
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'state',
          entityType: 'turn-receipt',
          kind: 'turn.receipt.quarantined',
          level: 'warn',
        }),
      ]),
    )
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return {
    paths: resolveAssistantStatePaths(context.vaultRoot),
    vaultRoot: context.vaultRoot,
  }
}

function normalizePreview(value: string, limit: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}
