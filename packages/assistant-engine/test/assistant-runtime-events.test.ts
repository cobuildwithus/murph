import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listAssistantQuarantineEntriesAtPaths,
  quarantineAssistantStateFile,
  summarizeAssistantQuarantines,
} from '../src/assistant/quarantine.ts'
import { compactAssistantEventLogsAtPaths } from '../src/assistant/event-log-retention.ts'
import {
  appendAssistantRuntimeEventAtPaths,
  listAssistantRuntimeEventsAtPath,
} from '../src/assistant/runtime-events.ts'
import { runAssistantRuntimeMaintenance } from '../src/assistant/runtime-budgets.ts'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant runtime events', () => {
  it('appends redacted runtime events and lists them newest-first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:11:12.000Z'))

    const paths = await createAssistantPaths('assistant-runtime-events-append-')

    const first = await appendAssistantRuntimeEventAtPaths(paths, {
      code: 'ASSISTANT_PROVIDER_SESSION_UPSERTED',
      component: 'provider',
      data: {
        Authorization: 'Bearer secret-token-123456',
        nested: {
          apiKey: 'super-secret',
          note: 'safe text',
        },
      },
      entityId: 'session-1',
      entityType: 'session',
      kind: 'session.upserted',
      message: 'Authorization=secret-token-123456 Cookie=session-cookie',
    })
    const second = await appendAssistantRuntimeEventAtPaths(paths, {
      at: '2026-04-08T10:12:00.000Z',
      component: 'runtime',
      kind: 'runtime.maintenance',
      message: 'token=secondary-secret',
    })

    expect(first).toMatchObject({
      at: '2026-04-08T10:11:12.000Z',
      code: 'ASSISTANT_PROVIDER_SESSION_UPSERTED',
      component: 'provider',
      entityId: 'session-1',
      entityType: 'session',
      kind: 'session.upserted',
      level: 'info',
      schema: 'murph.assistant-runtime-event.v1',
    })
    expect(first.message).toContain('[REDACTED]')
    expect(first.message).not.toContain('secret-token-123456')
    expect(first.dataJson).not.toContain('secret-token-123456')
    expect(first.dataJson).toContain('[REDACTED]')
    expect(JSON.parse(first.dataJson ?? 'null')).toEqual({
      Authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        note: 'safe text',
      },
    })

    const listed = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath, 10)

    expect(listed).toEqual([second, first])
  })

  it('returns an empty list for missing files, salvages malformed tails, and normalizes limits', async () => {
    const paths = await createAssistantPaths('assistant-runtime-events-list-')

    await expect(listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)).resolves.toEqual(
      [],
    )

    const salvagePath = path.join(paths.journalsDirectory, 'runtime-events-salvage.jsonl')
    await mkdir(path.dirname(salvagePath), {
      recursive: true,
    })
    await writeFile(
      salvagePath,
      [
        JSON.stringify(makeRuntimeEvent(1)),
        '{not-json',
        JSON.stringify(makeRuntimeEvent(2)),
        '{"schema":"murph.assistant-runtime-event.v1"',
      ].join('\n'),
      'utf8',
    )

    await expect(listAssistantRuntimeEventsAtPath(salvagePath, 10)).resolves.toMatchObject([
      { message: 'event-2' },
      { message: 'event-1' },
    ])

    const manyEventsPath = path.join(paths.journalsDirectory, 'runtime-events-many.jsonl')
    await writeFile(
      manyEventsPath,
      Array.from({ length: 260 }, (_value, index) =>
        JSON.stringify(makeRuntimeEvent(index)),
      ).join('\n') + '\n',
      'utf8',
    )

    const defaultLimited = await listAssistantRuntimeEventsAtPath(
      manyEventsPath,
      Number.NaN,
    )
    expect(defaultLimited).toHaveLength(50)
    expect(defaultLimited[0]).toMatchObject({
      message: 'event-259',
    })
    expect(defaultLimited.at(-1)).toMatchObject({
      message: 'event-210',
    })
    await expect(listAssistantRuntimeEventsAtPath(manyEventsPath, 0)).resolves.toMatchObject([
      { message: 'event-259' },
    ])
    await expect(listAssistantRuntimeEventsAtPath(manyEventsPath, 2.9)).resolves.toMatchObject([
      { message: 'event-259' },
      { message: 'event-258' },
    ])

    const maxed = await listAssistantRuntimeEventsAtPath(manyEventsPath, 999)
    expect(maxed).toHaveLength(250)
    expect(maxed[0]).toMatchObject({
      message: 'event-259',
    })
    expect(maxed.at(-1)).toMatchObject({
      message: 'event-10',
    })
  })

  it('rethrows non-missing runtime-event read failures', async () => {
    const paths = await createAssistantPaths('assistant-runtime-events-read-error-')

    await mkdir(paths.runtimeEventsPath, {
      recursive: true,
    })

    await expect(listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)).rejects.toMatchObject(
      {
        code: 'EISDIR',
      },
    )
  })

  it('bounds runtime events by age, count, and bytes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T00:00:00.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-runtime-events-retention-',
    )
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)

    await mkdir(paths.journalsDirectory, {
      recursive: true,
    })
    await writeFile(
      paths.runtimeEventsPath,
      Array.from({ length: 2005 }, (_value, index) => {
        const minute = String(Math.floor(index / 60)).padStart(2, '0')
        const second = String(index % 60).padStart(2, '0')
        return JSON.stringify({
          ...makeRuntimeEvent(index),
          at: `2026-04-14T00:${minute}:${second}.000Z`,
          message: `count-event-${index}`,
        })
      }).join('\n') + '\n',
      'utf8',
    )
    await writeFile(
      paths.runtimeEventsPath,
      `${await readFile(paths.runtimeEventsPath, 'utf8')}${JSON.stringify({
        ...makeRuntimeEvent(2005),
        at: '2026-04-07T23:59:59.000Z',
        message: 'too-old',
      })}\n`,
      'utf8',
    )

    await runAssistantRuntimeMaintenance({
      now: new Date('2026-04-15T01:01:00.000Z'),
      vault: vaultRoot,
    })

    let retained = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath, 2500)
    expect(retained).toHaveLength(250)
    expect(retained[0]).toMatchObject({ kind: 'runtime.maintenance' })
    const retainedRawAfterCount = await readFile(paths.runtimeEventsPath, 'utf8')
    expect(retainedRawAfterCount.trim().split('\n')).toHaveLength(2000)
    expect(retainedRawAfterCount).not.toContain('"message":"count-event-5"')
    expect(retainedRawAfterCount).toContain('"message":"count-event-6"')
    expect(retainedRawAfterCount).not.toContain('too-old')

    await writeFile(
      paths.runtimeEventsPath,
      `${retainedRawAfterCount}${Array.from({ length: 60 }, (_value, index) =>
        JSON.stringify({
          ...makeRuntimeEvent(3000 + index),
          at: `2026-04-15T01:02:${String(index).padStart(2, '0')}.000Z`,
          dataJson: JSON.stringify({
            payload: 'x'.repeat(24_000),
          }),
          message: `large-event-${index}`,
        }),
      ).join('\n')}\n${JSON.stringify({
        ...makeRuntimeEvent(4000),
        at: '2026-04-15T01:02:59.500Z',
        dataJson: JSON.stringify({
          payload: 'x'.repeat(2 * 1024 * 1024),
        }),
        message: 'oversized-event',
      })}\n`,
      'utf8',
    )
    await runAssistantRuntimeMaintenance({
      now: new Date('2026-04-15T01:03:00.000Z'),
      vault: vaultRoot,
    })

    const retainedRawAfterBytes = await readFile(paths.runtimeEventsPath, 'utf8')
    expect(Buffer.byteLength(retainedRawAfterBytes, 'utf8')).toBeLessThanOrEqual(
      1024 * 1024,
    )
    expect(retainedRawAfterBytes).toContain('large-event-59')
    expect(retainedRawAfterBytes).not.toContain('large-event-0')
    expect(retainedRawAfterBytes).not.toContain('oversized-event')
    retained = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath, 5)
    expect(retained[0]).toMatchObject({ kind: 'runtime.maintenance' })
  })

  it('compacts oversized pre-existing runtime logs from a bounded tail', async () => {
    const paths = await createAssistantPaths('assistant-runtime-events-large-tail-')

    await mkdir(paths.journalsDirectory, {
      recursive: true,
    })
    await writeFile(
      paths.runtimeEventsPath,
      `${'x'.repeat(9 * 1024 * 1024)}\n${Array.from({ length: 5 }, (_value, index) =>
        JSON.stringify({
          ...makeRuntimeEvent(index),
          at: `2026-04-15T01:00:0${index}.000Z`,
          message: `tail-event-${index}`,
        }),
      ).join('\n')}\n`,
      'utf8',
    )

    const result = await compactAssistantEventLogsAtPaths({
      now: new Date('2026-04-15T01:01:00.000Z'),
      paths,
    })

    const runtimeResult = result.runtimeEvents
    expect(runtimeResult).toMatchObject({
      readWasTruncated: true,
      retainedEventCount: 5,
    })
    if (!runtimeResult) {
      throw new Error('Expected runtime event retention result.')
    }
    expect(runtimeResult.readBytes).toBeLessThan(runtimeResult.originalBytes)
    const retainedRaw = await readFile(paths.runtimeEventsPath, 'utf8')
    expect(Buffer.byteLength(retainedRaw, 'utf8')).toBeLessThanOrEqual(
      1024 * 1024,
    )
    expect(retainedRaw).toContain('tail-event-4')
    expect(retainedRaw).not.toContain('xxxxxxxx')
  })

  it('records a maintenance note when event log compaction fails', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-runtime-events-retention-failure-',
    )
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)

    await mkdir(paths.runtimeEventsPath, {
      recursive: true,
    })

    const snapshot = await runAssistantRuntimeMaintenance({
      now: new Date('2026-04-15T01:01:00.000Z'),
      vault: vaultRoot,
    })

    expect(snapshot.maintenance.notes).toContain(
      'Assistant event log compaction failed and will be retried by a later maintenance pass.',
    )
    await expect(readFile(paths.resourceBudgetPath, 'utf8')).resolves.toContain(
      'Assistant event log compaction failed and will be retried by a later maintenance pass.',
    )
  })
})

describe('assistant quarantine', () => {
  it('moves corrupted files into quarantine, writes metadata, and records a redacted runtime event', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:34:56.789Z'))

    const paths = await createAssistantPaths('assistant-quarantine-create-')
    const originalPath = path.join(paths.journalsDirectory, 'session.json')

    await mkdir(path.dirname(originalPath), {
      recursive: true,
    })
    await writeFile(originalPath, 'Authorization=secret-token-123456', 'utf8')

    const entry = await quarantineAssistantStateFile({
      artifactKind: 'session',
      error: new Error('Authorization=secret-token-123456'),
      filePath: originalPath,
      paths,
    })

    expect(entry).not.toBeNull()
    expect(entry).toMatchObject({
      artifactKind: 'session',
      errorCode: null,
      metadataPath: `${entry?.quarantinedPath}.meta.json`,
      originalPath,
      quarantinedAt: '2026-04-08T12:34:56.789Z',
      schema: 'murph.assistant-quarantine-entry.v1',
    })
    expect(entry?.quarantineId).toMatch(/^q_[a-f0-9]{32}$/u)
    expect(entry?.message).toContain('[REDACTED]')
    expect(entry?.message).not.toContain('secret-token-123456')
    expect(entry?.quarantinedPath.startsWith(path.join(paths.quarantineDirectory, 'session'))).toBe(
      true,
    )
    expect(entry?.quarantinedPath.endsWith('.invalid.json')).toBe(true)

    await expect(readFile(originalPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(entry!.quarantinedPath, 'utf8')).resolves.toBe(
      'Authorization=secret-token-123456',
    )
    await expect(readFile(entry!.metadataPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(entry, null, 2)}\n`,
    )

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toHaveLength(1)
    expect(runtimeEvents[0]).toMatchObject({
      component: 'state',
      entityId: 'session.json',
      entityType: 'session',
      kind: 'session.quarantined',
      level: 'warn',
    })
    expect(runtimeEvents[0]?.message).toContain('[REDACTED]')
    expect(runtimeEvents[0]?.message).not.toContain('secret-token-123456')
    expect(runtimeEvents[0]?.code).toBe('session.quarantined')
    expect(JSON.parse(runtimeEvents[0]?.dataJson ?? 'null')).toEqual({
      metadataPath: entry?.metadataPath,
      originalPath,
      quarantinedPath: entry?.quarantinedPath,
    })
  })

  it('returns null for missing source files and keeps fresh summaries empty', async () => {
    const paths = await createAssistantPaths('assistant-quarantine-missing-')
    const missingPath = path.join(paths.journalsDirectory, 'missing.json')

    await expect(
      quarantineAssistantStateFile({
        artifactKind: 'status',
        error: Object.assign(new Error('not found'), {
          code: 'ENOENT',
        }),
        filePath: missingPath,
        paths,
      }),
    ).resolves.toBeNull()

    await expect(listAssistantQuarantineEntriesAtPaths(paths)).resolves.toEqual([])
    await expect(summarizeAssistantQuarantines({ paths })).resolves.toEqual({
      byKind: {},
      recent: [],
      total: 0,
    })
  })

  it('lists quarantine entries across roots, ignores malformed metadata, normalizes limits, and summarizes totals', async () => {
    const paths = await createAssistantPaths('assistant-quarantine-summary-')

    for (let index = 0; index < 13; index += 1) {
      const artifactKind =
        index % 4 === 0
          ? 'outbox-intent'
          : index % 3 === 0
            ? 'status'
            : 'session'
      const baseDirectory =
        artifactKind === 'outbox-intent'
          ? path.join(paths.outboxQuarantineDirectory, `day-${index}`)
          : path.join(paths.quarantineDirectory, artifactKind)

      await writeQuarantineMetadata(paths, {
        artifactKind,
        directory: baseDirectory,
        index,
      })
    }

    const malformedMetadataPath = path.join(
      paths.quarantineDirectory,
      'session',
      'broken.meta.json',
    )
    await mkdir(path.dirname(malformedMetadataPath), {
      recursive: true,
    })
    await writeFile(malformedMetadataPath, '{', 'utf8')

    const recent = await listAssistantQuarantineEntriesAtPaths(paths)
    expect(recent).toHaveLength(12)
    expect(recent[0]).toMatchObject({
      artifactKind: 'outbox-intent',
      quarantineId: 'q_test_12',
    })
    expect(recent.at(-1)).toMatchObject({
      quarantineId: 'q_test_1',
    })

    await expect(
      listAssistantQuarantineEntriesAtPaths(paths, {
        limit: 0,
      }),
    ).resolves.toMatchObject([
      {
        quarantineId: 'q_test_12',
      },
    ])

    const filtered = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'outbox-intent',
      limit: 999,
    })
    expect(filtered.map((entry) => entry.quarantineId)).toEqual([
      'q_test_12',
      'q_test_8',
      'q_test_4',
      'q_test_0',
    ])

    await expect(summarizeAssistantQuarantines({ paths })).resolves.toEqual({
      byKind: {
        'outbox-intent': 4,
        session: 6,
        status: 3,
      },
      recent,
      total: 13,
    })
  })

  it('still returns quarantine metadata when runtime-event recording fails', async () => {
    const paths = await createAssistantPaths('assistant-quarantine-best-effort-')
    const originalPath = path.join(paths.outboxDirectory, 'intent.json')
    const blockedJournalsDirectory = path.join(
      paths.assistantStateRoot,
      'blocked-journals',
    )

    await mkdir(path.dirname(originalPath), {
      recursive: true,
    })
    await writeFile(originalPath, '{"intent":"bad"}', 'utf8')
    await writeFile(blockedJournalsDirectory, 'not a directory', 'utf8')

    const entry = await quarantineAssistantStateFile({
      artifactKind: 'outbox-intent',
      error: new Error('outbox intent corrupted'),
      filePath: originalPath,
      paths: {
        ...paths,
        journalsDirectory: blockedJournalsDirectory,
      },
    })

    expect(entry).not.toBeNull()
    await expect(readFile(entry!.metadataPath, 'utf8')).resolves.toContain(
      '"artifactKind": "outbox-intent"',
    )
    expect(entry?.quarantinedPath.startsWith(paths.outboxQuarantineDirectory)).toBe(true)
    await expect(listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)).resolves.toEqual(
      [],
    )
  })
})

async function createAssistantPaths(prefix: string): Promise<AssistantStatePaths> {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

function makeRuntimeEvent(index: number) {
  return {
    at: `2026-04-08T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
      index % 60,
    ).padStart(2, '0')}.000Z`,
    component: 'test',
    dataJson: null,
    entityId: `entity-${index}`,
    entityType: 'session',
    kind: 'runtime.maintenance' as const,
    level: 'info' as const,
    message: `event-${index}`,
    schema: 'murph.assistant-runtime-event.v1' as const,
  }
}

async function writeQuarantineMetadata(
  paths: AssistantStatePaths,
  input: {
    artifactKind: 'outbox-intent' | 'session' | 'status'
    directory: string
    index: number
  },
): Promise<void> {
  const basename = `${input.artifactKind}-${input.index}.json`
  const quarantinedPath = path.join(input.directory, basename)
  const metadataPath = `${quarantinedPath}.meta.json`

  await mkdir(path.dirname(quarantinedPath), {
    recursive: true,
  })
  await writeFile(quarantinedPath, `{ "index": ${input.index} }`, 'utf8')
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        artifactKind: input.artifactKind,
        errorCode: input.index % 2 === 0 ? 'EINVALID' : null,
        message: `${input.artifactKind} quarantine ${input.index}`,
        metadataPath,
        originalPath: path.join(paths.journalsDirectory, `${basename}.original`),
        quarantinedAt: `2026-04-08T12:${String(input.index).padStart(2, '0')}:00.000Z`,
        quarantinedPath,
        quarantineId: `q_test_${input.index}`,
        schema: 'murph.assistant-quarantine-entry.v1',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}
