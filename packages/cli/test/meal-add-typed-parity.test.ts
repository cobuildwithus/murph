import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import { registerMealCommands } from '../src/commands/meal.js'
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

interface MealAddResult {
  vault: string
  mealId: string
  eventId: string
  lookupId: string
  occurredAt: string | null
  photoPath: string | null
  audioPath: string | null
  manifestFile: string
  note: string | null
  source: string | null
  ingredients: string[] | null
  nutrition: {
    totals?: {
      calories?: number
      proteinGrams?: number
      carbsGrams?: number
      fatGrams?: number
      fiberGrams?: number
    }
    provenance?: {
      source: string
      confidence?: string
      sourceDetail?: string
    }
  } | null
}

interface ShowResult {
  entity: {
    id: string
    occurredAt: string | null
    data: Record<string, unknown>
  }
}

function createMealCli() {
  const cli = Cli.create('vault-cli', {
    description: 'meal add typed parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  registerMealCommands(cli, createIntegratedVaultServices())
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

function comparableMealOutput(result: MealAddResult) {
  return {
    occurredAt: result.occurredAt,
    note: result.note,
    source: result.source,
    ingredients: result.ingredients,
    nutrition: result.nutrition,
  }
}

function comparableShownMealData(data: Record<string, unknown>) {
  return {
    source: data.source,
    ingredients: data.ingredients,
    nutrition: data.nutrition,
  }
}

test(
  'meal add schema exposes typed ingredient and nutrition options without raw input fallback',
  async () => {
    const schema = await readCommandSchema(createMealCli(), ['meal', 'add'])

    assert.deepEqual(schema.args.required ?? [], [])
    assert.equal('input' in schema.options.properties, false)

    for (const field of [
      'photo',
      'audio',
      'note',
      'occurredAt',
      'source',
      'ingredient',
      'nutritionCalories',
      'nutritionProteinGrams',
      'nutritionCarbsGrams',
      'nutritionFatGrams',
      'nutritionFiberGrams',
      'nutritionSource',
      'nutritionConfidence',
      'nutritionSourceDetail',
    ]) {
      assert.equal(field in schema.options.properties, true, field)
    }
  },
)

test('meal add guidance teaches quoted repeatable ingredients', async () => {
  const cli = createMealCli()
  const schema = await readCommandSchema(cli, ['meal', 'add'])
  const ingredientSchema = schema.options.properties.ingredient as {
    description?: string
  }
  const help = await runRawInProcessCli(cli, ['meal', 'add', '--help'])
  const llms = await runRawInProcessCli(cli, ['meal', 'add', '--llms-full'])

  for (const rendered of [ingredientSchema.description ?? '', help, llms]) {
    assert.match(rendered, /shell-quote values with spaces/u)
    assert.match(rendered, /Do not comma-delimit multiple ingredients/u)
  }

  for (const rendered of [help, llms]) {
    assert.match(rendered, /--note 'Eggs, toast, and coffee\.'/u)
    assert.match(rendered, /--ingredient 'rolled oats'/u)
  }
})

test('meal import-json schema exposes the structured payload escape hatch', async () => {
  const schema = await readCommandSchema(createMealCli(), ['meal', 'import-json'])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, true)
  assert.equal(schema.options.required?.includes('input') ?? false, true)

  for (const field of [
    'photo',
    'audio',
    'note',
    'occurredAt',
    'source',
    'ingredient',
    'nutritionCalories',
    'nutritionProteinGrams',
    'nutritionCarbsGrams',
    'nutritionFatGrams',
    'nutritionFiberGrams',
    'nutritionSource',
    'nutritionConfidence',
    'nutritionSourceDetail',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test.sequential(
  'meal add typed options persist the same ingredients and nutrition as JSON input',
  async () => {
    const jsonContext = await createTempVaultContext('murph-cli-meal-json-parity-')
    const typedContext = await createTempVaultContext('murph-cli-meal-typed-parity-')

    try {
      await initializeVault({ vaultRoot: jsonContext.vaultRoot })
      await initializeVault({ vaultRoot: typedContext.vaultRoot })

      const cli = createMealCli()
      const nutrition = {
        totals: {
          calories: 390,
          proteinGrams: 15,
          carbsGrams: 56,
          fatGrams: 11,
          fiberGrams: 12,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
          sourceDetail: 'Recipe estimate',
        },
      }
      const payload = {
        occurredAt: '2026-03-14T08:30:00Z',
        source: 'manual',
        ingredients: ['rolled oats', 'blueberries', 'chia seeds'],
        nutrition,
      }
      const payloadPath = path.join(jsonContext.parentRoot, 'meal.json')
      await writeFile(payloadPath, `${JSON.stringify(payload)}\n`, 'utf8')

      const jsonResult = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        jsonContext.vaultRoot,
      ])
      assert.equal(jsonResult.exitCode, null)

      const typedResult = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'add',
        '--occurred-at',
        payload.occurredAt,
        '--source',
        payload.source,
        '--ingredient',
        'rolled oats',
        '--ingredient',
        'blueberries',
        '--ingredient',
        'chia seeds',
        '--nutrition-calories',
        '390',
        '--nutrition-protein-grams',
        '15',
        '--nutrition-carbs-grams',
        '56',
        '--nutrition-fat-grams',
        '11',
        '--nutrition-fiber-grams',
        '12',
        '--nutrition-source',
        'estimated',
        '--nutrition-confidence',
        'medium',
        '--nutrition-source-detail',
        'Recipe estimate',
        '--vault',
        typedContext.vaultRoot,
      ])
      assert.equal(typedResult.exitCode, null)

      const jsonMeal = requireData(jsonResult.envelope)
      const typedMeal = requireData(typedResult.envelope)
      assert.deepEqual(comparableMealOutput(typedMeal), comparableMealOutput(jsonMeal))

      const jsonShow = await runInProcessJsonCli<ShowResult>(cli, [
        'meal',
        'show',
        jsonMeal.mealId,
        '--vault',
        jsonContext.vaultRoot,
      ])
      const typedShow = await runInProcessJsonCli<ShowResult>(cli, [
        'meal',
        'show',
        typedMeal.mealId,
        '--vault',
        typedContext.vaultRoot,
      ])

      assert.equal(jsonShow.exitCode, null)
      assert.equal(typedShow.exitCode, null)
      assert.equal(
        requireData(typedShow.envelope).entity.occurredAt,
        '2026-03-14T08:30:00.000Z',
      )
      assert.deepEqual(
        comparableShownMealData(requireData(typedShow.envelope).entity.data),
        comparableShownMealData(requireData(jsonShow.envelope).entity.data),
      )
    } finally {
      await rm(jsonContext.parentRoot, { force: true, recursive: true })
      await rm(typedContext.parentRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'meal add rejects empty JSON payloads and empty typed invocations',
  async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-cli-meal-empty-parity-',
    )

    try {
      await initializeVault({ vaultRoot })
      const cli = createMealCli()
      const emptyTypedResult = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'add',
        '--vault',
        vaultRoot,
      ])
      assert.equal(emptyTypedResult.exitCode, 1)
      assert.equal(emptyTypedResult.envelope.ok, false)
      if (!emptyTypedResult.envelope.ok) {
        assert.equal(emptyTypedResult.envelope.error.code, 'invalid_option')
        assert.match(
          emptyTypedResult.envelope.error.message ?? '',
          /Meal capture requires/u,
        )
      }

      const payloadPath = path.join(parentRoot, 'empty-meal.json')
      await writeFile(payloadPath, '{}\n', 'utf8')
      const emptyPayloadResult = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(emptyPayloadResult.exitCode, 1)
      assert.equal(emptyPayloadResult.envelope.ok, false)
      if (!emptyPayloadResult.envelope.ok) {
        assert.equal(emptyPayloadResult.envelope.error.code, 'invalid_option')
        assert.match(
          emptyPayloadResult.envelope.error.message ?? '',
          /Meal capture requires/u,
        )
      }
    } finally {
      await rm(parentRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'meal add typed ingredients and nutrition override structured payload fields',
  async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-cli-meal-override-parity-',
    )

    try {
      await initializeVault({ vaultRoot })
      const cli = createMealCli()
      const payloadPath = path.join(parentRoot, 'payload-meal.json')
      await writeFile(
        payloadPath,
        `${JSON.stringify({
          occurredAt: '2026-03-15T08:00:00Z',
          source: 'import',
          ingredients: ['payload rice', 'payload salmon'],
          nutrition: {
            totals: {
              calories: 610,
              proteinGrams: 42,
              carbsGrams: 51,
              fatGrams: 22,
              fiberGrams: 8,
            },
            provenance: {
              source: 'label',
              confidence: 'high',
              sourceDetail: 'Payload label',
            },
          },
        })}\n`,
        'utf8',
      )

      const result = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--ingredient',
        'typed oats',
        '--ingredient',
        'typed berries',
        '--nutrition-calories',
        '390',
        '--nutrition-protein-grams',
        '15',
        '--nutrition-source',
        'estimated',
        '--nutrition-confidence',
        'medium',
        '--nutrition-source-detail',
        'Typed estimate',
        '--vault',
        vaultRoot,
      ])

      assert.equal(result.exitCode, null)
      const meal = requireData(result.envelope)
      assert.deepEqual(meal.ingredients, ['typed oats', 'typed berries'])
      assert.deepEqual(meal.nutrition, {
        totals: {
          calories: 390,
          proteinGrams: 15,
          carbsGrams: 51,
          fatGrams: 22,
          fiberGrams: 8,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
          sourceDetail: 'Typed estimate',
        },
      })
    } finally {
      await rm(parentRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'meal add rejects typed nutrition provenance without a source',
  async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-cli-meal-provenance-parity-',
    )

    try {
      await initializeVault({ vaultRoot })
      const cli = createMealCli()

      const result = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'add',
        '--nutrition-confidence',
        'medium',
        '--vault',
        vaultRoot,
      ])

      assert.equal(result.exitCode, 1)
      assert.equal(result.envelope.ok, false)
      if (!result.envelope.ok) {
        assert.equal(result.envelope.error.code, 'invalid_option')
        assert.match(result.envelope.error.message ?? '', /--nutrition-source/u)
      }

      const payloadPath = path.join(parentRoot, 'payload-source-meal.json')
      await writeFile(
        payloadPath,
        `${JSON.stringify({
          ingredients: ['payload oats'],
          nutrition: {
            provenance: {
              source: 'label',
            },
          },
        })}\n`,
        'utf8',
      )
      const payloadSourceResult = await runInProcessJsonCli<MealAddResult>(cli, [
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--nutrition-confidence',
        'medium',
        '--vault',
        vaultRoot,
      ])

      assert.equal(payloadSourceResult.exitCode, null)
      assert.deepEqual(requireData(payloadSourceResult.envelope).nutrition, {
        provenance: {
          source: 'label',
          confidence: 'medium',
        },
      })
    } finally {
      await rm(parentRoot, { force: true, recursive: true })
    }
  },
)
