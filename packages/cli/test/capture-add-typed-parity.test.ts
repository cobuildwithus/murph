import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  captureCommandDescriptions,
  registerCaptureCommands,
} from '../src/commands/capture.js'
import {
  vaultCliCommandDescriptors,
  type VaultCliCommandDescriptor,
} from '../src/vault-cli-command-manifest.js'
import { registerVaultCommands } from '../src/commands/vault.js'
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

interface CaptureAddResult {
  addedCount: number
  captures: Array<{
    occurredAt: string
    title: string
    label: string | null
    bodySite: string | null
    collection: string | null
    tags: string[]
    media: Array<{
      kind: string
      mediaType?: string
    }>
    note: string | null
  }>
}

interface CaptureShowResult {
  entity: {
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
    links: Array<{ id: string }>
  }
}

function createCaptureCli() {
  const cli = Cli.create('vault-cli', {
    description: 'capture add typed parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerCaptureCommands(cli, services)

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

async function initVault(cli: Cli.Cli, vaultRoot: string) {
  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)
}

function comparableCaptureShape(input: {
  addResult: CaptureAddResult
  showResult: CaptureShowResult
}) {
  const capture = input.addResult.captures[0]
  if (!capture) {
    throw new Error('Expected one capture result.')
  }

  const data = input.showResult.entity.data
  return {
    occurredAt: capture.occurredAt,
    title: capture.title,
    label: capture.label,
    bodySite: capture.bodySite,
    collection: capture.collection,
    tags: capture.tags,
    note: capture.note,
    media: capture.media.map((entry) => ({
      kind: entry.kind,
      mediaType: entry.mediaType ?? null,
    })),
    shown: {
      occurredAt: input.showResult.entity.occurredAt,
      title: input.showResult.entity.title,
      source: data.source,
      note: data.note,
      tags: data.tags,
      timeZone: data.timeZone,
      links: input.showResult.entity.links.map((link) => link.id),
    },
  }
}

test('capture add schema exposes typed single-capture fields without raw input fallback', async () => {
  const schema = await readCommandSchema(createCaptureCli(), ['capture', 'add'])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, false)

  for (const field of [
    'media',
    'label',
    'bodySite',
    'collection',
    'tag',
    'relatedId',
    'note',
    'title',
    'occurredAt',
    'source',
    'timeZone',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('capture add and import-json contract hints steer agents to vault-cli batch instead of capture import-json', () => {
  assert.match(
    captureCommandDescriptions.addHint,
    /vault-cli batch --format json --command '\[\.\.\.\]'/u,
  )
  assert.equal(
    captureCommandDescriptions.addHint.includes('capture import-json'),
    false,
  )

  const descriptors = vaultCliCommandDescriptors as readonly VaultCliCommandDescriptor[]
  const captureDescriptor = descriptors.find(
    (descriptor) => descriptor.id === 'capture',
  )
  assert.ok(captureDescriptor, 'capture command descriptor present')
  const importJsonLeaf = captureDescriptor.leafCommands?.find(
    (leaf) => leaf.path.join(' ') === 'capture import-json',
  )
  assert.ok(importJsonLeaf, 'capture import-json leaf present')
  assert.match(
    importJsonLeaf.hint ?? '',
    /Operator-only structured batch importer/u,
  )
  assert.match(
    importJsonLeaf.hint ?? '',
    /vault-cli batch --format json --command '\[\.\.\.\]'/u,
  )
})

test('capture import-json schema exposes the batch payload escape hatch', async () => {
  const schema = await readCommandSchema(createCaptureCli(), ['capture', 'import-json'])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, true)
  assert.equal(schema.options.required?.includes('input') ?? false, true)

  for (const field of [
    'media',
    'label',
    'bodySite',
    'collection',
    'tag',
    'relatedId',
    'note',
    'title',
    'occurredAt',
    'source',
    'timeZone',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('capture add typed flags persist the same single-capture shape as JSON input', async () => {
  const typedContext = await createTempVaultContext('murph-capture-typed-')
  const jsonContext = await createTempVaultContext('murph-capture-json-')

  try {
    const typedCli = createCaptureCli()
    const jsonCli = createCaptureCli()
    await initVault(typedCli, typedContext.vaultRoot)
    await initVault(jsonCli, jsonContext.vaultRoot)

    const typedMediaPath = path.join(typedContext.parentRoot, 'left-forearm.jpg')
    const jsonMediaPath = path.join(jsonContext.parentRoot, 'left-forearm.jpg')
    await writeFile(typedMediaPath, 'typed capture bytes', 'utf8')
    await writeFile(jsonMediaPath, 'json capture bytes', 'utf8')

    const typedAdd = await runInProcessJsonCli<CaptureAddResult>(typedCli, [
      'capture',
      'add',
      '--vault',
      typedContext.vaultRoot,
      '--media',
      typedMediaPath,
      '--label',
      'mole left forearm 1',
      '--body-site',
      'Left forearm, dorsal side',
      '--collection',
      'skin check baseline',
      '--tag',
      'mole',
      '--tag',
      'dermatology',
      '--related-id',
      'goal_01JNV41B483QH9GQ1Y08D7RMTA',
      '--note',
      'Baseline photo before dermatology appointment.',
      '--title',
      'Left forearm baseline',
      '--occurred-at',
      '2026-04-21T09:00:00.000Z',
      '--source',
      'import',
      '--time-zone',
      'America/Los_Angeles',
    ])
    assert.equal(typedAdd.exitCode, null)

    const jsonInputPath = path.join(jsonContext.parentRoot, 'capture.json')
    await writeFile(
      jsonInputPath,
      JSON.stringify({
        media: [jsonMediaPath],
        label: 'mole left forearm 1',
        bodySite: 'Left forearm, dorsal side',
        collection: 'skin check baseline',
        tags: ['mole', 'dermatology'],
        relatedIds: ['goal_01JNV41B483QH9GQ1Y08D7RMTA'],
        note: 'Baseline photo before dermatology appointment.',
        title: 'Left forearm baseline',
        occurredAt: '2026-04-21T09:00:00.000Z',
        source: 'import',
        timeZone: 'America/Los_Angeles',
      }),
      'utf8',
    )

    const jsonAdd = await runInProcessJsonCli<CaptureAddResult>(jsonCli, [
      'capture',
      'import-json',
      '--vault',
      jsonContext.vaultRoot,
      '--input',
      `@${jsonInputPath}`,
    ])
    assert.equal(jsonAdd.exitCode, null)

    const typedShow = await runInProcessJsonCli<CaptureShowResult>(typedCli, [
      'capture',
      'show',
      'mole-left-forearm-1',
      '--vault',
      typedContext.vaultRoot,
    ])
    const jsonShow = await runInProcessJsonCli<CaptureShowResult>(jsonCli, [
      'capture',
      'show',
      'mole-left-forearm-1',
      '--vault',
      jsonContext.vaultRoot,
    ])

    assert.deepEqual(
      comparableCaptureShape({
        addResult: requireData(typedAdd.envelope),
        showResult: requireData(typedShow.envelope),
      }),
      comparableCaptureShape({
        addResult: requireData(jsonAdd.envelope),
        showResult: requireData(jsonShow.envelope),
      }),
    )
  } finally {
    await Promise.all([
      rm(typedContext.parentRoot, { force: true, recursive: true }),
      rm(jsonContext.parentRoot, { force: true, recursive: true }),
    ])
  }
})

test('capture import-json keeps raw input available for multi-capture batches', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'murph-capture-batch-'))
  const vaultRoot = path.join(parentRoot, 'vault')

  try {
    await mkdir(vaultRoot, { recursive: true })
    const cli = createCaptureCli()
    await initVault(cli, vaultRoot)

    const firstMediaPath = path.join(parentRoot, 'left-forearm.jpg')
    const secondMediaPath = path.join(parentRoot, 'right-shoulder.jpg')
    await writeFile(firstMediaPath, 'left forearm bytes', 'utf8')
    await writeFile(secondMediaPath, 'right shoulder bytes', 'utf8')

    const inputPath = path.join(parentRoot, 'captures.json')
    await writeFile(
      inputPath,
      JSON.stringify({
        occurredAt: '2026-04-21T09:00:00.000Z',
        collection: 'skin check batch',
        captures: [
          {
            media: [firstMediaPath],
            label: 'mole-left-forearm-1',
          },
          {
            media: [secondMediaPath],
            label: 'mole-right-shoulder-1',
            bodySite: 'Right shoulder',
          },
        ],
      }),
      'utf8',
    )

    const result = await runInProcessJsonCli<CaptureAddResult>(cli, [
      'capture',
      'import-json',
      '--vault',
      vaultRoot,
      '--input',
      `@${inputPath}`,
    ])

    assert.equal(result.exitCode, null)
    const data = requireData(result.envelope)
    assert.equal(data.addedCount, 2)
    assert.deepEqual(
      data.captures.map((capture) => capture.label),
      ['mole-left-forearm-1', 'mole-right-shoulder-1'],
    )
    assert.deepEqual(
      data.captures.map((capture) => capture.collection),
      ['skin-check-batch', 'skin-check-batch'],
    )
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('capture add rejects incomplete typed input before writing a capture', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-capture-missing-media-',
  )

  try {
    const cli = createCaptureCli()
    await initVault(cli, vaultRoot)

    const result = await runInProcessJsonCli<CaptureAddResult>(cli, [
      'capture',
      'add',
      '--vault',
      vaultRoot,
      '--label',
      'mole-left-forearm-1',
    ])

    assert.equal(result.exitCode, 1)
    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, 'invalid_option')
      assert.match(result.envelope.error.message ?? '', /requires at least one media path/u)
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})
