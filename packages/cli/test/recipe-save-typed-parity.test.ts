import assert from 'node:assert/strict'
import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { initializeVault, parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import { registerRecipeCommands } from '../src/commands/recipe.js'
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

interface RecipeSaveResult {
  vault: string
  recipeId: string
  lookupId: string
  path: string
  created: boolean
}

function createRecipeCli() {
  const cli = Cli.create('vault-cli', {
    description: 'recipe typed save parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  registerRecipeCommands(cli, createIntegratedVaultServices())

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

async function listRecipeFiles(vaultRoot: string): Promise<string[]> {
  try {
    return await readdir(path.join(vaultRoot, 'bank/recipes'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

test('recipe save schema exposes typed parity fields while upsert remains the JSON fallback', async () => {
  const cli = createRecipeCli()
  const schema = await readCommandSchema(cli, ['recipe', 'save'])

  assert.deepEqual(schema.args.required, ['title'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal(schema.options.required?.includes('input') ?? false, false)

  for (const field of [
    'id',
    'slug',
    'status',
    'summary',
    'cuisine',
    'dishType',
    'source',
    'servings',
    'prepTimeMinutes',
    'cookTimeMinutes',
    'totalTimeMinutes',
    'tag',
    'ingredient',
    'step',
    'relatedGoalId',
    'relatedConditionId',
    'link',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }

  const jsonFallback = await readCommandSchema(cli, ['recipe', 'upsert'])
  assert.equal('input' in jsonFallback.options.properties, true)
  assert.equal(jsonFallback.options.required?.includes('input') ?? false, true)
  assert.deepEqual(jsonFallback.args.required ?? [], [])
})

test('recipe save persists every typed raw-payload field and updates an existing recipe', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-recipe-save-',
  )

  try {
    const cli = createRecipeCli()
    await initializeVault({ vaultRoot })

    const saveResult = await runInProcessJsonCli<RecipeSaveResult>(cli, [
      'recipe',
      'save',
      'Sheet Pan Salmon Bowls',
      '--id',
      'rcp_01JNV422Y2M5ZBV64ZP4N1DRB1',
      '--slug',
      'sheet-pan-salmon-bowls',
      '--status',
      'saved',
      '--summary',
      'A reliable high-protein salmon bowl with roasted vegetables and rice.',
      '--cuisine',
      'mediterranean',
      '--dish-type',
      'dinner',
      '--source',
      'Family weeknight rotation',
      '--servings',
      '2',
      '--prep-time-minutes',
      '15',
      '--cook-time-minutes',
      '20',
      '--total-time-minutes',
      '35',
      '--tag',
      'high-protein',
      '--tag',
      'weeknight',
      '--ingredient',
      '2 salmon fillets',
      '--ingredient',
      '2 cups cooked rice',
      '--step',
      'Heat the oven to 220C and line a sheet pan.',
      '--step',
      'Serve over rice with lemon juice.',
      '--related-goal-id',
      'goal_01JNY0B2W4VG5C2A0G9S8M7R6S',
      '--related-condition-id',
      'cond_01JNY0B2W4VG5C2A0G9S8M7R6S',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, null)
    const saved = requireData(saveResult.envelope)
    assert.equal(saved.created, true)
    assert.equal(saved.recipeId, 'rcp_01JNV422Y2M5ZBV64ZP4N1DRB1')
    assert.equal(saved.lookupId, saved.recipeId)
    assert.equal(saved.path, 'bank/recipes/sheet-pan-salmon-bowls.md')

    const createdMarkdown = await readFile(path.join(vaultRoot, saved.path), 'utf8')
    const createdDocument = parseFrontmatterDocument(createdMarkdown)
    assert.equal(createdDocument.attributes.recipeId, saved.recipeId)
    assert.equal(createdDocument.attributes.slug, 'sheet-pan-salmon-bowls')
    assert.equal(createdDocument.attributes.title, 'Sheet Pan Salmon Bowls')
    assert.equal(createdDocument.attributes.status, 'saved')
    assert.equal(
      createdDocument.attributes.summary,
      'A reliable high-protein salmon bowl with roasted vegetables and rice.',
    )
    assert.equal(createdDocument.attributes.cuisine, 'mediterranean')
    assert.equal(createdDocument.attributes.dishType, 'dinner')
    assert.equal(createdDocument.attributes.source, 'Family weeknight rotation')
    assert.equal(createdDocument.attributes.servings, 2)
    assert.equal(createdDocument.attributes.prepTimeMinutes, 15)
    assert.equal(createdDocument.attributes.cookTimeMinutes, 20)
    assert.equal(createdDocument.attributes.totalTimeMinutes, 35)
    assert.deepEqual(createdDocument.attributes.tags, ['high-protein', 'weeknight'])
    assert.deepEqual(createdDocument.attributes.ingredients, [
      '2 salmon fillets',
      '2 cups cooked rice',
    ])
    assert.deepEqual(createdDocument.attributes.steps, [
      'Heat the oven to 220C and line a sheet pan.',
      'Serve over rice with lemon juice.',
    ])
    assert.deepEqual(createdDocument.attributes.relatedGoalIds, [
      'goal_01JNY0B2W4VG5C2A0G9S8M7R6S',
    ])
    assert.deepEqual(createdDocument.attributes.relatedConditionIds, [
      'cond_01JNY0B2W4VG5C2A0G9S8M7R6S',
    ])

    const updateResult = await runInProcessJsonCli<RecipeSaveResult>(cli, [
      'recipe',
      'save',
      'Sheet Pan Salmon Skillet',
      '--id',
      saved.recipeId,
      '--slug',
      'sheet-pan-salmon-skillet',
      '--link',
      'supports_goal:goal_01JNY0B2W4VG5C2A0G9S8M7R7T',
      '--link',
      'addresses_condition:cond_01JNY0B2W4VG5C2A0G9S8M7R7T',
      '--vault',
      vaultRoot,
    ])

    assert.equal(updateResult.exitCode, null)
    const updated = requireData(updateResult.envelope)
    assert.equal(updated.created, false)
    assert.equal(updated.recipeId, saved.recipeId)
    assert.equal(updated.path, 'bank/recipes/sheet-pan-salmon-skillet.md')

    const updatedMarkdown = await readFile(path.join(vaultRoot, updated.path), 'utf8')
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown)
    assert.equal(updatedDocument.attributes.title, 'Sheet Pan Salmon Skillet')
    assert.equal(updatedDocument.attributes.slug, 'sheet-pan-salmon-skillet')
    assert.equal(updatedDocument.attributes.summary, createdDocument.attributes.summary)
    assert.deepEqual(updatedDocument.attributes.relatedGoalIds, [
      'goal_01JNY0B2W4VG5C2A0G9S8M7R7T',
    ])
    assert.deepEqual(updatedDocument.attributes.relatedConditionIds, [
      'cond_01JNY0B2W4VG5C2A0G9S8M7R7T',
    ])
    assert.deepEqual(updatedDocument.attributes.links, [
      {
        targetId: 'goal_01JNY0B2W4VG5C2A0G9S8M7R7T',
        type: 'supports_goal',
      },
      {
        targetId: 'cond_01JNY0B2W4VG5C2A0G9S8M7R7T',
        type: 'addresses_condition',
      },
    ])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('recipe save rejects malformed repeatable typed fields without writing a record', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-recipe-save-invalid-',
  )

  try {
    const cli = createRecipeCli()
    await initializeVault({ vaultRoot })

    const saveResult = await runInProcessJsonCli<RecipeSaveResult>(cli, [
      'recipe',
      'save',
      'Sheet Pan Salmon Bowls',
      '--tag',
      'high-protein,weeknight',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, 1)
    assert.equal(saveResult.envelope.ok, false)
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, 'invalid_option')
      assert.match(saveResult.envelope.error.message ?? '', /--tag/u)
    }
    assert.deepEqual(await listRecipeFiles(vaultRoot), [])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
