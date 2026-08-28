import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { readMemoryDocument } from '@murphai/core'
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
  it('states the exact-once read and authoritative write receipt contract', () => {
    expect(MURPH_MEMBER_MEMORY_TOOL.description).toContain(
      'Call show exactly once per maintenance turn and use that one result for deduplication and update targeting.',
    )
    expect(MURPH_MEMBER_MEMORY_TOOL.description).toContain(
      'A successful upsert or update result is the canonical persisted record; do not call show again merely to verify it.',
    )
  })

  it('reads, adds, and updates canonical memory through the authorized host', async () => {
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
    expect(added).toEqual({
      created: true,
      memory: {
        id: memoryId,
        section: 'Preferences',
        text: 'Prefers concise weekly summaries.',
      },
    })

    const updated = readResult(await execute(vaultRoot, {
      action: 'update',
      memoryId,
      section: 'Instructions',
      text: 'Keep weekly summaries concise.',
    }))
    expect(updated).toEqual({
      created: false,
      memory: {
        id: memoryId,
        section: 'Instructions',
        text: 'Keep weekly summaries concise.',
      },
    })
    await expect(readMemoryDocument(vaultRoot)).resolves.toMatchObject({
      records: [{
        id: memoryId,
        section: 'Instructions',
        text: 'Keep weekly summaries concise.',
      }],
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
        records: canonicalShow.records.map(({ id, section, text }) => ({
          id,
          section,
          text,
        })),
      },
      memory: null,
    })
    expect(canonicalShow.records).toHaveLength(24)
    expect(canonicalShow.records.map((record) => record.id)).toEqual(
      initialMemoryIds,
    )
    expect(Buffer.byteLength(JSON.stringify({
      document: canonicalShow,
      memory: null,
    }), 'utf8')).toBe(15_128)
    expect(Buffer.byteLength(showText, 'utf8')).toBe(4_890)

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
    expect(added).toEqual({
      created: true,
      memory: {
        id: addedMemoryId,
        section: 'Preferences',
        text: addedText,
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
    expect(Buffer.byteLength(JSON.stringify({
      created: true,
      document: canonicalAfterAdd,
      memory: canonicalAddedRecord,
    }), 'utf8')).toBe(15_924)
    expect(Buffer.byteLength(addedTextResult, 'utf8')).toBe(177)

    const updatedText = 'Synthetic compact identity update'.padEnd(64, '.')
    expect(Buffer.byteLength(updatedText, 'utf8')).toBe(64)
    const updatedMemoryId = initialMemoryIds[0]
    if (!updatedMemoryId) {
      throw new Error('Expected one initial memory id for exact-id update.')
    }
    const updatedResult = await execute(vaultRoot, {
      action: 'update',
      memoryId: updatedMemoryId,
      section: 'Identity',
      text: updatedText,
    })
    const updatedTextResult = readResultText(updatedResult)
    expect(JSON.parse(updatedTextResult)).toEqual({
      created: false,
      memory: {
        id: updatedMemoryId,
        section: 'Identity',
        text: updatedText,
      },
    })
    const canonicalAfterUpdate = await readMemoryDocument(vaultRoot)
    const canonicalUpdatedRecord = canonicalAfterUpdate.records.find(
      (record) => record.id === updatedMemoryId,
    )
    if (!canonicalUpdatedRecord) {
      throw new Error('Expected the exact-id update record to persist.')
    }
    expect(Buffer.byteLength(JSON.stringify({
      created: false,
      document: canonicalAfterUpdate,
      memory: canonicalUpdatedRecord,
    }), 'utf8')).toBe(15_778)
    expect(Buffer.byteLength(updatedTextResult, 'utf8')).toBe(161)
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
    expect(readMemberMemoryDynamicToolRequest({
      arguments: { action: 'show' },
      tool: MURPH_MEMBER_MEMORY_TOOL.name,
    })?.kind).toBe('member-memory')
    expect(readMemberMemoryDynamicToolRequest({
      arguments: { action: 'forget', memoryId: 'mem_not_allowed' },
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
