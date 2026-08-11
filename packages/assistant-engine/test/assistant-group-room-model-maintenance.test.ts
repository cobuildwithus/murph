import { describe, expect, it } from 'vitest'

import {
  executeGroupRoomModelDynamicTool,
  type GroupRoomModelDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/group-room-model.js'
import type {
  AssistantGroupRoomModelReadState,
} from '../src/assistant/group-room-model.js'

const digest = 'a'.repeat(64)
const vaultRoot = '/tmp/group-room-model-maintenance-test'

describe('group room-model maintenance boundary', () => {
  it('reports exact UTF-8 body bytes for present and missing state', async () => {
    const body = '## People\n- Casey likes 🧠-dry rulings.'
    const present = await execute(
      { action: 'show' },
      {
        body,
        digest,
        kind: 'present',
        status: 'active',
      },
    )
    expect(readResult(present)).toEqual({
      body,
      bodyUtf8Bytes: new TextEncoder().encode(body).byteLength,
      digest,
      status: 'active',
    })

    const missing = await execute(
      { action: 'show' },
      { digest, kind: 'missing' },
    )
    expect(readResult(missing)).toEqual({
      body: null,
      bodyUtf8Bytes: 0,
      digest,
      status: 'missing',
    })
  })

  it('prevents silent maintenance from reactivating inactive state', async () => {
    const result = await execute(
      {
        action: 'upsert',
        body: '## People\n- Maintenance must not reactivate this page.',
        expectedDigest: digest,
      },
      {
        body: '## People\n- Keep this archived.',
        digest,
        kind: 'present',
        status: 'archived',
      },
    )

    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'must not reactivate inactive group room-model state',
    )
  })
})

async function execute(
  args: Extract<
    GroupRoomModelDynamicToolRequest,
    { kind: 'group-room-model' }
  >['args'],
  state: AssistantGroupRoomModelReadState,
): Promise<Awaited<ReturnType<typeof executeGroupRoomModelDynamicTool>>> {
  return await executeGroupRoomModelDynamicTool({
    available: true,
    managedMaintenanceAuthorized: true,
    readGroupRoomModelState: async () => state,
    request: { args, kind: 'group-room-model' },
    userActionScope: null,
    vaultRoot,
  })
}

function readResult(
  result: Awaited<ReturnType<typeof executeGroupRoomModelDynamicTool>>,
): unknown {
  expect(result.rpcResult.success).toBe(true)
  return JSON.parse(result.rpcResult.contentItems[0]?.text ?? 'null')
}
