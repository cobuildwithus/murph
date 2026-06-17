import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { registerEventCommands } from '../src/commands/event.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

interface EventUpsertEnvelope {
  eventId: string
  ledgerFile: string
}

interface EventShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    data: Record<string, unknown>
  }
}

interface EventListEnvelope {
  filters: {
    kind: string | null
    tag: string[]
  }
  count: number
  items: Array<{
    id: string
    kind: string
    data: Record<string, unknown>
  }>
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'clinical assertion event test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerEventCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

test.sequential('clinical assertion events write and read through generic event import-json', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-clinical-assertion-'))
  const payloadPath = path.join(vaultRoot, 'clinical-assertion.json')

  try {
    const initResult = await runSliceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)

    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: 'clinical_assertion',
        occurredAt: '2026-03-12T08:15:00.000Z',
        title: 'No known drug allergies',
        source: 'import',
        assertion: 'no_known_drug_allergies',
        assertedOn: '2026-03-10',
        sourceLabel: 'Uploaded visit summary',
        tags: ['clinical-assertion', 'allergy-history'],
      }),
      'utf8',
    )

    const upsertResult = await runSliceCli<EventUpsertEnvelope>([
      'event',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
    ])

    assert.equal(upsertResult.ok, true, JSON.stringify(upsertResult))
    assert.equal(upsertResult.meta?.command, 'event import-json')
    assert.match(requireData(upsertResult).eventId, /^evt_/u)
    assert.match(requireData(upsertResult).ledgerFile, /^ledger\/events\//u)

    const showResult = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(upsertResult).eventId,
      '--vault',
      vaultRoot,
    ])
    assert.equal(showResult.ok, true)
    assert.equal(requireData(showResult).entity.kind, 'clinical_assertion')
    assert.equal(requireData(showResult).entity.title, 'No known drug allergies')
    assert.equal(requireData(showResult).entity.data.assertion, 'no_known_drug_allergies')
    assert.equal(requireData(showResult).entity.data.assertedOn, '2026-03-10')
    assert.equal(requireData(showResult).entity.data.sourceLabel, 'Uploaded visit summary')

    const listResult = await runSliceCli<EventListEnvelope>([
      'event',
      'list',
      '--kind',
      'clinical_assertion',
      '--tag',
      'allergy-history',
      '--vault',
      vaultRoot,
    ])
    assert.equal(listResult.ok, true)
    assert.equal(requireData(listResult).filters.kind, 'clinical_assertion')
    assert.deepEqual(requireData(listResult).filters.tag, ['allergy-history'])
    assert.equal(requireData(listResult).count, 1)
    assert.equal(requireData(listResult).items[0]?.kind, 'clinical_assertion')
    assert.equal(requireData(listResult).items[0]?.data.assertion, 'no_known_drug_allergies')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
