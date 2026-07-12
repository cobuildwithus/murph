import { afterEach, expect, test, vi } from 'vitest'

const createMock = vi.hoisted(() => vi.fn(() => ({ use: vi.fn() })))

vi.mock('incur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('incur')>()

  return {
    ...actual,
    Cli: {
      ...actual.Cli,
      create: createMock,
    },
  }
})

import { createVaultCliShell } from '../src/vault-cli-bootstrap.ts'

afterEach(() => {
  vi.clearAllMocks()
})

test('createVaultCliShell forwards the selected command name to incur', () => {
  const cli = createVaultCliShell('murph')

  expect(cli).toBeDefined()
  expect(createMock).toHaveBeenCalledWith(
    'murph',
    expect.objectContaining({
      description: expect.any(String),
      version: expect.anything(),
    }),
  )
})

test('createVaultCliShell forwards an optional canonical skill hash to incur', () => {
  createVaultCliShell('murph', {
    expectedSkillHash: 'canonical-full-tree-hash',
  })

  expect(createMock).toHaveBeenCalledWith(
    'murph',
    expect.objectContaining({
      sync: expect.objectContaining({
        expectedHash: 'canonical-full-tree-hash',
      }),
    }),
  )
})
