import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { createAssistantRuntimeStateService } from '@murphai/assistant-cli/assistant-runtime'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

test('assistant runtime state service exposes runtime-only helpers and omits product memory CRUD', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-runtime-state-service-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })
  cleanupPaths.push(parent)

  const state = createAssistantRuntimeStateService(vaultRoot)
  assert.equal('memory' in state, false)
  assert.equal(typeof state.sessions.resolve, 'function')
  assert.equal(typeof state.outbox.listIntents, 'function')
  assert.equal(typeof state.status.get, 'function')
})
