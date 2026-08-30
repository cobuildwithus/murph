import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { readMemoryDocument, updateMemory } from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  executeMemberMemoryDynamicTool,
  MURPH_MEMBER_MEMORY_TOOL,
  readMemberMemoryDynamicToolRequest,
  type MemberMemoryDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/member-memory.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  )
})

describe('member-memory maintenance boundary', () => {
  it('states the exact-once read and guarded mutation receipt contract', () => {
    expect(MURPH_MEMBER_MEMORY_TOOL.description).toContain(
      'Call show exactly once per maintenance turn and use that one result for deduplication and mutation targeting.',
    )
    expect(MURPH_MEMBER_MEMORY_TOOL.description).toContain(
      "pass that record's exact updatedAt as expectedUpdatedAt",
    )
    expect(MURPH_MEMBER_MEMORY_TOOL.description).toContain(
      'If a record changed after show, leave the newer value unchanged and end the write attempt',
    )
  })

  it('reads, adds, updates, and forgets canonical memory through the authorized host', async () => {
    const vaultRoot = await makeVaultRoot()

    const shown = await execute(vaultRoot, { action: 'show' })
    expect(readResult(shown)).toEqual({
      document: { exists: false, records: [] },
      memory: null,
    })

    const added = readResult(await execute(vaultRoot, {
      action: 'upsert',
      section: 'Preferences',
      text: 'Prefers concise weekly summaries.',
    }))
    const memoryId = readMemoryId(added)
    const addedUpdatedAt = readMemoryUpdatedAt(added)
    expect(added).toEqual({
      created: true,
      memory: {
        id: memoryId,
        section: 'Preferences',
        text: 'Prefers concise weekly summaries.',
        updatedAt: addedUpdatedAt,
      },
    })

    const updated = readResult(await execute(vaultRoot, {
      action: 'update',
      expectedUpdatedAt: addedUpdatedAt,
      memoryId,
      section: 'Instructions',
      text: 'Keep weekly summaries concise.',
    }))
    const updatedUpdatedAt = readMemoryUpdatedAt(updated)
    expect(updated).toEqual({
      created: false,
      memory: {
        id: memoryId,
        section: 'Instructions',
        text: 'Keep weekly summaries concise.',
        updatedAt: updatedUpdatedAt,
      },
    })
    await expect(readMemoryDocument(vaultRoot)).resolves.toMatchObject({
      records: [{
        id: memoryId,
        section: 'Instructions',
        text: 'Keep weekly summaries concise.',
      }],
    })

    expect(readResult(await execute(vaultRoot, {
      action: 'forget',
      expectedUpdatedAt: updatedUpdatedAt,
      memoryId,
    }))).toEqual({
      forgotten: true,
      memory: null,
    })
    await expect(readMemoryDocument(vaultRoot)).resolves.toMatchObject({
      records: [],
    })
  })

  it('keeps the private-free 24-record result-size proof compact without changing persistence', async () => {
    const vaultRoot = await makeVaultRoot()
    const sections = [
      'Identity',
      'Preferences',
      'Instructions',
      'Context',
    ] as const
    const initialMemoryIds: string[] = []

    for (const section of sections) {
      for (let index = 0; index < 6; index += 1) {
        const text = [
          `Synthetic ${section.toLowerCase()} memory fixture ${index + 1}`,
          'for deterministic compact result sizing only.',
        ].join(' ').padEnd(129, '.')
        expect(Buffer.byteLength(text, 'utf8')).toBe(129)
        const result = readResult(await execute(vaultRoot, {
          action: 'upsert',
          section,
          text,
        }))
        initialMemoryIds.push(readMemoryId(result))
      }
    }

    const canonicalShow = await readMemoryDocument(vaultRoot)
    const showResult = await execute(vaultRoot, { action: 'show' })
    const showText = readResultText(showResult)
    expect(JSON.parse(showText)).toEqual({
      document: {
        exists: true,
        records: canonicalShow.records.map(({ id, section, text, updatedAt }) => ({
          id,
          section,
          text,
          updatedAt,
        })),
      },
      memory: null,
    })
    expect(canonicalShow.records).toHaveLength(24)
    expect(canonicalShow.records.map((record) => record.id)).toEqual(
      initialMemoryIds,
    )
    const fullShowBytes = Buffer.byteLength(JSON.stringify({
      document: canonicalShow,
      memory: null,
    }), 'utf8')
    expect(Buffer.byteLength(showText, 'utf8')).toBeLessThan(fullShowBytes)

    const addedText = 'Synthetic compact upsert preference'.padEnd(78, '.')
    expect(Buffer.byteLength(addedText, 'utf8')).toBe(78)
    const addedResult = await execute(vaultRoot, {
      action: 'upsert',
      section: 'Preferences',
      text: addedText,
    })
    const addedTextResult = readResultText(addedResult)
    const added = JSON.parse(addedTextResult) as unknown
    const addedMemoryId = readMemoryId(added)
    const addedUpdatedAt = readMemoryUpdatedAt(added)
    expect(added).toEqual({
      created: true,
      memory: {
        id: addedMemoryId,
        section: 'Preferences',
        text: addedText,
        updatedAt: addedUpdatedAt,
      },
    })
    const canonicalAfterAdd = await readMemoryDocument(vaultRoot)
    expect(canonicalAfterAdd.records).toHaveLength(25)
    expect(
      canonicalAfterAdd.records
        .filter((record) => record.id !== addedMemoryId)
        .map(({ id, section, text }) => ({ id, section, text })),
    ).toEqual(
      canonicalShow.records.map(({ id, section, text }) => ({
        id,
        section,
        text,
      })),
    )
    const canonicalAddedRecord = canonicalAfterAdd.records.find(
      (record) => record.id === addedMemoryId,
    )
    if (!canonicalAddedRecord) {
      throw new Error('Expected the compact upsert record to persist.')
    }
    const fullAddedResultBytes = Buffer.byteLength(JSON.stringify({
      created: true,
      document: canonicalAfterAdd,
      memory: canonicalAddedRecord,
    }), 'utf8')
    expect(Buffer.byteLength(addedTextResult, 'utf8'))
      .toBeLessThan(fullAddedResultBytes)

    const updatedText = 'Synthetic compact identity update'.padEnd(64, '.')
    expect(Buffer.byteLength(updatedText, 'utf8')).toBe(64)
    const updatedMemoryId = initialMemoryIds[0]
    if (!updatedMemoryId) {
      throw new Error('Expected one initial memory id for exact-id update.')
    }
    const recordBeforeUpdate = canonicalShow.records.find(
      (record) => record.id === updatedMemoryId,
    )
    if (!recordBeforeUpdate) {
      throw new Error('Expected the exact-id update target to exist.')
    }
    const updatedResult = await execute(vaultRoot, {
      action: 'update',
      expectedUpdatedAt: recordBeforeUpdate.updatedAt,
      memoryId: updatedMemoryId,
      section: 'Identity',
      text: updatedText,
    })
    const updatedTextResult = readResultText(updatedResult)
    const updatedUpdatedAt = readMemoryUpdatedAt(
      JSON.parse(updatedTextResult) as unknown,
    )
    expect(JSON.parse(updatedTextResult)).toEqual({
      created: false,
      memory: {
        id: updatedMemoryId,
        section: 'Identity',
        text: updatedText,
        updatedAt: updatedUpdatedAt,
      },
    })
    const canonicalAfterUpdate = await readMemoryDocument(vaultRoot)
    const canonicalUpdatedRecord = canonicalAfterUpdate.records.find(
      (record) => record.id === updatedMemoryId,
    )
    if (!canonicalUpdatedRecord) {
      throw new Error('Expected the exact-id update record to persist.')
    }
    const fullUpdatedResultBytes = Buffer.byteLength(JSON.stringify({
      created: false,
      document: canonicalAfterUpdate,
      memory: canonicalUpdatedRecord,
    }), 'utf8')
    expect(Buffer.byteLength(updatedTextResult, 'utf8'))
      .toBeLessThan(fullUpdatedResultBytes)
    expect(canonicalAfterUpdate.records).toHaveLength(25)
    expect(canonicalAfterUpdate.records.map((record) => record.id).sort()).toEqual(
      canonicalAfterAdd.records.map((record) => record.id).sort(),
    )
    expect(
      canonicalAfterUpdate.records
        .filter((record) => record.id !== updatedMemoryId)
        .map(({ id, section, text }) => ({ id, section, text })),
    ).toEqual(
      canonicalAfterAdd.records
        .filter((record) => record.id !== updatedMemoryId)
        .map(({ id, section, text }) => ({ id, section, text })),
    )
    expect(canonicalUpdatedRecord).toMatchObject({
      id: updatedMemoryId,
      section: 'Identity',
      text: updatedText,
    })
    expect(canonicalAfterUpdate.records).toContainEqual(
      expect.objectContaining({
        id: addedMemoryId,
        section: 'Preferences',
        text: addedText,
      }),
    )
  })

  it('leaves newer saved memory unchanged after a stale maintenance read', async () => {
    const vaultRoot = await makeVaultRoot()
    const added = readResult(await execute(vaultRoot, {
      action: 'upsert',
      section: 'Preferences',
      text: 'Use the original saved format.',
    }))
    const memoryId = readMemoryId(added)
    const staleUpdatedAt = readMemoryUpdatedAt(added)
    const current = await updateMemory(vaultRoot, {
      expectedUpdatedAt: staleUpdatedAt,
      recordId: memoryId,
      text: 'Use the newer saved format.',
    })

    const staleUpdate = await execute(vaultRoot, {
      action: 'update',
      expectedUpdatedAt: staleUpdatedAt,
      memoryId,
      text: 'A stale overwrite must not persist.',
    })
    const staleForget = await execute(vaultRoot, {
      action: 'forget',
      expectedUpdatedAt: staleUpdatedAt,
      memoryId,
    })

    for (const result of [staleUpdate, staleForget]) {
      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toBe(
        'saved memory changed after show; leave the newer value unchanged and end this maintenance write attempt',
      )
    }
    await expect(readMemoryDocument(vaultRoot)).resolves.toMatchObject({
      records: [current.record],
    })
  })

  it('rejects calls without exact managed-maintenance authority', async () => {
    const vaultRoot = await makeVaultRoot()
    const result = await executeMemberMemoryDynamicTool({
      managedMaintenanceAuthorized: false,
      request: {
        args: {
          action: 'upsert',
          section: 'Context',
          text: 'This write must be rejected.',
        },
        kind: 'member-memory',
      },
      vaultRoot,
    })

    expect(result.rpcResult).toMatchObject({ success: false })
    await expect(readMemoryDocument(vaultRoot)).resolves.toMatchObject({
      exists: false,
      records: [],
    })
  })

  it('parses only the strict member-memory action surface', () => {
    const expectedUpdatedAt = '2026-08-30T12:00:00.000Z'
    expect(readMemberMemoryDynamicToolRequest({
      arguments: { action: 'show' },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('member-memory')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: {
        action: 'update',
        expectedUpdatedAt,
        memoryId: 'mem_exact',
        text: 'Updated exact fact.',
      },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('member-memory')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: {
        action: 'forget',
        expectedUpdatedAt,
        memoryId: 'mem_exact',
      },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('member-memory')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: {
        action: 'update',
        memoryId: 'mem_missing_version',
        text: 'Unsafe update.',
      },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('invalid-member-memory-arguments')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: { action: 'forget', memoryId: 'mem_missing_version' },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('invalid-member-memory-arguments')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: { action: 'show' },
      tool: 'another_tool',
    })).toBeNull()
  })
})

async function makeVaultRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-member-memory-tool-'))
  tempRoots.push(root)
  return root
}

async function execute(
  vaultRoot: string,
  args: Extract<
    MemberMemoryDynamicToolRequest,
    { kind: 'member-memory' }
  >['args'],
): Promise<Awaited<ReturnType<typeof executeMemberMemoryDynamicTool>>> {
  return await executeMemberMemoryDynamicTool({
    managedMaintenanceAuthorized: true,
    request: { args, kind: 'member-memory' },
    vaultRoot,
  })
}

function readResult(
  result: Awaited<ReturnType<typeof executeMemberMemoryDynamicTool>>,
): unknown {
  return JSON.parse(readResultText(result))
}

function readResultText(
  result: Awaited<ReturnType<typeof executeMemberMemoryDynamicTool>>,
): string {
  expect(result.rpcResult.success).toBe(true)
  const text = result.rpcResult.contentItems[0]?.text
  if (text === undefined) {
    throw new TypeError('member-memory result is missing result text')
  }
  return text
}

function readMemoryId(result: unknown): string {
  const memory = typeof result === 'object' && result !== null && 'memory' in result
    ? result.memory
    : null
  if (
    typeof memory !== 'object' ||
    memory === null ||
    !('id' in memory) ||
    typeof memory.id !== 'string'
  ) {
    throw new TypeError('member-memory result is missing a memory id')
  }
  return memory.id
}

function readMemoryUpdatedAt(result: unknown): string {
  const memory = typeof result === 'object' && result !== null && 'memory' in result
    ? result.memory
    : null
  if (
    typeof memory !== 'object'
    || memory === null
    || !('updatedAt' in memory)
    || typeof memory.updatedAt !== 'string'
  ) {
    throw new TypeError('member-memory result is missing updatedAt')
  }
  return memory.updatedAt
}
