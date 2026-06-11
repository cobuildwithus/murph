import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

// Ordinary (non-chat, non-setup) vault-cli invocations must not load the full
// command manifest or the interactive ink UI stack (ink/react/yoga-layout).
// Both leaked into the eager startup graph before 2026-06-11 and multiplied
// hosted per-invocation CLI latency. Each forbidden module is mocked to throw
// at load, so any re-introduced static import fails these tests.
// The ink chat surface itself is guarded in-package by
// `packages/assistant-cli/test/assistant-command-startup-imports.test.ts`;
// reaching into that package's src tree from here is forbidden by
// `scripts/verify-package-shape.ts`.
const forbiddenStartupModules = [
  '../src/vault-cli-command-manifest.js',
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

// Module-load guards alone would miss an eager import added inside the
// registration bodies, so exercise the real registration surfaces too.
test('scoped command registration stays off the manifest and wizard surfaces', async () => {
  mockForbiddenStartupModules()

  const [{ createVaultCliShell }, { registerScopedVaultCliCommand }] =
    await Promise.all([
      import('../src/vault-cli-shell.js'),
      import('../src/vault-cli-command-routing.js'),
    ])

  for (const root of ['list', 'meal', 'wearables'] as const) {
    await registerScopedVaultCliCommand({
      cli: createVaultCliShell('vault-cli'),
      root,
    })
  }
})

test('model command registration does not import the setup assistant wizard', async () => {
  mockForbiddenStartupModules()

  const [{ registerModelCommands }, { createVaultCliShell }] =
    await Promise.all([
      import('../src/commands/model.ts'),
      import('../src/vault-cli-shell.js'),
    ])

  registerModelCommands(createVaultCliShell('vault-cli'))
})
