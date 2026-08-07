import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { initializeVault } from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_ROOM_MODEL_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  executeGroupRoomModelDynamicTool,
  readGroupRoomModelDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/group-room-model.js'
import type {
  AssistantHostedToolContext,
  AssistantHostedUserActionScope,
} from '../src/assistant/hosted-tool-context.js'
import {
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
  ASSISTANT_GROUP_ROOM_MODEL_SLUG,
  assistantRouteSupportsGroupRoomModel,
  readAssistantGroupRoomModelBody,
} from '../src/assistant/group-room-model.js'
import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
} from '../src/knowledge/documents.js'
import { upsertKnowledgePage } from '../src/knowledge/service.js'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  )
})

describe('authenticated group room-model tool', () => {
  it('admits only authenticated non-direct chat routes', () => {
    expect(assistantRouteSupportsGroupRoomModel({
      channel: 'linq',
      threadIsDirect: false,
    })).toBe(true)
    expect(assistantRouteSupportsGroupRoomModel({
      channel: 'telegram',
      threadIsDirect: false,
    })).toBe(true)
    expect(assistantRouteSupportsGroupRoomModel({
      channel: 'email',
      threadIsDirect: false,
    })).toBe(false)
    expect(assistantRouteSupportsGroupRoomModel({
      channel: 'linq',
      threadIsDirect: true,
    })).toBe(false)

    expect(resolveMurphDynamicTools({
      groupRoomModelAvailable: true,
    })).toContain(MURPH_GROUP_ROOM_MODEL_TOOL)
    expect(resolveMurphDynamicTools({
      groupRoomModelAvailable: false,
    })).not.toContain(MURPH_GROUP_ROOM_MODEL_TOOL)
  })

  it('fully rewrites the fixed page only with current group-input authority', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const firstBody = [
      '## People',
      '- Casey likes dry rulings.',
    ].join('\n')
    const updatedBody = [
      '## What to avoid',
      '- Retire the combine nickname.',
    ].join('\n')

    const missing = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const missingState = JSON.parse(
      missing.rpcResult.contentItems[0]!.text,
    ) as { digest: string }
    const firstWrite = await executeRequest({
      args: {
        action: 'upsert',
        body: firstBody,
        expectedDigest: missingState.digest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const show = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const secondWrite = await executeRequest({
      args: {
        action: 'upsert',
        body: updatedBody,
        expectedDigest: (
          JSON.parse(show.rpcResult.contentItems[0]!.text) as {
            digest: string
          }
        ).digest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })

    expect(firstWrite.rpcResult.success).toBe(true)
    expect(JSON.parse(show.rpcResult.contentItems[0]!.text)).toMatchObject({
      body: firstBody,
      status: 'active',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(secondWrite.rpcResult.success).toBe(true)
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toBe(updatedBody)
  })

  it('binds writes to show state, rejects empty or identifying bodies, and supports explicit deletion', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-cas-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const showMissing = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const missingDigest = (
      JSON.parse(showMissing.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest

    for (const body of [
      '# Group room model',
      '## People\n- Casey (`+15550000001`) likes dry rulings.',
      '## People\n- Sender: 456 likes dry rulings.',
      '## People\n- **Sender:** 456 likes dry rulings.',
      '## People\n- Sender: `456` likes dry rulings.',
      '## People\n- __Sender__: 456 likes dry rulings.',
      '## People\n- _Sender_: `456` likes dry rulings.',
    ]) {
      const rejected = await executeRequest({
        args: {
          action: 'upsert',
          body,
          expectedDigest: missingDigest,
        },
        available: true,
        scope: createUserActionScope('group'),
        vaultRoot,
      })
      expect(rejected.rpcResult.success).toBe(false)
    }

    const created = await executeRequest({
      args: {
        action: 'upsert',
        body: '## People\n- Casey likes dry rulings.',
        expectedDigest: missingDigest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    expect(created.rpcResult.success).toBe(true)

    const stale = await executeRequest({
      args: {
        action: 'upsert',
        body: '## People\n- stale replacement',
        expectedDigest: missingDigest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    expect(stale.rpcResult.success).toBe(false)

    const showCreated = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const createdState = JSON.parse(
      showCreated.rpcResult.contentItems[0]!.text,
    ) as { body: string; digest: string }
    expect(createdState.body).toContain('Casey likes dry rulings.')

    const deleted = await executeRequest({
      args: {
        action: 'delete',
        expectedDigest: createdState.digest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    expect(deleted.rpcResult.success).toBe(true)
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toBeNull()

    const recreatedShow = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const recreatedMissingDigest = (
      JSON.parse(recreatedShow.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest
    const recreated = await executeRequest({
      args: {
        action: 'upsert',
        body: '## What to avoid\n- Keep the old nickname retired.',
        expectedDigest: recreatedMissingDigest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    expect(recreated.rpcResult.success).toBe(true)
  })

  it('fails closed without declared-tool and current group-input authority', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-denied-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    for (const [available, scope] of [
      [false, createUserActionScope('group')],
      [true, createUserActionScope('direct')],
      [true, { ...createUserActionScope('group'), acceptedInputIds: [] }],
      [true, null],
    ] as const) {
      const result = await executeRequest({
        args: {
          action: 'upsert',
          body: '## Tips\n- should not persist',
          expectedDigest: 'a'.repeat(64),
        },
        available,
        scope,
        vaultRoot,
      })
      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'unavailable for this conversation',
      )
    }

    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toBeNull()
  })

  it('admits the same fixed owner for engine-authorized silent maintenance', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-maintenance-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const show = await executeGroupRoomModelDynamicTool({
      available: true,
      managedMaintenanceAuthorized: true,
      request: requireGroupRoomModelRequest({ action: 'show' }),
      userActionScope: null,
      vaultRoot,
    })
    const expectedDigest = (
      JSON.parse(show.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest
    const write = await executeGroupRoomModelDynamicTool({
      available: true,
      managedMaintenanceAuthorized: true,
      request: requireGroupRoomModelRequest({
        action: 'upsert',
        body: '## Running bits and callbacks\n- Keep mock rulings dry.',
        expectedDigest,
      }),
      userActionScope: null,
      vaultRoot,
    })

    expect(write.rpcResult.success).toBe(true)
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toContain('Keep mock rulings dry.')

    const current = await executeGroupRoomModelDynamicTool({
      available: true,
      managedMaintenanceAuthorized: true,
      request: requireGroupRoomModelRequest({ action: 'show' }),
      userActionScope: null,
      vaultRoot,
    })
    const currentDigest = (
      JSON.parse(current.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest
    for (const body of [
      '## People\n- Sender: 456 likes dry rulings.',
      '## People\n- **Sender:** 456 likes dry rulings.',
      '## People\n- Sender: `456` likes dry rulings.',
      '## People\n- __Sender__: 456 likes dry rulings.',
      '## People\n- _Sender_: `456` likes dry rulings.',
    ]) {
      const identifyingWrite = await executeGroupRoomModelDynamicTool({
        available: true,
        managedMaintenanceAuthorized: true,
        request: requireGroupRoomModelRequest({
          action: 'upsert',
          body,
          expectedDigest: currentDigest,
        }),
        userActionScope: null,
        vaultRoot,
      })
      expect(identifyingWrite.rpcResult.success).toBe(false)
      await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
        .resolves.toContain('Keep mock rulings dry.')
    }
  })

  it('accepts large bodies and rejects selector-bearing arguments', () => {
    expect(readRequest({
      action: 'upsert',
      body: 'x'.repeat(8 * 1024 + 1),
      expectedDigest: 'a'.repeat(64),
    })?.kind).toBe('group-room-model')
    expect(readRequest({
      action: 'show',
      participantId: 'participant:other',
    })?.kind).toBe('invalid-group-room-model-arguments')
    expect(MURPH_GROUP_ROOM_MODEL_TOOL.description).toContain(
      'If show fails or a write reports stale state, stop.',
    )
    expect(MURPH_GROUP_ROOM_MODEL_TOOL.description).toContain(
      'defensive 64 KiB file-read ceiling',
    )
  })

  it('fails closed on malformed or conflicting fixed-page state', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-conflict-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const pagePath = await resolveAssistantVaultPath(
      vaultRoot,
      buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
      'file path',
    )
    const missing = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const expectedDigest = (
      JSON.parse(missing.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest
    await executeRequest({
      args: {
        action: 'upsert',
        body: '## Tips\n- prior valid tip',
        expectedDigest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })

    const identifyingBodies = [
      '## People\n- Sender: 456 likes dry rulings.',
      '## People\n- **Sender:** 456 likes dry rulings.',
      '## People\n- Sender: `456` likes dry rulings.',
      '## People\n- __Sender__: 456 likes dry rulings.',
      '## People\n- _Sender_: `456` likes dry rulings.',
    ]
    for (const conflictingFile of [
      '---\nslug: group-room-model\npageType: [broken\n---\n\nprior bytes',
      buildKnowledgeMarkdown({
        body: '## Tips\n- conflicting concept page',
        compiledAt: '2026-07-25T00:00:00.000Z',
        librarySlugs: [],
        pageType: 'concept',
        relatedSlugs: [],
        slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
        sourcePaths: [],
        status: 'active',
        summary: 'conflicting concept page',
        title: 'Group room model',
      }),
      ...identifyingBodies.map((body) =>
        buildKnowledgeMarkdown({
          body,
          compiledAt: '2026-07-25T00:00:00.000Z',
          librarySlugs: [],
          pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
          relatedSlugs: [],
          slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
          sourcePaths: [],
          status: 'active',
          summary: null,
          title: 'Group room model',
        }),
      ),
    ]) {
      await writeFile(pagePath, conflictingFile, 'utf8')
      const priorFile = await readFile(pagePath)

      const show = await executeRequest({
        args: { action: 'show' },
        available: true,
        scope: createUserActionScope('group'),
        vaultRoot,
      })
      const replacement = await executeRequest({
        args: {
          action: 'upsert',
          body: '## Tips\n- replacement',
          expectedDigest,
        },
        available: true,
        scope: createUserActionScope('group'),
        vaultRoot,
      })

      expect(show.rpcResult.success).toBe(false)
      expect(replacement.rpcResult.success).toBe(false)
      await expect(readFile(pagePath)).resolves.toEqual(priorFile)
      await expect(upsertKnowledgePage({
        body: '## Tips\n- direct replacement',
        pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
        slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
        status: 'active',
        title: 'Group room model',
        vault: vaultRoot,
      })).rejects.toMatchObject({
        code: 'knowledge_page_reserved',
      })
      await expect(readFile(pagePath)).resolves.toEqual(priorFile)
    }
  })

  it('does not replace the page when its strict read fails', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-group-room-model-tool-read-failure-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })
    const missing = await executeRequest({
      args: { action: 'show' },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const expectedDigest = (
      JSON.parse(missing.rpcResult.contentItems[0]!.text) as {
        digest: string
      }
    ).digest
    await executeRequest({
      args: {
        action: 'upsert',
        body: '## Tips\n- prior valid tip',
        expectedDigest,
      },
      available: true,
      scope: createUserActionScope('group'),
      vaultRoot,
    })
    const pagePath = await resolveAssistantVaultPath(
      vaultRoot,
      buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
      'file path',
    )
    const priorFile = await readFile(pagePath)
    const readFailure = async () => {
      throw new Error('injected room-model read failure')
    }

    for (const args of [
      { action: 'show' },
      {
        action: 'upsert',
        body: '## Tips\n- replacement',
        expectedDigest,
      },
    ] as const) {
      const result = await executeGroupRoomModelDynamicTool({
        available: true,
        readGroupRoomModelState: readFailure,
        request: requireGroupRoomModelRequest(args),
        userActionScope: createUserActionScope('group'),
        vaultRoot,
      })
      expect(result.rpcResult.success).toBe(false)
    }
    await expect(readFile(pagePath)).resolves.toEqual(priorFile)
  })
})

function requireGroupRoomModelRequest(args: unknown) {
  const request = readGroupRoomModelDynamicToolRequest({
    arguments: args,
    tool: 'group_room_model',
  })
  if (!request || request.kind !== 'group-room-model') {
    throw new Error('Expected valid group room-model arguments.')
  }
  return request
}

function readRequest(args: unknown) {
  return readMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: args,
      namespace: 'murph',
      tool: 'group_room_model',
    },
  })
}

async function executeRequest(input: {
  args: unknown
  available: boolean
  scope: AssistantHostedUserActionScope | null
  vaultRoot: string
}) {
  const request = readRequest(input.args)
  if (!request) {
    throw new Error('Expected a group room-model dynamic tool request.')
  }
  return await executeMurphDynamicToolRequest({
    env: {},
    fetchImpl: fetch,
    groupRoomModelAvailable: input.available,
    hostedToolContext: createHostedToolContext(input.scope),
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    vaultRoot: input.vaultRoot,
  })
}

function createHostedToolContext(
  scope: AssistantHostedUserActionScope | null,
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => scope,
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
  }
}

function createUserActionScope(
  conversationScope: AssistantHostedUserActionScope['conversationScope'],
): AssistantHostedUserActionScope {
  return {
    acceptedInputIds: ['assistant-input-current'],
    conversationId: 'conversation-current',
    conversationScope,
    inboundMailboxItemIds: ['mailbox-current'],
    originSessionId: 'session-current',
    recipientKey: 'recipient-current',
  }
}
