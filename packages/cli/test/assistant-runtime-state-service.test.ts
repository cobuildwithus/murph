import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { createAssistantRuntimeStateService } from '../src/assistant-runtime.js'

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

test('assistant runtime state service keeps memory vault-bound behind service-owned helpers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-runtime-state-service-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })
  cleanupPaths.push(parent)

  const state = createAssistantRuntimeStateService(vaultRoot)
  const write = await state.memory.upsert({
    section: 'Identity',
    text: 'Call the user Sam.',
    scope: 'long-term',
  })

  assert.equal(write.longTermAdded, 1)
  assert.equal(write.memories[0]?.section, 'Identity')

  const memoryId = write.memories[0]?.id
  assert.equal(typeof memoryId, 'string')
  assert.ok(memoryId)

  const fetched = await state.memory.get(memoryId!)
  assert.equal(fetched.text, 'Call the user Sam.')

  const searched = await state.memory.search({
    text: 'Sam',
    scope: 'all',
  })
  assert.equal(searched.results[0]?.id, memoryId)

  const promptBlock = await state.memory.loadPromptBlock({
    includeSensitiveHealthContext: false,
  })
  assert.match(promptBlock ?? '', /Core assistant memory:/u)
  assert.match(promptBlock ?? '', /Call the user Sam\./u)
})
