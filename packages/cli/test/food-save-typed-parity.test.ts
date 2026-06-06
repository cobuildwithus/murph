import assert from 'node:assert/strict'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test, vi } from 'vitest'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>(
    'node:fs/promises',
  )

  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  }
})

import {
  buildFoodSavePayload,
  registerFoodCommands,
} from '../src/commands/food.js'
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

interface FoodSaveResult {
  vault: string
  foodId: string
  lookupId: string
  path: string
  created: boolean
}

function createFoodCli() {
  const cli = Cli.create('vault-cli', {
    description: 'food typed save parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerFoodCommands(cli, services)

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

function optionDescription(schema: CommandSchemaEnvelope, optionName: string): string {
  const property = schema.options.properties[optionName]
  assert.equal(typeof property, 'object', `missing ${optionName}`)
  assert.notEqual(property, null, `missing ${optionName}`)

  const description = (property as { description?: unknown }).description
  if (typeof description !== 'string') {
    assert.fail(`missing ${optionName} description`)
  }
  return description
}

test('food save schema exposes typed parity fields without requiring raw input', async () => {
  const schema = await readCommandSchema(createFoodCli(), ['food', 'save'])

  assert.deepEqual(schema.args.required, ['title'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal(schema.options.required?.includes('input') ?? false, false)

  for (const field of [
    'id',
    'slug',
    'status',
    'summary',
    'kind',
    'brand',
    'vendor',
    'location',
    'serving',
    'calories',
    'proteinGrams',
    'carbsGrams',
    'fatGrams',
    'fiberGrams',
    'nutritionSource',
    'nutritionConfidence',
    'nutritionSourceDetail',
    'alias',
    'ingredient',
    'tag',
    'note',
    'attachedRegimenId',
    'linkRelatedRegimenId',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('food save guidance teaches quoted repeatable aliases and servings', async () => {
  const cli = createFoodCli()
  const schema = await readCommandSchema(cli, ['food', 'save'])
  const help = await runRawInProcessCli(cli, ['food', 'save', '--help'])
  const llms = await runRawInProcessCli(cli, ['food', 'save', '--llms-full'])

  assert.match(optionDescription(schema, 'alias'), /shell-quote aliases with spaces/u)
  assert.match(optionDescription(schema, 'alias'), /Do not comma-delimit multiple aliases/u)
  assert.match(optionDescription(schema, 'ingredient'), /shell-quote ingredients with spaces/u)

  for (const rendered of [help, llms]) {
    assert.match(rendered, /food save 'Regular Acai Bowl'/u)
    assert.match(rendered, /--alias 'usual acai bowl'/u)
    assert.match(rendered, /--serving '1 bowl'/u)
  }
})

test('food save payload builder maps every raw food import-json payload field', () => {
  const payload = buildFoodSavePayload({
    alias: ['usual acai bowl'],
    attachedRegimenId: ['reg_01234567890123456789012345'],
    brand: 'House Brand',
    calories: 540,
    carbsGrams: 68,
    fatGrams: 24,
    fiberGrams: 11,
    foodId: 'food_01234567890123456789012345',
    ingredient: ['acai base', 'banana'],
    kind: 'acai bowl',
    linkRelatedRegimenId: ['reg_01234567890123456789012346'],
    location: 'Test Kitchen',
    note: 'Typical order includes extra granola.',
    nutritionConfidence: 'medium',
    nutritionSource: 'estimated',
    nutritionSourceDetail: 'Menu board plus saved toppings.',
    proteinGrams: 11,
    serving: '1 bowl',
    slug: 'regular-acai-bowl',
    status: 'active',
    summary: 'The usual acai bowl order.',
    tag: ['breakfast', 'favorite'],
    title: 'Regular Acai Bowl',
    vendor: 'Neighborhood Acai Bar',
  })

  assert.deepEqual(Object.keys(payload).sort(), [
    'aliases',
    'attachedRegimenIds',
    'brand',
    'foodId',
    'ingredients',
    'kind',
    'links',
    'location',
    'note',
    'nutrition',
    'serving',
    'slug',
    'status',
    'summary',
    'tags',
    'title',
    'vendor',
  ].sort())
  assert.deepEqual(payload.nutrition, {
    perServing: {
      calories: 540,
      proteinGrams: 11,
      carbsGrams: 68,
      fatGrams: 24,
      fiberGrams: 11,
    },
    provenance: {
      source: 'estimated',
      confidence: 'medium',
      sourceDetail: 'Menu board plus saved toppings.',
    },
  })
  assert.deepEqual(payload.attachedRegimenIds, [
    'reg_01234567890123456789012345',
    'reg_01234567890123456789012346',
  ])
  assert.deepEqual(payload.links, [
    {
      type: 'related_regimen',
      targetId: 'reg_01234567890123456789012346',
    },
  ])
})

test('food save payload builder omits status when the caller omits status', () => {
  const payload = buildFoodSavePayload({
    foodId: 'food_01234567890123456789012345',
    summary: 'Updated usual order.',
    title: 'Regular Acai Bowl',
  })

  assert.equal('status' in payload, false)
})

test('food save writes its temporary payload file with 0o600 permissions', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-food-save-mode-',
  )

  try {
    vi.mocked(writeFile).mockClear()

    const cli = createFoodCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)

    vi.mocked(writeFile).mockClear()

    const saveResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Regular Acai Bowl',
      '--slug',
      'regular-acai-bowl',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, null)
    const saved = requireData(saveResult.envelope)
    const markdown = await readFile(path.join(vaultRoot, saved.path), 'utf8')
    const document = parseFrontmatterDocument(markdown)
    assert.equal(document.attributes.status, 'active')

    const payloadWriteCall = vi.mocked(writeFile).mock.calls.find(
      ([filePath]) =>
        typeof filePath === 'string' &&
        filePath.includes('murph-food-save-') &&
        filePath.endsWith('payload.json'),
    )
    assert.ok(payloadWriteCall)

    const options = payloadWriteCall[2]
    assert.ok(typeof options === 'object' && options !== null)
    assert.equal(Reflect.get(options, 'mode'), 0o600)
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('food save persists typed fields and can update an existing food id', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-food-save-parity-',
  )

  try {
    const cli = createFoodCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const saveResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Regular Acai Bowl',
      '--slug',
      'regular-acai-bowl',
      '--status',
      'active',
      '--summary',
      'The usual acai bowl order.',
      '--kind',
      'acai bowl',
      '--brand',
      'House Brand',
      '--vendor',
      'Neighborhood Acai Bar',
      '--location',
      'Test Kitchen',
      '--serving',
      '1 bowl',
      '--calories',
      '540',
      '--protein-grams',
      '11',
      '--carbs-grams',
      '68',
      '--fat-grams',
      '24',
      '--fiber-grams',
      '11',
      '--nutrition-source',
      'estimated',
      '--nutrition-confidence',
      'medium',
      '--nutrition-source-detail',
      'Menu board plus saved toppings.',
      '--alias',
      'usual acai bowl',
      '--ingredient',
      'acai base',
      '--ingredient',
      'banana',
      '--tag',
      'breakfast',
      '--tag',
      'favorite',
      '--note',
      'Typical order includes extra granola.',
      '--attached-regimen-id',
      'reg_01234567890123456789012345',
      '--link-related-regimen-id',
      'reg_01234567890123456789012346',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, null)
    const saved = requireData(saveResult.envelope)
    assert.equal(saved.created, true)
    assert.match(saved.path, /^bank\/foods\/regular-acai-bowl\.md$/u)

    const markdown = await readFile(path.join(vaultRoot, saved.path), 'utf8')
    const document = parseFrontmatterDocument(markdown)
    assert.equal(document.attributes.title, 'Regular Acai Bowl')
    assert.equal(document.attributes.status, 'active')
    assert.equal(document.attributes.summary, 'The usual acai bowl order.')
    assert.equal(document.attributes.kind, 'acai bowl')
    assert.equal(document.attributes.brand, 'House Brand')
    assert.equal(document.attributes.vendor, 'Neighborhood Acai Bar')
    assert.equal(document.attributes.location, 'Test Kitchen')
    assert.equal(document.attributes.serving, '1 bowl')
    assert.deepEqual(document.attributes.aliases, ['usual acai bowl'])
    assert.deepEqual(document.attributes.ingredients, ['acai base', 'banana'])
    assert.deepEqual(document.attributes.tags, ['breakfast', 'favorite'])
    assert.equal(document.attributes.note, 'Typical order includes extra granola.')
    assert.equal('autoLogDaily' in document.attributes, false)
    assert.deepEqual(document.attributes.attachedRegimenIds, [
      'reg_01234567890123456789012345',
      'reg_01234567890123456789012346',
    ])
    assert.deepEqual(document.attributes.links, [
      {
        type: 'related_regimen',
        targetId: 'reg_01234567890123456789012345',
      },
      {
        type: 'related_regimen',
        targetId: 'reg_01234567890123456789012346',
      },
    ])
    assert.deepEqual(document.attributes.nutrition, {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: 'estimated',
        confidence: 'medium',
        sourceDetail: 'Menu board plus saved toppings.',
      },
    })

    const updateResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Regular Acai Bowl',
      '--id',
      saved.foodId,
      '--slug',
      'regular-acai-bowl',
      '--summary',
      'Updated usual order.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(updateResult.exitCode, null)
    const updated = requireData(updateResult.envelope)
    assert.equal(updated.created, false)
    assert.equal(updated.path, saved.path)

    const updatedMarkdown = await readFile(path.join(vaultRoot, updated.path), 'utf8')
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown)
    assert.equal(updatedDocument.attributes.summary, 'Updated usual order.')
    assert.equal(updatedDocument.attributes.status, 'active')

    const archivedResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Regular Acai Bowl',
      '--id',
      saved.foodId,
      '--status',
      'archived',
      '--vault',
      vaultRoot,
    ])
    assert.equal(archivedResult.exitCode, null)

    const preserveStatusResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Regular Acai Bowl',
      '--id',
      saved.foodId,
      '--summary',
      'Archived usual order.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(preserveStatusResult.exitCode, null)
    const preserved = requireData(preserveStatusResult.envelope)
    const preservedMarkdown = await readFile(path.join(vaultRoot, preserved.path), 'utf8')
    const preservedDocument = parseFrontmatterDocument(preservedMarkdown)
    assert.equal(preservedDocument.attributes.summary, 'Archived usual order.')
    assert.equal(preservedDocument.attributes.status, 'archived')

    const conflictingEdit = await runInProcessJsonCli<{
      entity: {
        data: Record<string, unknown>
      }
    }>(cli, [
      'food',
      'edit',
      saved.foodId,
      '--ingredient',
      'chia seeds',
      '--clear-ingredients',
      '--vault',
      vaultRoot,
    ])
    assert.equal(conflictingEdit.exitCode, 1)
    assert.equal(conflictingEdit.envelope.ok, false)
    if (!conflictingEdit.envelope.ok) {
      assert.equal(conflictingEdit.envelope.error.code, 'invalid_payload')
      assert.match(conflictingEdit.envelope.error.message ?? '', /--set ingredients/u)
      assert.match(conflictingEdit.envelope.error.message ?? '', /--clear ingredients/u)
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('food save rejects malformed typed input before writing a food record', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-food-save-invalid-',
  )

  try {
    const cli = createFoodCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)

    const saveResult = await runInProcessJsonCli<FoodSaveResult>(cli, [
      'food',
      'save',
      'Broken Food',
      '--nutrition-confidence',
      'high',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, 1)
    assert.equal(saveResult.envelope.ok, false)
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, 'invalid_option')
      assert.match(saveResult.envelope.error.message ?? '', /--nutrition-source/u)
    }
    assert.deepEqual(await readdir(path.join(vaultRoot, 'bank/foods')), [])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
