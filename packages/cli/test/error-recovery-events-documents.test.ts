import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { test } from 'vitest'

import {
  requireData,
  runCli,
  type CliEnvelope,
  type CliErrorEnvelope,
} from './cli-test-helpers.js'

function requireError(result: CliEnvelope): CliErrorEnvelope['error'] {
  assert.equal(result.ok, false, JSON.stringify(result))
  if (result.ok) {
    throw new Error('expected CLI error envelope')
  }
  return result.error
}

function assertDoesNotEcho(result: CliEnvelope, values: readonly string[]) {
  const serialized = JSON.stringify(result)
  for (const value of values) {
    assert.equal(serialized.includes(value), false, `error envelope echoed ${value}`)
  }
}

test.sequential('built CLI returns bounded event import and edit repair fields', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-repair-'))
  const payloadPath = path.join(vaultRoot, 'event-input.json')
  const privateTitle = `private-event-title-${'x'.repeat(170)}`

  try {
    await initializeVault({ vaultRoot })
    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: 'symptom',
        occurredAt: '2026-08-24T12:00:00.000Z',
        title: privateTitle,
        symptom: 'headache',
        intensity: 4,
      }),
      'utf8',
    )

    const invalidImport = await runCli([
      'event',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
    ])
    const importError = requireError(invalidImport)

    assert.equal(importError.code, 'contract_invalid')
    assert.equal(importError.retryable, false)
    assert.equal(importError.stage, 'validation')
    assert.equal(importError.hint, 'Correct the listed event fields and retry.')
    assert.equal(importError.fieldErrors?.some((field) => field.path === 'title'), true)
    assertDoesNotEcho(invalidImport, [privateTitle, payloadPath, vaultRoot])

    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: 'symptom',
        occurredAt: '2026-08-24T12:00:00.000Z',
        title: 'Headache',
        symptom: 'headache',
        intensity: 4,
      }),
      'utf8',
    )
    const imported = await runCli<{ eventId: string }>([
      'event',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
    ])
    assert.equal(imported.ok, true, JSON.stringify(imported))

    const eventId = requireData(imported).eventId
    const invalidEdit = await runCli([
      'event',
      'edit',
      eventId,
      '--clear-title',
      '--vault',
      vaultRoot,
    ])
    const editError = requireError(invalidEdit)

    assert.equal(editError.code, 'contract_invalid')
    assert.equal(editError.retryable, false)
    assert.equal(editError.stage, 'validation')
    assert.equal(editError.fieldErrors?.some((field) => field.path === 'title'), true)
    assertDoesNotEcho(invalidEdit, [eventId, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI classifies document and intake file inputs without paths', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-file-repair-'))
  const missingPath = path.join(vaultRoot, 'private-missing-input.json')
  const lockedPath = path.join(vaultRoot, 'private-locked-input.json')

  try {
    await initializeVault({ vaultRoot })

    for (const command of ['document', 'intake'] as const) {
      const missing = await runCli([
        command,
        'import',
        missingPath,
        '--vault',
        vaultRoot,
      ])
      const missingError = requireError(missing)

      assert.equal(missingError.code, 'not_found')
      assert.equal(missingError.retryable, false)
      assert.equal(missingError.stage, 'input_file')
      assert.match(missingError.hint ?? '', /--file/u)
      assert.equal(missingError.fieldErrors?.[0]?.path, 'file')
      assertDoesNotEcho(missing, [missingPath, vaultRoot])

      const directory = await runCli([
        command,
        'import',
        vaultRoot,
        '--vault',
        vaultRoot,
      ])
      const directoryError = requireError(directory)

      assert.equal(directoryError.code, 'invalid_path')
      assert.equal(directoryError.retryable, false)
      assert.equal(directoryError.stage, 'input_file')
      assert.equal(directoryError.fieldErrors?.[0]?.path, 'file')
      assertDoesNotEcho(directory, [vaultRoot])
    }

    await writeFile(lockedPath, '{}\n', 'utf8')
    await chmod(lockedPath, 0o000)
    try {
      const unreadable = await runCli([
        'intake',
        'import',
        lockedPath,
        '--vault',
        vaultRoot,
      ])
      const unreadableError = requireError(unreadable)

      assert.equal(unreadableError.code, 'permission_denied')
      assert.equal(unreadableError.retryable, false)
      assert.equal(unreadableError.stage, 'input_file')
      assert.equal(unreadableError.fieldErrors?.[0]?.path, 'file')
      assertDoesNotEcho(unreadable, [lockedPath, vaultRoot])
    } finally {
      await chmod(lockedPath, 0o600)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI returns field repair for intake title and lookup failures', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-repair-'))
  const privateFileName = `${'private-assessment-title-'.padEnd(180, 'x')}.json`
  const assessmentPath = path.join(vaultRoot, privateFileName)
  const privateAssessmentId = 'asmt_private_missing_response'
  const privateTitle = `private-intake-title-${'x'.repeat(170)}`

  try {
    await initializeVault({ vaultRoot })
    await writeFile(assessmentPath, '{}\n', 'utf8')

    const invalidTitleOption = await runCli([
      'intake',
      'import',
      assessmentPath,
      '--title',
      privateTitle,
      '--vault',
      vaultRoot,
    ])
    const titleOptionError = requireError(invalidTitleOption)

    assert.equal(titleOptionError.code, 'VALIDATION_ERROR')
    assert.equal(titleOptionError.fieldErrors?.[0]?.path, 'title')
    assertDoesNotEcho(invalidTitleOption, [privateTitle, assessmentPath, vaultRoot])

    const invalidImport = await runCli([
      'intake',
      'import',
      assessmentPath,
      '--vault',
      vaultRoot,
    ])
    const importError = requireError(invalidImport)

    assert.equal(importError.code, 'contract_invalid')
    assert.equal(importError.retryable, false)
    assert.equal(importError.stage, 'validation')
    assert.equal(importError.fieldErrors?.some((field) => field.path === 'title'), true)
    assertDoesNotEcho(invalidImport, [privateFileName, assessmentPath, vaultRoot])

    const missingProjection = await runCli([
      'intake',
      'project',
      privateAssessmentId,
      '--vault',
      vaultRoot,
    ])
    const projectionError = requireError(missingProjection)

    assert.equal(projectionError.code, 'not_found')
    assert.equal(projectionError.retryable, false)
    assert.equal(projectionError.stage, 'lookup')
    assert.match(projectionError.hint ?? '', /intake list/u)
    assert.equal(projectionError.fieldErrors?.[0]?.path, 'id')
    assertDoesNotEcho(missingProjection, [privateAssessmentId, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI rejects invalid journal ids and streams before mutation', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-journal-repair-'))
  const privateEventId = 'private-event-id'
  const privateStream = 'private-stream'

  try {
    await initializeVault({ vaultRoot })

    const invalidEvent = await runCli([
      'journal',
      'link',
      '2026-08-24',
      '--event-id',
      privateEventId,
      '--vault',
      vaultRoot,
    ])
    const invalidEventError = requireError(invalidEvent)
    assert.equal(invalidEventError.code, 'VALIDATION_ERROR')
    assert.equal(invalidEventError.retryable, undefined)
    assert.equal(invalidEventError.fieldErrors?.[0]?.path, 'eventId.0')
    assertDoesNotEcho(invalidEvent, [privateEventId, vaultRoot])

    const invalidStream = await runCli([
      'journal',
      'unlink',
      '2026-08-24',
      '--stream',
      privateStream,
      '--vault',
      vaultRoot,
    ])
    const invalidStreamError = requireError(invalidStream)
    assert.equal(invalidStreamError.code, 'VALIDATION_ERROR')
    assert.equal(invalidStreamError.retryable, undefined)
    assert.equal(invalidStreamError.fieldErrors?.[0]?.path, 'stream.0')
    assertDoesNotEcho(invalidStream, [privateStream, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI classifies malformed manifests and export output failures', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-repair-'))
  const privatePackId = 'private-pack-id'
  const privateManifestValue = 'private-manifest-value'
  const blockingFile = path.join(vaultRoot, 'private-output-blocker')
  const blockedOutput = path.join(blockingFile, 'private-output')

  try {
    await initializeVault({ vaultRoot })
    await mkdir(path.join(vaultRoot, 'exports', 'packs', privatePackId), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'exports', 'packs', privatePackId, 'manifest.json'),
      JSON.stringify({
        packId: privatePackId,
        manifest: { recordCount: privateManifestValue },
      }),
      'utf8',
    )

    const malformed = await runCli([
      'export',
      'pack',
      'show',
      privatePackId,
      '--vault',
      vaultRoot,
    ])
    const malformedError = requireError(malformed)

    assert.equal(malformedError.code, 'manifest_invalid')
    assert.equal(malformedError.retryable, false)
    assert.equal(malformedError.stage, 'manifest_validation')
    assert.equal((malformedError.fieldErrors?.length ?? 0) > 0, true)
    assertDoesNotEcho(malformed, [privatePackId, privateManifestValue, vaultRoot])

    const created = await runCli<{ packId: string }>([
      'export',
      'pack',
      'create',
      '--from',
      '2026-08-20',
      '--to',
      '2026-08-24',
      '--vault',
      vaultRoot,
    ])
    assert.equal(created.ok, true, JSON.stringify(created))
    await writeFile(blockingFile, 'not a directory', 'utf8')

    const unwritable = await runCli([
      'export',
      'pack',
      'materialize',
      requireData(created).packId,
      '--out',
      blockedOutput,
      '--vault',
      vaultRoot,
    ])
    const unwritableError = requireError(unwritable)

    assert.equal(unwritableError.code, 'invalid_path')
    assert.equal(unwritableError.retryable, false)
    assert.equal(unwritableError.stage, 'export_output')
    assert.match(unwritableError.hint ?? '', /--out/u)
    assert.equal(unwritableError.fieldErrors?.[0]?.path, 'out')
    assertDoesNotEcho(unwritable, [blockingFile, blockedOutput, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
