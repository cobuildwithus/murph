import { rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'

import { initializeVault } from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  executeGroupRoomModelDynamicTool,
  readGroupRoomModelDynamicToolRequest,
  type GroupRoomModelDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/group-room-model.js'
import type {
  AssistantHostedUserActionScope,
} from '../src/assistant/hosted-tool-context.js'
import {
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
  ASSISTANT_GROUP_ROOM_MODEL_SLUG,
  readAssistantGroupRoomModelBody,
} from '../src/assistant/group-room-model.js'
import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
} from '../src/knowledge/documents.js'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  )
})

describe('group room-model maintenance boundary', () => {
  it('reports exact body bytes and never silently reactivates inactive state', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-maintenance-boundary-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const missing = await executeMaintenance({ action: 'show' }, vaultRoot)
    const missingState = readToolResult<{
      body: null
      bodyUtf8Bytes: number
      digest: string
      status: 'missing'
    }>(missing)
    expect(missingState).toMatchObject({
      body: null,
      bodyUtf8Bytes: 0,
      status: 'missing',
    })

    const body = '## People\n- Casey likes 🧠-dry rulings.'
    const created = await executeMaintenance({
      action: 'upsert',
      body,
      expectedDigest: missingState.digest,
    }, vaultRoot)
    expect(created.rpcResult.success).toBe(true)

    const active = await executeMaintenance({ action: 'show' }, vaultRoot)
    const activeState = readToolResult<{
      body: string
      bodyUtf8Bytes: number
      digest: string
      status: string
    }>(active)
    expect(activeState).toMatchObject({
      body,
      bodyUtf8Bytes: new TextEncoder().encode(body).byteLength,
      status: 'active',
    })

    const pagePath = await resolveAssistantVaultPath(
      vaultRoot,
      buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
      'file path',
    )
    await writeFile(pagePath, buildKnowledgeMarkdown({
      body,
      compiledAt: '2026-08-08T00:00:00.000Z',
      librarySlugs: [],
      pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
      relatedSlugs: [],
      slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
      sourcePaths: [],
      status: 'archived',
      summary: null,
      title: 'Group room model',
    }), 'utf8')

    const inactive = await executeMaintenance({ action: 'show' }, vaultRoot)
    const inactiveState = readToolResult<{
      body: string
      bodyUtf8Bytes: number
      digest: string
      status: string
    }>(inactive)
    expect(inactiveState).toMatchObject({
      body,
      bodyUtf8Bytes: new TextEncoder().encode(body).byteLength,
      status: 'archived',
    })

    const blocked = await executeMaintenance({
      action: 'upsert',
      body: '## People\n- maintenance must not reactivate this page.',
      expectedDigest: inactiveState.digest,
    }, vaultRoot)
    expect(blocked.rpcResult.success).toBe(false)
    expect(blocked.rpcResult.contentItems[0]?.text).toContain(
      'must not reactivate inactive group room-model state',
    )
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toBeNull()

    const explicitUpdate = await executeGroupRoomModelDynamicTool({
      available: true,
      request: requireRequest({
        action: 'upsert',
        body: '## People\n- Casey asked the room to remember this again.',
        expectedDigest: inactiveState.digest,
      }),
      userActionScope: createGroupUserActionScope(),
      vaultRoot,
    })
    expect(explicitUpdate.rpcResult.success).toBe(true)
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toContain('asked the room to remember this again')
  })
})

async function executeMaintenance(
  args: unknown,
  vaultRoot: string,
): Promise<Awaited<ReturnType<typeof executeGroupRoomModelDynamicTool>>> {
  return await executeGroupRoomModelDynamicTool({
    available: true,
    managedMaintenanceAuthorized: true,
    request: requireRequest(args),
    userActionScope: null,
    vaultRoot,
  })
}

function requireRequest(
  args: unknown,
): Extract<GroupRoomModelDynamicToolRequest, { kind: 'group-room-model' }> {
  const request = readGroupRoomModelDynamicToolRequest({
    arguments: args,
    tool: 'group_room_model',
  })
  if (!request || request.kind !== 'group-room-model') {
    throw new Error('Expected valid group room-model tool arguments.')
  }
  return request
}

function readToolResult<T>(
  result: Awaited<ReturnType<typeof executeGroupRoomModelDynamicTool>>,
): T {
  const text = result.rpcResult.contentItems[0]?.text
  if (!result.rpcResult.success || !text) {
    throw new Error(`Expected a successful tool result, received: ${text}`)
  }
  return JSON.parse(text) as T
}

function createGroupUserActionScope(): AssistantHostedUserActionScope {
  return {
    acceptedInputIds: ['input-remember-again'],
    conversationId: 'conversation-group-room-model',
    conversationScope: 'group',
    inboundMailboxItemIds: ['mailbox-remember-again'],
    originSessionId: 'session-group-room-model',
    recipientKey: 'recipient-group-room-model',
  }
}
