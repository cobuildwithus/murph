import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createEmptyMemoryDocument,
  memoryDocumentRelativePath,
  renderMemoryDocument,
  upsertMemoryRecord,
} from '@murphai/contracts'
import { initializeVault } from '@murphai/core'
import { afterEach, test } from 'vitest'

import {
  createTempVaultContext,
  requireData,
  runCli,
} from './cli-test-helpers.js'

const cleanupPaths: string[] = []
const BUILT_ASSISTANT_ONBOARDING_TIMEOUT_MS = 120_000

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true })
    ),
  )
})

test(
  'built assistant onboarding resume-context keeps duplicate memory repair terminal while other surfaces remain available',
  async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-assistant-memory-repair-',
    )
    cleanupPaths.push(parentRoot)
    await initializeVault({ vaultRoot })

    const memoryPath = path.join(vaultRoot, memoryDocumentRelativePath)
    const first = upsertMemoryRecord(
      createEmptyMemoryDocument(new Date('2026-08-30T16:00:00.000Z')),
      {
        now: new Date('2026-08-30T16:00:01.000Z'),
        section: 'Context',
        text: 'Synthetic onboarding memory alpha that must not appear in recovery output.',
      },
    )
    const second = upsertMemoryRecord(first.document, {
      now: new Date('2026-08-30T16:00:02.000Z'),
      section: 'Context',
      text: 'Synthetic onboarding memory beta that must not appear in recovery output.',
    })
    const duplicateMarkdown = renderMemoryDocument({
      document: second.document,
    }).replace(second.record.id, first.record.id)
    const duplicateLine = duplicateMarkdown
      .split('\n')
      .findIndex((line) => line.includes('Synthetic onboarding memory beta')) + 1
    await writeFile(memoryPath, duplicateMarkdown, 'utf8')
    const bytesBefore = await readFile(memoryPath)

    const result = requireData(
      await runCli<{
        memory: {
          code: string
          hint?: string
          message: string
          retryable: boolean
          status: string
        }
        goals: { status: string }
        regimens: { status: string }
        supplements: { status: string }
        conditions: { status: string }
        allergies: { status: string }
        experiments: { status: string }
      }>([
        'assistant',
        'onboarding',
        'resume-context',
        '--vault',
        vaultRoot,
      ], {
        env: {
          HOME: parentRoot,
          MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
        },
      }),
    )

    assert.deepEqual(result.memory, {
      status: 'error',
      code: 'memory_document_invalid',
      message: 'Canonical memory could not be read while resuming onboarding.',
      retryable: false,
      hint: `Repair bank/memory.md:${duplicateLine} by fixing the invalid id field before continuing onboarding.`,
    })
    for (const surface of [
      result.goals,
      result.regimens,
      result.supplements,
      result.conditions,
      result.allergies,
      result.experiments,
    ]) {
      assert.equal(surface.status, 'ok')
    }

    const serializedMemory = JSON.stringify(result.memory)
    assert.doesNotMatch(serializedMemory, /Synthetic onboarding memory/u)
    assert.doesNotMatch(serializedMemory, new RegExp(first.record.id, 'u'))
    assert.doesNotMatch(
      serializedMemory,
      new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    )
    assert.deepEqual(await readFile(memoryPath), bytesBefore)
  },
  BUILT_ASSISTANT_ONBOARDING_TIMEOUT_MS,
)
