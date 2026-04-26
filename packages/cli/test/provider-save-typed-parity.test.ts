import assert from 'node:assert/strict'
import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { initializeVault, parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerProviderCommands } from '../src/commands/provider.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface ProviderSaveResult {
  vault: string
  providerId: string
  lookupId: string
  path: string
  created: boolean
}

const providerId = 'prov_01JNV422Y2M5ZBV64ZP4N1DRB1'

function createProviderCli() {
  const cli = Cli.create('vault-cli', {
    description: 'provider typed save parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerProviderCommands(cli, services)

  return cli
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode, null)
  return output.join('').trim()
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, '--schema', '--format', 'json']),
  ) as CommandSchemaEnvelope
}

test('provider save schema exposes every raw provider payload field as typed input', async () => {
  const cli = createProviderCli()
  const saveSchema = await readCommandSchema(cli, ['provider', 'save'])
  const importJsonSchema = await readCommandSchema(cli, ['provider', 'import-json'])

  assert.deepEqual(saveSchema.args.required, ['title'])
  assert.equal('title' in saveSchema.args.properties, true)
  assert.equal('input' in saveSchema.options.properties, false)
  assert.equal(saveSchema.options.required?.includes('input') ?? false, false)

  for (const field of [
    'id',
    'slug',
    'status',
    'specialty',
    'organization',
    'location',
    'website',
    'phone',
    'note',
    'alias',
    'body',
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field)
  }

  assert.equal('input' in importJsonSchema.options.properties, true)
})

test('provider save creates and updates provider records from typed fields', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-provider-save-parity-',
  )

  try {
    const cli = createProviderCli()
    await initializeVault({ vaultRoot })

    const createResult = await runInProcessJsonCli<ProviderSaveResult>(cli, [
      'provider',
      'save',
      'Labcorp West',
      '--id',
      providerId,
      '--slug',
      'labcorp-west',
      '--status',
      'active',
      '--specialty',
      'lab',
      '--organization',
      'Labcorp',
      '--location',
      'Research Triangle Park',
      '--website',
      'https://labcorp.example.test',
      '--phone',
      '555-0101',
      '--note',
      'Primary lab partner.',
      '--alias',
      'Laboratory Corporation',
      '--alias',
      'Labcorp RTP',
      '--body',
      '# Labcorp West\n\nTyped provider body.\n',
      '--vault',
      vaultRoot,
    ])

    assert.equal(createResult.exitCode, null)
    const created = requireData(createResult.envelope)
    assert.equal(created.providerId, providerId)
    assert.equal(created.lookupId, providerId)
    assert.equal(created.path, 'bank/providers/labcorp-west.md')
    assert.equal(created.created, true)

    const createdMarkdown = await readFile(path.join(vaultRoot, created.path), 'utf8')
    const createdDocument = parseFrontmatterDocument(createdMarkdown)
    assert.equal(createdDocument.attributes.providerId, providerId)
    assert.equal(createdDocument.attributes.slug, 'labcorp-west')
    assert.equal(createdDocument.attributes.title, 'Labcorp West')
    assert.equal(createdDocument.attributes.status, 'active')
    assert.equal(createdDocument.attributes.specialty, 'lab')
    assert.equal(createdDocument.attributes.organization, 'Labcorp')
    assert.equal(createdDocument.attributes.location, 'Research Triangle Park')
    assert.equal(createdDocument.attributes.website, 'https://labcorp.example.test')
    assert.equal(createdDocument.attributes.phone, '555-0101')
    assert.equal(createdDocument.attributes.note, 'Primary lab partner.')
    assert.deepEqual(createdDocument.attributes.aliases, [
      'Laboratory Corporation',
      'Labcorp RTP',
    ])
    assert.match(createdDocument.body, /Typed provider body/u)

    const updateResult = await runInProcessJsonCli<ProviderSaveResult>(cli, [
      'provider',
      'save',
      'Labcorp North',
      '--id',
      providerId,
      '--slug',
      'labcorp-north',
      '--status',
      'inactive',
      '--specialty',
      'diagnostics',
      '--organization',
      'Labcorp North',
      '--location',
      'North clinic',
      '--website',
      'https://labcorp-north.example.test',
      '--phone',
      '555-0102',
      '--note',
      'Updated provider note.',
      '--alias',
      'Labcorp North Clinic',
      '--body',
      '# Labcorp North\n\nUpdated typed body.\n',
      '--vault',
      vaultRoot,
    ])

    assert.equal(updateResult.exitCode, null)
    const updated = requireData(updateResult.envelope)
    assert.equal(updated.providerId, providerId)
    assert.equal(updated.path, 'bank/providers/labcorp-north.md')
    assert.equal(updated.created, false)
    await assert.rejects(() => access(path.join(vaultRoot, created.path)))

    const updatedMarkdown = await readFile(path.join(vaultRoot, updated.path), 'utf8')
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown)
    assert.equal(updatedDocument.attributes.slug, 'labcorp-north')
    assert.equal(updatedDocument.attributes.title, 'Labcorp North')
    assert.equal(updatedDocument.attributes.status, 'inactive')
    assert.equal(updatedDocument.attributes.specialty, 'diagnostics')
    assert.equal(updatedDocument.attributes.organization, 'Labcorp North')
    assert.equal(updatedDocument.attributes.location, 'North clinic')
    assert.equal(updatedDocument.attributes.website, 'https://labcorp-north.example.test')
    assert.equal(updatedDocument.attributes.phone, '555-0102')
    assert.equal(updatedDocument.attributes.note, 'Updated provider note.')
    assert.deepEqual(updatedDocument.attributes.aliases, ['Labcorp North Clinic'])
    assert.match(updatedDocument.body, /Updated typed body/u)
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('provider save rejects malformed repeatable aliases before writing', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-provider-save-invalid-',
  )

  try {
    const cli = createProviderCli()
    await initializeVault({ vaultRoot })

    const result = await runInProcessJsonCli<ProviderSaveResult>(cli, [
      'provider',
      'save',
      'Labcorp',
      '--slug',
      'labcorp',
      '--alias',
      'lab,corp',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.exitCode, 1)
    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, 'invalid_option')
      assert.match(result.envelope.error.message ?? '', /--alias/u)
    }
    await assert.rejects(() =>
      access(path.join(vaultRoot, 'bank/providers/labcorp.md')),
    )
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
