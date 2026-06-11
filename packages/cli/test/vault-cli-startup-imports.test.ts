import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { afterEach, test, vi } from 'vitest'

function assistantCliSourcePath(relativeSourcePath: string): string {
  return fileURLToPath(
    new URL(`../../assistant-cli/src/${relativeSourcePath}`, import.meta.url),
  )
}

// Ordinary (non-chat, non-setup) vault-cli invocations must not load the full
// command manifest or the interactive ink UI stack (ink/react/yoga-layout).
// Both leaked into the eager startup graph before 2026-06-11 and multiplied
// hosted per-invocation CLI latency. Each forbidden module is mocked to throw
// at load, so any re-introduced static import fails these tests.
const forbiddenStartupModules = [
  '../src/vault-cli-command-manifest.js',
  assistantCliSourcePath('assistant-chat-ink.ts'),
  assistantCliSourcePath('assistant/ui/ink.ts'),
  '@murphai/setup-cli/setup-assistant-wizard',
] as const

// Modules installed on every scoped invocation by `cli-entry.ts`, plus the
// entry and routing modules themselves.
const scopedHotPathModules = [
  '../src/cli-entry.js',
  '../src/vault-cli-routing.js',
  '../src/vault-cli-shell.js',
  '../src/vault-cli-command-routing.js',
  '../src/vault-cli-llms-normalizer.js',
  '../src/vault-cli-schema-index.js',
  '../src/vault-cli-vault-context.js',
] as const

afterEach(() => {
  vi.resetModules()
  for (const moduleId of forbiddenStartupModules) {
    vi.doUnmock(moduleId)
  }
})

function errorChainMentionsStartupHotPath(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.message.includes('must stay off the vault-cli startup hot path')) {
      return true
    }
  }

  return false
}

function mockForbiddenStartupModules() {
  vi.resetModules()
  for (const moduleId of forbiddenStartupModules) {
    vi.doMock(moduleId, () => {
      throw new Error(`${moduleId} must stay off the vault-cli startup hot path`)
    })
  }
}

test('forbidden startup module mocks intercept their module ids', async () => {
  mockForbiddenStartupModules()

  // Guards the other tests against passing vacuously: if a mock id stopped
  // resolving to the module the production code imports, this import would
  // succeed instead of rejecting.
  for (const moduleId of forbiddenStartupModules) {
    await assert.rejects(
      import(moduleId),
      (error: unknown) => errorChainMentionsStartupHotPath(error),
      `expected the throwing mock for ${moduleId} to intercept its import`,
    )
  }
})

test('scoped hot-path modules do not import the manifest or ink surfaces at module load', async () => {
  mockForbiddenStartupModules()

  for (const moduleId of scopedHotPathModules) {
    await import(moduleId)
  }
})

test('assistant command registration does not import the ink chat surface at module load', async () => {
  mockForbiddenStartupModules()

  await import('@murphai/assistant-cli/commands/assistant')
})

test('model command registration does not import the setup assistant wizard at module load', async () => {
  mockForbiddenStartupModules()

  await import('../src/commands/model.ts')
})
