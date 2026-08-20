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
  it('reads, adds, and updates canonical memory through the authorized host', async () => {
    const vaultRoot = await makeVaultRoot()

    const shown = await execute(vaultRoot, { action: 'show' })
    expect(readResult(shown)).toMatchObject({
      document: { exists: false, records: [] },
      memory: null,
    })

    const added = readResult(await execute(vaultRoot, {
      action: 'upsert',
      section: 'Preferences',
      text: 'Prefers concise weekly summaries.',
    }))
    expect(added).toMatchObject({
      created: true,
      memory: {
        section: 'Preferences',
        text: 'Prefers concise weekly summaries.',
      },
    })
    const memoryId = readMemoryId(added)

    const updated = readResult(await execute(vaultRoot, {
      action: 'update',
      memoryId,
      section: 'Instructions',
      text: 'Keep weekly summaries concise.',
    }))
    expect(updated).toMatchObject({
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

  it('rejects calls without exact managed-maintenance authority', async () => {
    const vaultRoot = await makeVaultRoot()
    const result = await executeMemberMemoryDynamicTool({
      available: true,
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
    available: true,
    managedMaintenanceAuthorized: true,
    request: { args, kind: 'member-memory' },
    vaultRoot,
  })
}

function readResult(
  result: Awaited<ReturnType<typeof executeMemberMemoryDynamicTool>>,
): unknown {
  expect(result.rpcResult.success).toBe(true)
  return JSON.parse(result.rpcResult.contentItems[0]?.text ?? 'null')
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
