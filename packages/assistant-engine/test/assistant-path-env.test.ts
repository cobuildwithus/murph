import assert from 'node:assert/strict'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { sanitizeChildProcessEnv } from '../src/child-process-env.ts'
import {
  normalizeAssistantCaptureId,
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

test('sanitizeChildProcessEnv strips coverage inheritance while preserving other variables', () => {
  expect(
    sanitizeChildProcessEnv({
      KEEP_ME: '1',
      NODE_V8_COVERAGE: '/tmp/coverage',
    }),
  ).toEqual({
    KEEP_ME: '1',
  })
})

test('sanitizeChildProcessEnv also scrubs inherited coverage state when no explicit env is passed', () => {
  const originalCoverage = process.env.NODE_V8_COVERAGE
  const originalKeepMe = process.env.KEEP_ME
  process.env.NODE_V8_COVERAGE = '/tmp/inherited-coverage'
  process.env.KEEP_ME = 'inherited'

  try {
    expect(sanitizeChildProcessEnv(undefined).NODE_V8_COVERAGE).toBeUndefined()
    expect(sanitizeChildProcessEnv(undefined).KEEP_ME).toBe('inherited')
  } finally {
    if (originalCoverage === undefined) {
      delete process.env.NODE_V8_COVERAGE
    } else {
      process.env.NODE_V8_COVERAGE = originalCoverage
    }

    if (originalKeepMe === undefined) {
      delete process.env.KEEP_ME
    } else {
      process.env.KEEP_ME = originalKeepMe
    }
  }
})

test('resolveAssistantVaultPath keeps paths inside the vault and rejects traversal outside it', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-vault-path-',
  )
  cleanupPaths.push(parentRoot)

  await mkdir(path.join(vaultRoot, 'journal'), { recursive: true })
  await writeFile(path.join(vaultRoot, 'journal', 'notes.md'), '# Notes\n', 'utf8')

  assert.equal(
    await resolveAssistantVaultPath(vaultRoot, 'journal/notes.md', 'file path'),
    path.join(vaultRoot, 'journal', 'notes.md'),
  )

  await assert.rejects(
    () => resolveAssistantVaultPath(vaultRoot, '../outside.md', 'file path'),
    {
      code: 'ASSISTANT_PATH_OUTSIDE_VAULT',
    },
  )
})

test('resolveAssistantVaultPath rejects symlink escapes and artifact helpers normalize capture ids', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-vault-symlink-',
  )
  cleanupPaths.push(parentRoot)

  const externalRoot = path.join(parentRoot, 'external')
  await mkdir(externalRoot, { recursive: true })
  await writeFile(path.join(externalRoot, 'artifact.txt'), 'outside\n', 'utf8')
  await symlink(externalRoot, path.join(vaultRoot, 'linked'))

  await assert.rejects(
    () => resolveAssistantVaultPath(vaultRoot, 'linked/artifact.txt', 'file path'),
    {
      code: 'ASSISTANT_PATH_OUTSIDE_VAULT',
    },
  )

  assert.equal(normalizeAssistantCaptureId(' capture-1 '), 'capture-1')

  const artifactPath = await resolveAssistantInboxArtifactPath(
    vaultRoot,
    'capture-1',
    'artifact.json',
  )
  assert.deepEqual(artifactPath, {
    captureId: 'capture-1',
    absoluteDirectory: path.join(vaultRoot, 'derived', 'inbox', 'capture-1', 'assistant'),
    absolutePath: path.join(
      vaultRoot,
      'derived',
      'inbox',
      'capture-1',
      'assistant',
      'artifact.json',
    ),
    relativeDirectory: 'derived/inbox/capture-1/assistant',
    relativePath: 'derived/inbox/capture-1/assistant/artifact.json',
  })

  await assert.rejects(
    () => resolveAssistantInboxArtifactPath(vaultRoot, 'capture-1', '../artifact.json'),
    {
      code: 'ASSISTANT_PATH_OUTSIDE_VAULT',
    },
  )
})
