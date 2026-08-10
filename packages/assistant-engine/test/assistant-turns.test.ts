import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  type AssistantTurnReceiptScanMetrics,
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
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('node:fs/promises')
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
      provider: 'codex-cli',
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
      promptPreview: buildExpectedRedactedPreview(prompt),
      provider: 'codex-cli',
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
      responsePreview: buildExpectedRedactedPreview(response),
      status: 'failed',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })
    expect(finalized?.timeline.at(-1)).toEqual({
      at: '2026-04-08T00:02:00.000Z',
      detail: 'provider send failed',
      kind: 'turn.failed',
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
      provider: 'codex-cli',
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
      promptPreview: buildExpectedRedactedPreview('  hello world  '),
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
      provider: 'codex-cli',
      providerModel: 'model-a',
      sessionId: 'session-a',
      startedAt: '2026-04-08T02:00:00.000Z',
      turnId: 'turn-a',
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'second prompt',
      provider: 'codex-cli',
      providerModel: 'model-b',
      sessionId: 'session-b',
      startedAt: '2026-04-08T02:00:01.000Z',
      turnId: 'turn-b',
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'third prompt',
      provider: 'codex-cli',
      providerModel: 'model-c',
      sessionId: 'session-a',
      startedAt: '2026-04-08T02:00:02.000Z',
      turnId: 'turn-c',
      vault: vaultRoot,
    })

    await appendAssistantTurnReceiptEvent({
      at: '2026-04-08T03:00:00.000Z',
      kind: 'provider.attempt.succeeded',
      turnId: 'turn-a',
      vault: vaultRoot,
    })
    await appendAssistantTurnReceiptEvent({
      at: '2026-04-08T03:30:00+01:00',
      kind: 'provider.attempt.succeeded',
      turnId: 'turn-b',
      vault: vaultRoot,
    })

    await writeFile(path.join(paths.turnsDirectory, 'notes.txt'), 'ignore me', 'utf8')
    await mkdir(path.join(paths.turnsDirectory, 'nested'), {
      recursive: true,
    })
    const expectedBytesRead = (
      await Promise.all(['turn-a', 'turn-b', 'turn-c'].map(async (turnId) =>
        await readFile(resolveAssistantTurnReceiptPath(paths, turnId), 'utf8')
      ))
    ).reduce((total, raw) => total + Buffer.byteLength(raw, 'utf8'), 0)

    const scanMetrics: AssistantTurnReceiptScanMetrics[] = []
    const recent = await listRecentAssistantTurnReceipts(
      vaultRoot,
      2,
      (metrics) => {
        scanMetrics.push(metrics)
      },
    )
    expect(recent.map((receipt) => receipt.turnId)).toEqual(['turn-a', 'turn-b'])
    expect(scanMetrics).toHaveLength(1)
    expect(scanMetrics[0]).toEqual({
      bytesRead: expectedBytesRead,
      filesRead: 3,
      scanElapsedMs: expect.any(Number),
      lockWaitMs: expect.any(Number),
    })
    expect(Number.isSafeInteger(scanMetrics[0]?.scanElapsedMs)).toBe(true)
    expect(scanMetrics[0]?.scanElapsedMs).toBeGreaterThanOrEqual(0)
    expect(Number.isSafeInteger(scanMetrics[0]?.lockWaitMs)).toBe(true)
    expect(scanMetrics[0]?.lockWaitMs).toBeGreaterThanOrEqual(0)

    const sessionFiltered = await listRecentAssistantTurnReceiptsForSession(
      vaultRoot,
      '  session-a  ',
      10,
    )
    expect(sessionFiltered.map((receipt) => receipt.turnId)).toEqual(['turn-a', 'turn-c'])

    const skippedScanMetrics: AssistantTurnReceiptScanMetrics[] = []
    await expect(listRecentAssistantTurnReceipts(
      vaultRoot,
      Number.NaN,
      (metrics) => {
        skippedScanMetrics.push(metrics)
      },
    )).resolves.toEqual([])
    expect(skippedScanMetrics).toEqual([{
      bytesRead: 0,
      filesRead: 0,
      lockWaitMs: 0,
      scanElapsedMs: expect.any(Number),
    }])
    await expect(listRecentAssistantTurnReceipts(vaultRoot, -2)).resolves.toEqual([])

    const oneRecent = await listRecentAssistantTurnReceiptsForSession(
      vaultRoot,
      'session-a',
      1.8,
    )
    expect(oneRecent.map((receipt) => receipt.turnId)).toEqual(['turn-a'])
  })

  it('reads receipt inventory with fixed bounded concurrency while preserving order, filters, and metrics', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-turns-list-concurrency-',
    )
    await ensureAssistantState(paths)

    const turnIds = Array.from(
      { length: 10 },
      (_, index) => `turn-concurrency-${String(index).padStart(2, '0')}`,
    )
    for (const [index, turnId] of turnIds.entries()) {
      await createAssistantTurnReceipt({
        deliveryRequested: false,
        prompt: `concurrency prompt ${index}`,
        provider: 'codex-cli',
        providerModel: null,
        sessionId: index % 2 === 0 ? 'session-even' : 'session-odd',
        startedAt: `2026-04-08T04:00:${String(index).padStart(2, '0')}.000Z`,
        turnId,
        vault: vaultRoot,
      })
    }

    const receiptPaths = new Set(
      turnIds.map((turnId) =>
        path.resolve(resolveAssistantTurnReceiptPath(paths, turnId)),
      ),
    )
    const expectedBytesRead = (
      await Promise.all([...receiptPaths].map(async (receiptPath) =>
        await readFile(receiptPath, 'utf8')
      ))
    ).reduce((total, raw) => total + Buffer.byteLength(raw, 'utf8'), 0)
    let activeReads = 0
    let maxActiveReads = 0
    const delayedReadFile = async (
      filePath: string,
      encoding: 'utf8',
    ): Promise<string> => {
      if (!receiptPaths.has(path.resolve(filePath))) {
        return await readFile(filePath, encoding)
      }

      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await readFile(filePath, encoding)
      } finally {
        activeReads -= 1
      }
    }
    const turns = await loadTurnsModule({ readFile: delayedReadFile })
    const scanMetrics: AssistantTurnReceiptScanMetrics[] = []

    const recent = await turns.listRecentAssistantTurnReceipts(
      vaultRoot,
      4,
      (metrics) => {
        scanMetrics.push(metrics)
      },
    )

    expect(maxActiveReads).toBe(4)
    expect(recent.map((receipt) => receipt.turnId)).toEqual([
      'turn-concurrency-09',
      'turn-concurrency-08',
      'turn-concurrency-07',
      'turn-concurrency-06',
    ])
    expect(scanMetrics).toEqual([{
      bytesRead: expectedBytesRead,
      filesRead: 10,
      lockWaitMs: expect.any(Number),
      scanElapsedMs: expect.any(Number),
    }])

    const sessionFiltered = await turns.listRecentAssistantTurnReceiptsForSession(
      vaultRoot,
      ' session-even ',
      3,
    )
    expect(sessionFiltered.map((receipt) => receipt.turnId)).toEqual([
      'turn-concurrency-08',
      'turn-concurrency-06',
      'turn-concurrency-04',
    ])
  })

  it('serializes quarantine writes while skipping corrupt, unreadable, and missing inventory entries', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-turns-list-invalid-batch-',
    )
    await ensureAssistantState(paths)
    const records = [
      { turnId: 'turn-valid-batch', startedAt: '2026-04-08T05:00:00.000Z' },
      { turnId: 'turn-corrupt-batch-a', startedAt: '2026-04-08T05:00:01.000Z' },
      { turnId: 'turn-corrupt-batch-b', startedAt: '2026-04-08T05:00:02.000Z' },
      { turnId: 'turn-missing-batch', startedAt: '2026-04-08T05:00:03.000Z' },
      { turnId: 'turn-unreadable-batch', startedAt: '2026-04-08T05:00:04.000Z' },
    ]
    for (const record of records) {
      await createAssistantTurnReceipt({
        deliveryRequested: false,
        prompt: 'inventory validation prompt',
        provider: 'codex-cli',
        providerModel: null,
        sessionId: 'session-invalid-batch',
        startedAt: record.startedAt,
        turnId: record.turnId,
        vault: vaultRoot,
      })
    }

    const validPath = resolveAssistantTurnReceiptPath(paths, 'turn-valid-batch')
    const corruptPathA = resolveAssistantTurnReceiptPath(
      paths,
      'turn-corrupt-batch-a',
    )
    const corruptPathB = resolveAssistantTurnReceiptPath(
      paths,
      'turn-corrupt-batch-b',
    )
    const missingPath = resolveAssistantTurnReceiptPath(
      paths,
      'turn-missing-batch',
    )
    const unreadablePath = resolveAssistantTurnReceiptPath(
      paths,
      'turn-unreadable-batch',
    )
    const corruptRawA = '{bad-json-a'
    const corruptRawB = '{bad-json-b'
    await writeFile(corruptPathA, corruptRawA, 'utf8')
    await writeFile(corruptPathB, corruptRawB, 'utf8')
    const validRaw = await readFile(validPath, 'utf8')
    const quarantinedPaths = new Set([
      path.resolve(corruptPathA),
      path.resolve(corruptPathB),
      path.resolve(unreadablePath),
    ])
    let activeQuarantineRenames = 0
    let maxActiveQuarantineRenames = 0
    const mockedReadFile = async (
      filePath: string,
      encoding: 'utf8',
    ): Promise<string> => {
      const resolvedPath = path.resolve(filePath)
      if (resolvedPath === path.resolve(missingPath)) {
        throw Object.assign(new Error('receipt disappeared'), {
          code: 'ENOENT',
        })
      }
      if (resolvedPath === path.resolve(unreadablePath)) {
        throw Object.assign(new Error('receipt read failed'), {
          code: 'EACCES',
        })
      }
      return await readFile(filePath, encoding)
    }
    const delayedRename = async (
      oldPath: string,
      newPath: string,
    ): Promise<void> => {
      const tracksQuarantine = quarantinedPaths.has(path.resolve(oldPath))
      if (tracksQuarantine) {
        activeQuarantineRenames += 1
        maxActiveQuarantineRenames = Math.max(
          maxActiveQuarantineRenames,
          activeQuarantineRenames,
        )
      }
      try {
        if (tracksQuarantine) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        await renameFile(oldPath, newPath)
      } finally {
        if (tracksQuarantine) {
          activeQuarantineRenames -= 1
        }
      }
    }
    const turns = await loadTurnsModule({
      readFile: mockedReadFile,
      rename: delayedRename,
    })
    const scanMetrics: AssistantTurnReceiptScanMetrics[] = []

    const recent = await turns.listRecentAssistantTurnReceipts(
      vaultRoot,
      10,
      (metrics) => {
        scanMetrics.push(metrics)
      },
    )

    expect(recent.map((receipt) => receipt.turnId)).toEqual(['turn-valid-batch'])
    expect(maxActiveQuarantineRenames).toBe(1)
    expect(scanMetrics).toEqual([{
      bytesRead:
        Buffer.byteLength(validRaw, 'utf8') +
        Buffer.byteLength(corruptRawA, 'utf8') +
        Buffer.byteLength(corruptRawB, 'utf8'),
      filesRead: 3,
      lockWaitMs: expect.any(Number),
      scanElapsedMs: expect.any(Number),
    }])

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'turn-receipt',
      limit: 10,
    })
    expect(quarantines).toHaveLength(3)
    expect(quarantines.map((entry) => entry.originalPath)).toEqual(
      expect.arrayContaining([corruptPathA, corruptPathB, unreadablePath]),
    )
    expect(quarantines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        errorCode: 'EACCES',
        originalPath: unreadablePath,
      }),
    ]))
    expect(quarantines.map((entry) => entry.originalPath)).not.toContain(missingPath)

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(
      runtimeEvents.filter((event) => event.kind === 'turn.receipt.quarantined'),
    ).toHaveLength(3)
  })

  it('quarantines corrupted turn receipts and skips them from reads and listings', async () => {
    const { paths, vaultRoot } = await createAssistantPaths('assistant-turns-corrupt-')

    const created = await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'prompt',
      provider: 'codex-cli',
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

async function loadTurnsModule(options: {
  readFile?: (filePath: string, encoding: 'utf8') => Promise<string>
  rename?: (oldPath: string, newPath: string) => Promise<void>
} = {}) {
  vi.resetModules()
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    )
    return {
      ...actual,
      ...(options.readFile ? { readFile: options.readFile } : {}),
      ...(options.rename ? { rename: options.rename } : {}),
    }
  })
  return await import('../src/assistant/turns.ts')
}

async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const { rename } = await vi.importActual<typeof import('node:fs/promises')>(
    'node:fs/promises',
  )
  await rename(oldPath, newPath)
}

function buildExpectedRedactedPreview(value: string): string {
  const trimmed = value.trim()
  const digest = createHash('sha256').update(trimmed).digest('hex').slice(0, 12)
  return `[redacted ${trimmed.length} chars sha256:${digest}]`
}
