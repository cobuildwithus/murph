import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { test } from 'vitest'

import {
  requireData,
  runCli,
  runRawCli,
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

async function importAssessmentManifestFixture(vaultRoot: string, key: string) {
  const sourceValue = `private-assessment-source-${key}`
  const sourcePath = path.join(vaultRoot, `private-assessment-${key}.json`)
  await writeFile(sourcePath, JSON.stringify({ sourceValue }), 'utf8')

  const imported = await runCli<{
    assessmentId: string
    manifestFile: string
    rawFile: string
  }>([
    'intake',
    'import',
    sourcePath,
    '--title',
    `Assessment ${key}`,
    '--vault',
    vaultRoot,
  ])
  assert.equal(imported.ok, true, JSON.stringify(imported))

  return {
    ...requireData(imported),
    sourcePath,
    sourceValue,
  }
}

test.sequential('built CLI returns bounded event import and edit fields', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-recovery-'))
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
    assert.equal(importError.hint, undefined)
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

test.sequential('built CLI never exposes submitted event record keys in import or edit errors', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-record-key-recovery-'))
  const payloadPath = path.join(vaultRoot, 'event-input.json')
  const privateConfounderKey = 'private_confounder_key_7f3a'
  const privateFieldKey = 'private_field_key_9b2c'
  const privateTopLevelKey = 'private_event_field_4d7e'
  const privateNestedKey = 'private_nested_field_6a8c'
  const privateValue = 'private submitted event value'
  const privateKeys = [
    privateConfounderKey,
    privateFieldKey,
    privateTopLevelKey,
    privateNestedKey,
    privateValue,
  ]

  try {
    await initializeVault({ vaultRoot })
    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: 'intervention_session',
        occurredAt: '2026-08-24T12:00:00.000Z',
        title: 'Recovery session',
        interventionType: 'sauna',
        confounders: {
          [privateConfounderKey]: { nested: 'invalid' },
        },
        fields: {
          [privateFieldKey]: { nested: 'invalid' },
        },
        [privateTopLevelKey]: {
          [privateNestedKey]: privateValue,
        },
      }),
      'utf8',
    )
    const filesBeforeInvalidImport = (await readdir(vaultRoot, { recursive: true })).sort()

    const importArgs = [
      'event',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
    ]
    const invalidImport = await runCli(importArgs)
    const importError = requireError(invalidImport)

    assert.equal(importError.code, 'contract_invalid')
    assert.equal(importError.stage, 'validation')
    assert.equal((importError.fieldErrors?.length ?? 0) > 0, true)
    assert.equal(
      importError.fieldErrors?.every((field) => ['$', 'confounders', 'fields'].includes(field.path)),
      true,
    )
    assertDoesNotEcho(invalidImport, [...privateKeys, payloadPath, vaultRoot])
    const rawImportError = await runRawCli(importArgs)
    for (const privateKey of privateKeys) {
      assert.doesNotMatch(rawImportError, new RegExp(privateKey, 'u'))
    }
    assert.deepEqual(
      (await readdir(vaultRoot, { recursive: true })).sort(),
      filesBeforeInvalidImport,
    )

    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: 'intervention_session',
        occurredAt: '2026-08-24T12:00:00.000Z',
        title: 'Recovery session',
        interventionType: 'sauna',
        confounders: {
          [privateConfounderKey]: 'synthetic value',
        },
        fields: {
          [privateFieldKey]: 'synthetic value',
        },
      }),
      'utf8',
    )
    const imported = await runCli<{ eventId: string }>(importArgs)
    assert.equal(imported.ok, true, JSON.stringify(imported))

    const editArgs = [
      'event',
      'edit',
      requireData(imported).eventId,
      '--title',
      `invalid-title-${'x'.repeat(170)}`,
      '--vault',
      vaultRoot,
    ]
    const invalidEdit = await runCli(editArgs)
    const editError = requireError(invalidEdit)

    assert.equal(editError.code, 'contract_invalid')
    assert.equal(editError.stage, 'validation')
    assert.equal(editError.fieldErrors?.some((field) => field.path === 'title'), true)
    assertDoesNotEcho(invalidEdit, [...privateKeys, requireData(imported).eventId, vaultRoot])
    const rawEditError = await runRawCli(editArgs)
    for (const privateKey of privateKeys) {
      assert.doesNotMatch(rawEditError, new RegExp(privateKey, 'u'))
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI classifies document and intake file inputs without paths', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-file-recovery-'))
  const missingPath = path.join(vaultRoot, 'private-missing-input.json')
  const lockedPath = path.join(vaultRoot, 'private-locked-input.json')
  const documentPath = path.join(vaultRoot, 'document-input.md')
  const intakePath = path.join(vaultRoot, 'intake-input.json')

  try {
    await initializeVault({ vaultRoot })
    await writeFile(documentPath, '# Recovery document\n', 'utf8')
    await writeFile(intakePath, '{"answer":"ready"}\n', 'utf8')

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
      assert.equal(missingError.stage, 'filesystem')
      assert.equal(missingError.hint, undefined)
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
      assert.equal(directoryError.stage, 'filesystem')
      assert.equal(directoryError.hint, undefined)
      assert.equal(directoryError.fieldErrors?.[0]?.path, 'file')
      assertDoesNotEcho(directory, [vaultRoot])
    }

    await writeFile(lockedPath, '{}\n', 'utf8')
    await chmod(lockedPath, 0o000)
    try {
      for (const command of ['document', 'intake'] as const) {
        const unreadable = await runCli([
          command,
          'import',
          lockedPath,
          '--vault',
          vaultRoot,
        ])
        const unreadableError = requireError(unreadable)

        assert.equal(unreadableError.code, 'permission_denied')
        assert.equal(unreadableError.retryable, false)
        assert.equal(unreadableError.stage, 'filesystem')
        assert.equal(unreadableError.hint, undefined)
        assert.equal(unreadableError.fieldErrors?.[0]?.path, 'file')
        assertDoesNotEcho(unreadable, [lockedPath, vaultRoot])
      }
    } finally {
      await chmod(lockedPath, 0o600)
    }

    for (const [command, file] of [
      ['document', documentPath],
      ['intake', intakePath],
    ] as const) {
      const imported = await runCli([
        command,
        'import',
        file,
        '--vault',
        vaultRoot,
      ])

      assert.equal(imported.ok, true, JSON.stringify(imported))
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI does not blame readable import sources for vault permission failures', async () => {
  const workRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-vault-permission-recovery-'))
  const vaultRoot = path.join(workRoot, 'vault')
  const vaultMetadataPath = path.join(vaultRoot, 'vault.json')
  const documentPath = path.join(workRoot, 'document-input.md')
  const intakePath = path.join(workRoot, 'intake-input.json')

  try {
    await initializeVault({ vaultRoot })
    await writeFile(documentPath, '# Recovery document\n', 'utf8')
    await writeFile(intakePath, '{"answer":"ready"}\n', 'utf8')
    await chmod(vaultMetadataPath, 0o000)
    try {
      for (const [command, file, extraArgs] of [
        ['document', documentPath, []],
        ['intake', intakePath, ['--occurred-at', '2026-08-24']],
      ] as const) {
        const imported = await runCli([
          command,
          'import',
          file,
          ...extraArgs,
          '--vault',
          vaultRoot,
        ])
        const importError = requireError(imported)

        assert.equal(importError.code, 'permission_denied')
        assert.equal(importError.stage, 'filesystem')
        assert.notEqual(importError.fieldErrors?.some((field) => field.path === 'file'), true)
        assert.doesNotMatch(importError.hint ?? '', /selected file|file argument/u)
        assertDoesNotEcho(imported, [file])
      }
    } finally {
      await chmod(vaultMetadataPath, 0o600)
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI returns a private malformed-JSON error without writes', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-json-recovery-'))
  const assessmentPath = path.join(vaultRoot, 'private-malformed-assessment.json')
  const malformedContents = '{"private-assessment-value":'

  try {
    await initializeVault({ vaultRoot })
    await writeFile(assessmentPath, malformedContents, 'utf8')
    const pathsBeforeImport = (await readdir(vaultRoot, { recursive: true })).sort()

    const imported = await runCli([
      'intake',
      'import',
      assessmentPath,
      '--vault',
      vaultRoot,
    ])
    const importError = requireError(imported)

    assert.equal(importError.code, 'invalid_payload')
    assert.equal(importError.retryable, false)
    assert.equal(importError.stage, 'validation')
    assert.equal(importError.hint, undefined)
    assert.equal(importError.fieldErrors?.[0]?.path, '$')
    assertDoesNotEcho(imported, [malformedContents, assessmentPath, vaultRoot])
    assert.deepEqual(
      (await readdir(vaultRoot, { recursive: true })).sort(),
      pathsBeforeImport,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI returns fields for intake title and lookup failures', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-recovery-'))
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
    assert.equal(projectionError.stage, 'read')
    assert.equal(projectionError.hint, undefined)
    assert.equal(projectionError.fieldErrors?.[0]?.path, 'id')
    assertDoesNotEcho(missingProjection, [privateAssessmentId, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI keeps stored assessment ledger failures terminal and private', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-assessment-ledger-recovery-'))
  const ledgerPath = path.join(vaultRoot, 'ledger', 'assessments', '2026', '2026-08.jsonl')
  const requestedAssessmentId = 'private-requested-assessment-id'
  const storedAssessmentId = 'asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8'
  const privateLedgerValue = 'private-assessment-ledger-value'

  try {
    await initializeVault({ vaultRoot })
    await mkdir(path.dirname(ledgerPath), { recursive: true })
    await writeFile(ledgerPath, `{"${privateLedgerValue}"\n`, 'utf8')

    const malformedLedger = await runCli([
      'intake',
      'project',
      requestedAssessmentId,
      '--vault',
      vaultRoot,
    ])
    const malformedLedgerError = requireError(malformedLedger)

    assert.equal(malformedLedgerError.code, 'assessment_store_invalid')
    assert.equal(malformedLedgerError.retryable, false)
    assert.equal(malformedLedgerError.stage, 'read')
    assert.equal(malformedLedgerError.hint, undefined)
    assertDoesNotEcho(malformedLedger, [
      requestedAssessmentId,
      privateLedgerValue,
      ledgerPath,
      vaultRoot,
    ])

    await writeFile(
      ledgerPath,
      `${JSON.stringify({
        schemaVersion: 'murph.assessment-response.v1',
        id: storedAssessmentId,
        assessmentType: 'intake',
        recordedAt: '2026-08-24T12:00:00.000Z',
        source: 'import',
        rawPath: privateLedgerValue,
        responses: {},
      })}\n`,
      'utf8',
    )

    const invalidStoredRecord = await runCli([
      'intake',
      'project',
      requestedAssessmentId,
      '--vault',
      vaultRoot,
    ])
    const invalidStoredRecordError = requireError(invalidStoredRecord)

    assert.equal(invalidStoredRecordError.code, 'assessment_store_invalid')
    assert.equal(invalidStoredRecordError.retryable, false)
    assert.equal(invalidStoredRecordError.stage, 'read')
    assert.equal(invalidStoredRecordError.hint, undefined)
    assertDoesNotEcho(invalidStoredRecord, [
      requestedAssessmentId,
      storedAssessmentId,
      privateLedgerValue,
      ledgerPath,
      vaultRoot,
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI keeps intake manifest stored-state failures terminal and private', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-manifest-recovery-'))
  const missingAssessmentId = 'asmt_private_missing_manifest_record'

  try {
    await initializeVault({ vaultRoot })

    const missingRecord = await runCli([
      'intake',
      'manifest',
      missingAssessmentId,
      '--vault',
      vaultRoot,
    ])
    const missingRecordError = requireError(missingRecord)

    assert.equal(missingRecordError.code, 'not_found')
    assert.equal(missingRecordError.retryable, false)
    assert.equal(missingRecordError.stage, 'read')
    assert.equal(missingRecordError.hint, undefined)
    assert.equal(missingRecordError.fieldErrors?.[0]?.path, 'id')
    assertDoesNotEcho(missingRecord, [missingAssessmentId, vaultRoot])

    const missingManifestFixture = await importAssessmentManifestFixture(
      vaultRoot,
      'missing-manifest',
    )
    const missingRawDirectory = path.posix.dirname(missingManifestFixture.rawFile)
    const missingRawDirectoryPath = path.join(
      vaultRoot,
      missingRawDirectory,
    )
    await rm(missingRawDirectoryPath, { recursive: true })

    const missingManifest = await runCli([
      'intake',
      'manifest',
      missingManifestFixture.assessmentId,
      '--vault',
      vaultRoot,
    ])
    const missingManifestError = requireError(missingManifest)

    assert.equal(missingManifestError.code, 'manifest_missing')
    assert.equal(missingManifestError.retryable, false)
    assert.equal(missingManifestError.stage, 'read')
    assert.equal(missingManifestError.hint, undefined)
    assertDoesNotEcho(missingManifest, [
      missingManifestFixture.assessmentId,
      missingManifestFixture.manifestFile,
      missingManifestFixture.rawFile,
      missingManifestFixture.sourcePath,
      missingManifestFixture.sourceValue,
      missingRawDirectory,
      missingRawDirectoryPath,
      vaultRoot,
    ])

    const invalidJsonFixture = await importAssessmentManifestFixture(
      vaultRoot,
      'invalid-json',
    )
    const invalidJsonManifestPath = path.join(vaultRoot, invalidJsonFixture.manifestFile)
    const invalidJsonValue = 'private-invalid-json-manifest-value'
    await writeFile(invalidJsonManifestPath, `{"${invalidJsonValue}"`, 'utf8')

    const invalidJson = await runCli([
      'intake',
      'manifest',
      invalidJsonFixture.assessmentId,
      '--vault',
      vaultRoot,
    ])
    const invalidJsonError = requireError(invalidJson)

    assert.equal(invalidJsonError.code, 'manifest_invalid')
    assert.equal(invalidJsonError.retryable, false)
    assert.equal(invalidJsonError.stage, 'read')
    assert.equal(invalidJsonError.hint, undefined)
    assert.equal(invalidJsonError.fieldErrors?.[0]?.path, '$')
    assertDoesNotEcho(invalidJson, [
      invalidJsonFixture.assessmentId,
      invalidJsonFixture.manifestFile,
      invalidJsonFixture.rawFile,
      invalidJsonFixture.sourcePath,
      invalidJsonFixture.sourceValue,
      invalidJsonManifestPath,
      invalidJsonValue,
      vaultRoot,
    ])

    const invalidSchemaFixture = await importAssessmentManifestFixture(
      vaultRoot,
      'invalid-schema',
    )
    const invalidSchemaManifestPath = path.join(
      vaultRoot,
      invalidSchemaFixture.manifestFile,
    )
    const originalManifestContents = await readFile(invalidSchemaManifestPath, 'utf8')
    const originalManifest = JSON.parse(originalManifestContents) as Record<string, unknown>
    const originalOwner = originalManifest.owner
    assert.equal(typeof originalOwner, 'object')
    assert.notEqual(originalOwner, null)
    assert.equal(Array.isArray(originalOwner), false)
    if (!originalOwner || typeof originalOwner !== 'object' || Array.isArray(originalOwner)) {
      throw new Error('expected stored raw-import manifest owner')
    }
    const privateTopLevelKey = 'private_manifest_field_8e4d'
    const privateNestedKey = 'private_owner_field_2a7c'
    const invalidSchemaValue = 'private-invalid-schema-manifest-value'
    const invalidSchemaContents = JSON.stringify({
      ...originalManifest,
      owner: {
        ...originalOwner,
        [privateNestedKey]: invalidSchemaValue,
      },
      [privateTopLevelKey]: {
        [privateNestedKey]: invalidSchemaValue,
      },
    })
    await writeFile(
      invalidSchemaManifestPath,
      invalidSchemaContents,
      'utf8',
    )

    const invalidSchema = await runCli([
      'intake',
      'manifest',
      invalidSchemaFixture.assessmentId,
      '--vault',
      vaultRoot,
    ])
    const invalidSchemaError = requireError(invalidSchema)

    assert.equal(invalidSchemaError.code, 'manifest_invalid')
    assert.equal(invalidSchemaError.retryable, false)
    assert.equal(invalidSchemaError.stage, 'read')
    assert.equal(invalidSchemaError.hint, undefined)
    assert.equal((invalidSchemaError.fieldErrors?.length ?? 0) > 0, true)
    assert.equal(
      invalidSchemaError.fieldErrors?.every((field) => ['$', 'owner'].includes(field.path)),
      true,
    )
    assert.equal(invalidSchemaError.fieldErrors?.some((field) => field.path === '$'), true)
    assert.equal(invalidSchemaError.fieldErrors?.some((field) => field.path === 'owner'), true)
    assert.equal(await readFile(invalidSchemaManifestPath, 'utf8'), invalidSchemaContents)
    assertDoesNotEcho(invalidSchema, [
      invalidSchemaFixture.assessmentId,
      invalidSchemaFixture.manifestFile,
      invalidSchemaFixture.rawFile,
      invalidSchemaFixture.sourcePath,
      invalidSchemaFixture.sourceValue,
      invalidSchemaManifestPath,
      privateTopLevelKey,
      privateNestedKey,
      invalidSchemaValue,
      vaultRoot,
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('built CLI rejects invalid journal ids and streams before mutation', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-journal-recovery-'))
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-recovery-'))
  const missingPackId = 'private-missing-pack-id'
  const missingManifestPackId = 'private-missing-manifest-pack-id'
  const privatePackId = 'private-pack-id'
  const privateManifestValue = 'private-manifest-value'
  const invalidJsonPackId = 'private-invalid-json-pack-id'
  const invalidJsonManifestValue = 'private-export-invalid-json-value'
  const mismatchedManifestPackId = 'private-mismatched-manifest-pack-id'
  const blockingFile = path.join(vaultRoot, 'private-output-blocker')
  const blockedOutput = path.join(blockingFile, 'private-output')

  try {
    await initializeVault({ vaultRoot })
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

    for (const action of ['show', 'materialize', 'prune'] as const) {
      const missing = await runCli([
        'export',
        'pack',
        action,
        missingPackId,
        '--vault',
        vaultRoot,
      ])
      const missingError = requireError(missing)

      assert.equal(missingError.code, 'not_found')
      assert.equal(missingError.retryable, false)
      assert.equal(missingError.stage, 'read')
      assert.equal(missingError.hint, undefined)
      assert.equal(missingError.fieldErrors?.[0]?.path, 'id')
      assertDoesNotEcho(missing, [missingPackId, vaultRoot])
    }

    await mkdir(path.join(vaultRoot, 'exports', 'packs', missingManifestPackId), {
      recursive: true,
    })

    for (const args of [
      ['export', 'pack', 'show', missingManifestPackId, '--vault', vaultRoot],
      ['export', 'pack', 'list', '--vault', vaultRoot],
    ]) {
      const missingManifest = await runCli(args)
      const missingManifestError = requireError(missingManifest)

      assert.equal(missingManifestError.code, 'manifest_missing')
      assert.equal(missingManifestError.retryable, false)
      assert.equal(missingManifestError.stage, 'read')
      assert.equal(missingManifestError.hint, undefined)
      assertDoesNotEcho(missingManifest, [missingManifestPackId, vaultRoot])
    }

    await mkdir(path.join(vaultRoot, 'exports', 'packs', invalidJsonPackId), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'exports', 'packs', invalidJsonPackId, 'manifest.json'),
      `{"${invalidJsonManifestValue}"`,
      'utf8',
    )

    const invalidJsonManifest = await runCli([
      'export',
      'pack',
      'show',
      invalidJsonPackId,
      '--vault',
      vaultRoot,
    ])
    const invalidJsonManifestError = requireError(invalidJsonManifest)

    assert.equal(invalidJsonManifestError.code, 'manifest_invalid')
    assert.equal(invalidJsonManifestError.retryable, false)
    assert.equal(invalidJsonManifestError.stage, 'read')
    assert.equal(invalidJsonManifestError.hint, undefined)
    assert.equal(invalidJsonManifestError.fieldErrors?.[0]?.path, '$')
    assertDoesNotEcho(invalidJsonManifest, [
      invalidJsonPackId,
      invalidJsonManifestValue,
      vaultRoot,
    ])

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
    assert.equal(malformedError.stage, 'read')
    assert.equal(malformedError.hint, undefined)
    assert.equal((malformedError.fieldErrors?.length ?? 0) > 0, true)
    assertDoesNotEcho(malformed, [privatePackId, privateManifestValue, vaultRoot])

    const createdPackId = requireData(created).packId
    const createdManifestPath = path.join(
      vaultRoot,
      'exports',
      'packs',
      createdPackId,
      'manifest.json',
    )
    const createdManifestContents = await readFile(createdManifestPath, 'utf8')
    const createdManifest = JSON.parse(createdManifestContents) as Record<string, unknown>
    await writeFile(
      createdManifestPath,
      JSON.stringify({
        ...createdManifest,
        packId: mismatchedManifestPackId,
      }),
      'utf8',
    )

    const mismatched = await runCli([
      'export',
      'pack',
      'show',
      createdPackId,
      '--vault',
      vaultRoot,
    ])
    const mismatchedError = requireError(mismatched)

    assert.equal(mismatchedError.code, 'manifest_invalid')
    assert.equal(mismatchedError.retryable, false)
    assert.equal(mismatchedError.stage, 'read')
    assert.equal(mismatchedError.hint, undefined)
    assert.equal(mismatchedError.fieldErrors?.[0]?.path, 'packId')
    assertDoesNotEcho(mismatched, [
      createdPackId,
      createdManifestPath,
      mismatchedManifestPackId,
      vaultRoot,
    ])

    await writeFile(createdManifestPath, createdManifestContents, 'utf8')
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
    assert.equal(unwritableError.stage, 'filesystem')
    assert.equal(unwritableError.hint, undefined)
    assert.equal(unwritableError.fieldErrors?.[0]?.path, 'out')
    assertDoesNotEcho(unwritable, [blockingFile, blockedOutput, vaultRoot])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
