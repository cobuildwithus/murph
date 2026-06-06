import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { parseFrontmatterDocument } from '@murphai/core'
import { SUPPLEMENT_INGREDIENTS_MAX_ITEMS } from '@murphai/contracts'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerSupplementCommands } from '../src/commands/supplement.js'
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
  output?: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface SavedEntitySnapshot {
  id: string
  kind: string
  title: string | null
  occurredAt: string | null
  path: string | null
  data: Record<string, unknown>
  links: Array<Record<string, unknown>>
  markdown?: never
}

interface SupplementSaveResult {
  vault: string
  regimenId: string
  lookupId: string
  path?: string
  created: boolean
  entity: SavedEntitySnapshot
}

function assertCompactSavedEntity(entity: SavedEntitySnapshot) {
  assert.equal('markdown' in entity, false)
  for (const field of ['body', 'markdown', 'path', 'relativePath']) {
    assert.equal(field in entity.data, false, field)
  }
}

function savedEntityLinkIds(entity: SavedEntitySnapshot): string[] {
  return entity.links.map((link) => String(link.id)).sort()
}

function createSupplementCli() {
  const cli = Cli.create('vault-cli', {
    description: 'supplement typed save parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerSupplementCommands(cli, services)

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

function requireSavedPath(result: SupplementSaveResult): string {
  if (!result.path) {
    throw new Error('Expected supplement save result to include a relative path.')
  }

  return result.path
}

test('supplement save schema exposes typed top-level dose fields and repeatable ingredients', async () => {
  const schema = await readCommandSchema(createSupplementCli(), ['supplement', 'save'])

  assert.deepEqual(schema.args.required, ['title'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal(schema.options.required?.includes('input') ?? false, false)
  assert.equal(schema.output?.required?.includes('entity') ?? false, true)
  assert.equal(schema.output ? 'entity' in schema.output.properties : false, true)

  for (const field of [
    'group',
    'substance',
    'dose',
    'doseUnit',
    'ingredient',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }

  for (const staleField of [
    'compound',
    'ingredientLabel',
    'amount',
    'unit',
    'ingredientActive',
    'note',
  ]) {
    assert.equal(staleField in schema.options.properties, false, staleField)
  }
})

test('supplement save persists top-level dose fields and repeated typed ingredients', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-parity-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const saveResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Magnesium glycinate',
      '--slug',
      'magnesium-glycinate',
      '--status',
      'active',
      '--started-on',
      '2026-04-01',
      '--schedule',
      'before bed',
      '--group',
      'sleep/supplements',
      '--substance',
      'Magnesium glycinate',
      '--dose',
      '200',
      '--dose-unit',
      'mg',
      '--brand',
      'Test Brand',
      '--manufacturer',
      'Test Maker',
      '--serving-size',
      '2 capsules',
      '--ingredient',
      '{"compound":"Magnesium","label":"Magnesium glycinate","amount":200,"unit":"mg","active":false}',
      '--ingredient',
      '{"compound":"Glycine","amount":1800,"unit":"mg","note":"Approximate remainder of 2 capsule serving."}',
      '--related-goal-id',
      'goal_01JNY0B2W4VG5C2A0G9S8M7R6R',
      '--related-condition-id',
      'cond_01JNY0B2W4VG5C2A0G9S8M7R6S',
      '--related-regimen-id',
      'reg_01JNY0B2W4VG5C2A0G9S8M7R6T',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, null)
    const saved = requireData(saveResult.envelope)
    assert.equal(saved.vault, vaultRoot)
    assert.equal(saved.created, true)
    assert.equal(saved.lookupId, saved.regimenId)
    const relativePath = requireSavedPath(saved)
    assert.match(relativePath, /^bank\/regimens\/sleep\/supplements\/.+\.md$/u)
    assert.equal(saved.entity.id, saved.regimenId)
    assert.equal(saved.entity.kind, 'supplement')
    assert.equal(saved.entity.title, 'Magnesium glycinate')
    assert.equal(saved.entity.occurredAt, null)
    assert.equal(saved.entity.path, relativePath)
    assertCompactSavedEntity(saved.entity)
    assert.equal(saved.entity.data.brand, 'Test Brand')
    assert.equal(saved.entity.data.manufacturer, 'Test Maker')
    assert.equal(saved.entity.data.schedule, 'before bed')
    assert.equal(saved.entity.data.dose, 200)
    assert.equal(saved.entity.data.unit, 'mg')
    assert.equal(saved.entity.data.servingSize, '2 capsules')
    assert.deepEqual(saved.entity.data.relatedGoalIds, [
      'goal_01JNY0B2W4VG5C2A0G9S8M7R6R',
    ])
    assert.deepEqual(saved.entity.data.relatedConditionIds, [
      'cond_01JNY0B2W4VG5C2A0G9S8M7R6S',
    ])
    assert.deepEqual(saved.entity.data.relatedRegimenIds, [
      'reg_01JNY0B2W4VG5C2A0G9S8M7R6T',
    ])
    assert.deepEqual(savedEntityLinkIds(saved.entity), [
      'cond_01JNY0B2W4VG5C2A0G9S8M7R6S',
      'goal_01JNY0B2W4VG5C2A0G9S8M7R6R',
      'reg_01JNY0B2W4VG5C2A0G9S8M7R6T',
    ])
    assert.deepEqual(saved.entity.data.ingredients, [
      {
        compound: 'Magnesium',
        label: 'Magnesium glycinate',
        amount: 200,
        unit: 'mg',
        active: false,
      },
      {
        compound: 'Glycine',
        amount: 1800,
        unit: 'mg',
        note: 'Approximate remainder of 2 capsule serving.',
      },
    ])

    const markdown = await readFile(path.join(vaultRoot, relativePath), 'utf8')
    const document = parseFrontmatterDocument(markdown)
    assert.equal(document.attributes.title, 'Magnesium glycinate')
    assert.equal(document.attributes.kind, 'supplement')
    assert.equal(document.attributes.status, 'active')
    assert.equal(document.attributes.startedOn, '2026-04-01')
    assert.equal(document.attributes.schedule, 'before bed')
    assert.equal(document.attributes.substance, 'Magnesium glycinate')
    assert.equal(document.attributes.dose, 200)
    assert.equal(document.attributes.unit, 'mg')
    assert.equal(document.attributes.brand, 'Test Brand')
    assert.equal(document.attributes.manufacturer, 'Test Maker')
    assert.equal(document.attributes.servingSize, '2 capsules')
    assert.deepEqual(document.attributes.ingredients, [
      {
        compound: 'Magnesium',
        label: 'Magnesium glycinate',
        amount: 200,
        unit: 'mg',
        active: false,
      },
      {
        compound: 'Glycine',
        amount: 1800,
        unit: 'mg',
        note: 'Approximate remainder of 2 capsule serving.',
      },
    ])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('supplement save update returns compact entity and preserves omitted product fields', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-preserve-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const createResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Magnesium glycinate',
      '--slug',
      'magnesium-glycinate',
      '--status',
      'active',
      '--started-on',
      '2026-04-01',
      '--schedule',
      'before bed',
      '--brand',
      'Test Brand',
      '--manufacturer',
      'Test Maker',
      '--serving-size',
      '2 capsules',
      '--ingredient',
      '{"compound":"Magnesium","label":"Magnesium glycinate","amount":200,"unit":"mg"}',
      '--vault',
      vaultRoot,
    ])
    assert.equal(createResult.exitCode, null)
    const created = requireData(createResult.envelope)

    const updateResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Magnesium glycinate',
      '--id',
      created.regimenId,
      '--schedule',
      'after lunch',
      '--dose',
      '300',
      '--dose-unit',
      'mg',
      '--vault',
      vaultRoot,
    ])

    assert.equal(updateResult.exitCode, null)
    const updated = requireData(updateResult.envelope)
    assert.equal(updated.vault, vaultRoot)
    assert.equal(updated.created, false)
    assert.equal(updated.lookupId, created.regimenId)
    assert.equal(updated.entity.id, created.regimenId)
    assert.equal(updated.entity.kind, 'supplement')
    assert.equal(updated.entity.path, requireSavedPath(updated))
    assertCompactSavedEntity(updated.entity)
    assert.equal(updated.entity.data.brand, 'Test Brand')
    assert.equal(updated.entity.data.manufacturer, 'Test Maker')
    assert.equal(updated.entity.data.servingSize, '2 capsules')
    assert.equal(updated.entity.data.schedule, 'after lunch')
    assert.equal(updated.entity.data.dose, 300)
    assert.equal(updated.entity.data.unit, 'mg')
    assert.deepEqual(updated.entity.data.ingredients, [
      {
        compound: 'Magnesium',
        label: 'Magnesium glycinate',
        amount: 200,
        unit: 'mg',
      },
    ])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('supplement save rejects ingredient array payloads', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-array-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const saveResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Vitamin D3',
      '--ingredient',
      '[{"compound":"Vitamin D3","amount":50,"unit":"mcg"}]',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, 1)
    assert.equal(saveResult.envelope.ok, false)
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, 'invalid_option')
      assert.match(saveResult.envelope.error.message ?? '', /one object per ingredient/u)
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('supplement save rejects malformed and schema-invalid ingredient objects without echoing payload contents', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-invalid-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const malformed = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Vitamin D3',
      '--ingredient',
      '{"compound":"Vitamin D3"',
      '--vault',
      vaultRoot,
    ])
    assert.equal(malformed.exitCode, 1)
    assert.equal(malformed.envelope.ok, false)
    if (!malformed.envelope.ok) {
      const serialized = JSON.stringify(malformed.envelope)
      assert.equal(serialized.includes('Vitamin D3'), false)
      assert.match(malformed.envelope.error.message ?? '', /valid JSON object/u)
    }

    const schemaInvalid = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Vitamin D3',
      '--ingredient',
      '{"compound":"Do Not Echo Label","amount":-1}',
      '--vault',
      vaultRoot,
    ])
    assert.equal(schemaInvalid.exitCode, 1)
    assert.equal(schemaInvalid.envelope.ok, false)
    if (!schemaInvalid.envelope.ok) {
      const serialized = JSON.stringify(schemaInvalid.envelope)
      assert.equal(serialized.includes('Do Not Echo Label'), false)
      assert.match(schemaInvalid.envelope.error.message ?? '', /failed validation/u)
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('supplement save rejects more than the canonical ingredient limit', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-limit-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const ingredientArgs = Array.from(
      { length: SUPPLEMENT_INGREDIENTS_MAX_ITEMS + 1 },
      (_, index) => [
        '--ingredient',
        `{"compound":"Ingredient ${index + 1}","amount":${index + 1},"unit":"mg"}`,
      ],
    ).flat()

    const saveResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Large panel',
      ...ingredientArgs,
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, 1)
    assert.equal(saveResult.envelope.ok, false)
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, 'VALIDATION_ERROR')
      assert.match(saveResult.envelope.error.message ?? '', /<=64 items/u)
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
