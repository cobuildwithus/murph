import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const spawnMock = vi.hoisted(() => vi.fn())
const loadIntegratedRuntimeMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadIntegratedRuntime: loadIntegratedRuntimeMock,
}))

const reviewGptRuntime = await import('../src/review-gpt-runtime.js')
const researchRuntime = await import('../src/research-runtime.js')

afterEach(() => {
  vi.clearAllMocks()
  spawnMock.mockReset()
  loadIntegratedRuntimeMock.mockReset()
})

function createSpawnChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdout: EventEmitter
  }

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()

  return child
}

test('saveVaultTextNote delegates to the integrated runtime batch writer', async () => {
  const applyCanonicalWriteBatch = vi.fn(async () => undefined)
  loadIntegratedRuntimeMock.mockResolvedValue({
    core: {
      applyCanonicalWriteBatch,
    },
  })

  await reviewGptRuntime.saveVaultTextNote({
    vault: '/vaults/primary',
    relativePath: 'research/2026/03/review-note.md',
    content: '# Research note\n',
    operationType: 'research_note.write',
    overwrite: false,
    summary: 'Saved research note.',
  })

  assert.deepEqual(applyCanonicalWriteBatch.mock.calls, [
    [
      {
        operationType: 'research_note.write',
        summary: 'Saved research note.',
        textWrites: [
          {
            relativePath: 'research/2026/03/review-note.md',
            content: '# Research note\n',
            overwrite: false,
          },
        ],
        vaultRoot: '/vaults/primary',
      },
    ],
  ])
})

test('runReviewGptPrompt rejects when the review command cannot spawn', async () => {
  const child = createSpawnChild()
  spawnMock.mockReturnValue(child)

  const promise = reviewGptRuntime.runReviewGptPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Research hydration timing.',
      mode: 'deep-research',
    },
    {
      resolveAssistantDefaults: async () => null,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-review-gpt-spawn-error',
      readTextFile: async () => 'unused',
      removePath: async () => undefined,
    },
  )

  await new Promise<void>((resolve) => setImmediate(resolve))
  child.emit('error', new Error('spawn failed'))

  await assert.rejects(
    promise,
    (error) => error instanceof VaultCliError && error.code === 'research_tool_unavailable',
  )
})

test('runReviewGptPrompt rejects when the review command exits unsuccessfully', async () => {
  const child = createSpawnChild()
  spawnMock.mockReturnValue(child)

  const promise = reviewGptRuntime.runReviewGptPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Research LDL timing.',
      mode: 'gpt-pro',
    },
    {
      resolveAssistantDefaults: async () => null,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-review-gpt-nonzero',
      readTextFile: async () => 'unused',
      removePath: async () => undefined,
    },
  )

  await new Promise<void>((resolve) => setImmediate(resolve))
  child.stdout.emit('data', 'stdout chunk')
  child.stderr.emit('data', 'stderr chunk')
  child.emit('close', 1, null)

  await assert.rejects(
    promise,
    (error) => error instanceof VaultCliError && error.code === 'research_failed',
  )
})

test('runResearchPrompt uses the default save-note flow when no custom saver is supplied', async () => {
  const applyCanonicalWriteBatch = vi.fn(
    async (input: {
      vaultRoot: string
      textWrites: Array<{
        content: string
        overwrite: boolean
        relativePath: string
      }>
    }) => {
      void input
    },
  )
  loadIntegratedRuntimeMock.mockResolvedValue({
    core: {
      applyCanonicalWriteBatch,
    },
  })
  const child = createSpawnChild()
  spawnMock.mockReturnValue(child)

  const promise = researchRuntime.runResearchPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Research sleep consistency.',
      title: 'Sleep consistency',
    },
    {
      now: () => new Date('2026-03-24T05:06:07.008Z'),
      resolveAssistantDefaults: async () => null,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-research-default-save',
      readTextFile: async (filePath) => {
        assert.equal(filePath, '/tmp/murph-research-default-save/response.md')
        return 'Default research response'
      },
      removePath: async () => undefined,
    },
  )

  await new Promise<void>((resolve) => setImmediate(resolve))
  child.emit('close', 0, null)

  const result = await promise

  assert.equal(result.title, 'Sleep consistency')
  const batchInput = applyCanonicalWriteBatch.mock.calls[0]?.[0]
  if (
    !batchInput ||
    typeof batchInput !== 'object' ||
    !('vaultRoot' in batchInput) ||
    !('textWrites' in batchInput)
  ) {
    throw new Error('Expected a canonical write batch call.')
  }

  assert.equal(batchInput.vaultRoot, '/vaults/primary')
  assert.match(
    String(
      (Array.isArray(batchInput.textWrites) ? batchInput.textWrites[0] : null)?.content ?? '',
    ),
    /Default research response/u,
  )
})
