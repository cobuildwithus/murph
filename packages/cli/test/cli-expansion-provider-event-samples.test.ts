import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listAssistantCronJobs } from '@murphai/assistant-cli/assistant/cron'
import { Cli } from 'incur'
import { test } from 'vitest'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerEventCommands } from '../src/commands/event.js'
import { registerFoodCommands } from '../src/commands/food.js'
import { registerMealCommands } from '../src/commands/meal.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerProviderCommands } from '../src/commands/provider.js'
import { registerSearchCommands } from '../src/commands/search.js'
import { registerRecipeCommands } from '../src/commands/recipe.js'
import { registerSamplesCommands } from '../src/commands/samples.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWearablesCommands } from '../src/commands/wearables.js'
import { createIntegratedVaultServices } from '@murphai/vault-inbox/vault-services'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

interface DeleteEnvelope {
  entityId: string
  lookupId: string
  kind: string
  deleted: true
  retainedPaths: string[]
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'provider/food/recipe/event/samples slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerReadCommands(cli, services)
  registerSearchCommands(cli, services)
  registerProviderCommands(cli, services)
  registerFoodCommands(cli, services)
  registerRecipeCommands(cli, services)
  registerEventCommands(cli, services)
  registerMealCommands(cli, services)
  registerSamplesCommands(cli, services)
  registerWearablesCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runSliceCliRaw(args: string[]) {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('provider, food, recipe, event, and samples schemas expose the new noun entrypoints', async () => {
  const providerSchema = JSON.parse(
    await runSliceCliRaw(['provider', 'upsert', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const foodSchema = JSON.parse(
    await runSliceCliRaw(['food', 'upsert', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const recipeSchema = JSON.parse(
    await runSliceCliRaw(['recipe', 'upsert', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const eventSchema = JSON.parse(
    await runSliceCliRaw(['event', 'scaffold', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const samplesSchema = JSON.parse(
    await runSliceCliRaw(['samples', 'add', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('input' in providerSchema.options.properties, true)
  assert.equal('input' in foodSchema.options.properties, true)
  assert.equal('input' in recipeSchema.options.properties, true)
  assert.equal('kind' in eventSchema.options.properties, true)
  assert.deepEqual(eventSchema.options.required, ['vault', 'kind'])
  assert.equal('input' in samplesSchema.options.properties, true)
})

test('provider, food, recipe, and event edit/delete schemas expose shared record mutation options', async () => {
  const providerEditSchema = JSON.parse(
    await runSliceCliRaw(['provider', 'edit', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const foodEditSchema = JSON.parse(
    await runSliceCliRaw(['food', 'edit', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const recipeEditSchema = JSON.parse(
    await runSliceCliRaw(['recipe', 'edit', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const eventEditSchema = JSON.parse(
    await runSliceCliRaw(['event', 'edit', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const providerDeleteSchema = JSON.parse(
    await runSliceCliRaw(['provider', 'delete', '--schema']),
  ) as {
    options: {
      required?: string[]
    }
  }

  assert.equal('input' in providerEditSchema.options.properties, true)
  assert.equal('set' in providerEditSchema.options.properties, true)
  assert.equal('clear' in providerEditSchema.options.properties, true)
  assert.deepEqual(providerEditSchema.options.required, ['vault'])

  assert.equal('input' in foodEditSchema.options.properties, true)
  assert.equal('set' in foodEditSchema.options.properties, true)
  assert.equal('clear' in foodEditSchema.options.properties, true)
  assert.deepEqual(foodEditSchema.options.required, ['vault'])

  assert.equal('input' in recipeEditSchema.options.properties, true)
  assert.equal('set' in recipeEditSchema.options.properties, true)
  assert.equal('clear' in recipeEditSchema.options.properties, true)
  assert.deepEqual(recipeEditSchema.options.required, ['vault'])

  assert.equal('input' in eventEditSchema.options.properties, true)
  assert.equal('set' in eventEditSchema.options.properties, true)
  assert.equal('clear' in eventEditSchema.options.properties, true)
  assert.equal('dayKeyPolicy' in eventEditSchema.options.properties, true)
  assert.deepEqual(eventEditSchema.options.required, ['vault'])

  assert.deepEqual(providerDeleteSchema.options.required, ['vault'])
})

test('provider/food/recipe/event/samples help uses generic id selectors for read commands', async () => {
  const providerHelp = await runSliceCliRaw(['provider', 'show', '--help'])
  const foodHelp = await runSliceCliRaw(['food', 'show', '--help'])
  const recipeHelp = await runSliceCliRaw(['recipe', 'show', '--help'])
  const eventHelp = await runSliceCliRaw(['event', 'show', '--help'])
  const sampleHelp = await runSliceCliRaw(['samples', 'show', '--help'])
  const batchHelp = await runSliceCliRaw(['samples', 'batch', 'show', '--help'])

  assert.match(providerHelp, /Usage: vault-cli provider show <id> \[options\]/u)
  assert.match(foodHelp, /Usage: vault-cli food show <id> \[options\]/u)
  assert.match(recipeHelp, /Usage: vault-cli recipe show <id> \[options\]/u)
  assert.match(eventHelp, /Usage: vault-cli event show <id> \[options\]/u)
  assert.match(sampleHelp, /Usage: vault-cli samples show <id> \[options\]/u)
  assert.match(batchHelp, /Usage: vault-cli samples batch show <id> \[options\]/u)
})

test('generic read and semantic summary help surfaces explain when to use them', async () => {
  const showHelp = await runSliceCliRaw(['show', '--help'])
  const listHelp = await runSliceCliRaw(['list', '--help'])
  const searchHelp = await runSliceCliRaw(['search', 'query', '--help'])
  const timelineHelp = await runSliceCliRaw(['timeline', '--help'])
  const wearablesDayHelp = await runSliceCliRaw(['wearables', 'day', '--help'])
  const mealManifestHelp = await runSliceCliRaw(['meal', 'manifest', '--help'])

  assert.match(
    showHelp,
    /Use generic `show` with canonical read ids such as `meal_\*`, `doc_\*`, `evt_\*`, or `journal:\*`\./u,
  )
  assert.match(
    listHelp,
    /Use `list` for family\/kind\/status\/tag\/date filtering, `search query` for fuzzy text recall, and `timeline` for chronology across record types\./u,
  )
  assert.match(
    searchHelp,
    /Use `search query` for fuzzy recall or remembered phrases\. Use `show` for one exact id, `list` for structured filters, and `timeline` for chronology\./u,
  )
  assert.match(
    timelineHelp,
    /Use `timeline` when you need chronology across journals, events, assessments, profile snapshots, and sample summaries\./u,
  )
  assert.match(
    wearablesDayHelp,
    /Use `wearables day` as the first read for date-specific wearable questions\./u,
  )
  assert.match(
    mealManifestHelp,
    /Show the immutable raw import manifest for a meal event\./u,
  )
})

test.sequential(
  'recipe scaffold/upsert/show/list work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-recipe-'))
    const recipePayloadPath = path.join(vaultRoot, 'recipe.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const recipeScaffold = await runSliceCli<{
        noun: string
        payload: {
          title?: string
        }
      }>(['recipe', 'scaffold', '--vault', vaultRoot])

      assert.equal(recipeScaffold.ok, true)
      assert.equal(requireData(recipeScaffold).noun, 'recipe')
      assert.equal(
        requireData(recipeScaffold).payload.title,
        'Sheet Pan Salmon Bowls',
      )

      await writeFile(
        recipePayloadPath,
        JSON.stringify({
          title: 'Sheet Pan Salmon Bowls',
          slug: 'sheet-pan-salmon-bowls',
          status: 'saved',
          summary: 'A reliable high-protein salmon bowl with roasted vegetables and rice.',
          cuisine: 'mediterranean',
          dishType: 'dinner',
          source: 'Family weeknight rotation',
          servings: 2,
          prepTimeMinutes: 15,
          cookTimeMinutes: 20,
          tags: ['high-protein', 'weeknight'],
          ingredients: ['2 salmon fillets', '2 cups cooked rice', '2 cups broccoli florets'],
          steps: [
            'Heat the oven to 220C and line a sheet pan.',
            'Roast the broccoli for 10 minutes.',
            'Add the salmon and roast until cooked through.',
            'Serve over rice with lemon juice.',
          ],
        }),
        'utf8',
      )

      const recipeUpsert = await runSliceCli<{
        recipeId: string
        path: string
        created: boolean
      }>([
        'recipe',
        'upsert',
        '--input',
        `@${recipePayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(recipeUpsert.ok, true, JSON.stringify(recipeUpsert))
      assert.equal(recipeUpsert.meta?.command, 'recipe upsert')
      assert.match(requireData(recipeUpsert).recipeId, /^rcp_/u)
      assert.equal(
        requireData(recipeUpsert).path,
        'bank/recipes/sheet-pan-salmon-bowls.md',
      )
      assert.equal(requireData(recipeUpsert).created, true)
      await access(path.join(vaultRoot, requireData(recipeUpsert).path))

      const recipeShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          title: string | null
          data: {
            cuisine?: string
            totalTimeMinutes?: number
          }
        }
      }>([
        'recipe',
        'show',
        requireData(recipeUpsert).recipeId,
        '--vault',
        vaultRoot,
      ])
      const recipeShowBySlug = await runSliceCli<{
        entity: {
          id: string
        }
      }>([
        'recipe',
        'show',
        'sheet-pan-salmon-bowls',
        '--vault',
        vaultRoot,
      ])
      const recipeList = await runSliceCli<{
        filters: {
          status: string | null
          limit: number
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'recipe',
        'list',
        '--status',
        'saved',
        '--vault',
        vaultRoot,
      ])

      assert.equal(recipeShow.ok, true)
      assert.equal(requireData(recipeShow).entity.id, requireData(recipeUpsert).recipeId)
      assert.equal(requireData(recipeShow).entity.kind, 'recipe')
      assert.equal(requireData(recipeShow).entity.title, 'Sheet Pan Salmon Bowls')
      assert.equal(requireData(recipeShow).entity.data.cuisine, 'mediterranean')
      assert.equal(requireData(recipeShow).entity.data.totalTimeMinutes, 35)
      assert.equal(recipeShowBySlug.ok, true)
      assert.equal(
        requireData(recipeShowBySlug).entity.id,
        requireData(recipeUpsert).recipeId,
      )

      assert.equal(recipeList.ok, true)
      assert.equal(requireData(recipeList).filters.status, 'saved')
      assert.equal(requireData(recipeList).count, 1)
      assert.equal(requireData(recipeList).items.length, 1)
      assert.equal(requireData(recipeList).items[0]?.kind, 'recipe')
      assert.equal(requireData(recipeList).items[0]?.data.dishType, 'dinner')

      const recipeMarkdown = await readFile(
        path.join(vaultRoot, requireData(recipeUpsert).path),
        'utf8',
      )
      assert.match(recipeMarkdown, /recipeId:/u)
      assert.match(recipeMarkdown, /## Ingredients/u)
      assert.match(recipeMarkdown, /## Steps/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food scaffold/upsert/show/list work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-food-'))
    const foodPayloadPath = path.join(vaultRoot, 'food.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const foodScaffold = await runSliceCli<{
        noun: string
        payload: {
          title?: string
          aliases?: string[]
        }
      }>(['food', 'scaffold', '--vault', vaultRoot])

      assert.equal(foodScaffold.ok, true)
      assert.equal(requireData(foodScaffold).noun, 'food')
      assert.equal(requireData(foodScaffold).payload.title, 'Regular Acai Bowl')
      assert.deepEqual(requireData(foodScaffold).payload.aliases, [
        'regular acai bowl',
        'usual acai bowl',
      ])

      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Regular Acai Bowl',
          slug: 'regular-acai-bowl',
          status: 'active',
          summary: 'The usual acai bowl order from the neighborhood spot with repeat toppings.',
          kind: 'acai bowl',
          vendor: 'Neighborhood Acai Bar',
          location: 'Brooklyn, NY',
          serving: '1 bowl',
          aliases: ['regular acai bowl', 'usual acai bowl'],
          ingredients: ['acai base', 'banana', 'strawberries', 'granola'],
          tags: ['breakfast', 'favorite'],
          note: 'Typical order includes extra granola and no honey.',
        }),
        'utf8',
      )

      const foodUpsert = await runSliceCli<{
        foodId: string
        path: string
        created: boolean
      }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodUpsert.ok, true, JSON.stringify(foodUpsert))
      assert.equal(foodUpsert.meta?.command, 'food upsert')
      assert.match(requireData(foodUpsert).foodId, /^food_/u)
      assert.equal(requireData(foodUpsert).path, 'bank/foods/regular-acai-bowl.md')
      assert.equal(requireData(foodUpsert).created, true)
      await access(path.join(vaultRoot, requireData(foodUpsert).path))

      const foodShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          title: string | null
          data: {
            vendor?: string
            ingredients?: string[]
          }
        }
      }>([
        'food',
        'show',
        requireData(foodUpsert).foodId,
        '--vault',
        vaultRoot,
      ])
      const foodShowBySlug = await runSliceCli<{
        entity: {
          id: string
        }
      }>([
        'food',
        'show',
        'regular-acai-bowl',
        '--vault',
        vaultRoot,
      ])
      const foodList = await runSliceCli<{
        filters: {
          status: string | null
          limit: number
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'food',
        'list',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodShow.ok, true)
      assert.equal(requireData(foodShow).entity.id, requireData(foodUpsert).foodId)
      assert.equal(requireData(foodShow).entity.kind, 'food')
      assert.equal(requireData(foodShow).entity.title, 'Regular Acai Bowl')
      assert.equal(requireData(foodShow).entity.data.vendor, 'Neighborhood Acai Bar')
      assert.deepEqual(requireData(foodShow).entity.data.ingredients, [
        'acai base',
        'banana',
        'strawberries',
        'granola',
      ])
      assert.equal(foodShowBySlug.ok, true)
      assert.equal(requireData(foodShowBySlug).entity.id, requireData(foodUpsert).foodId)

      assert.equal(foodList.ok, true)
      assert.equal(requireData(foodList).filters.status, 'active')
      assert.equal(requireData(foodList).count, 1)
      assert.equal(requireData(foodList).items.length, 1)
      assert.equal(requireData(foodList).items[0]?.kind, 'food')
      assert.equal(requireData(foodList).items[0]?.data.kind, 'acai bowl')

      const foodMarkdown = await readFile(
        path.join(vaultRoot, requireData(foodUpsert).path),
        'utf8',
      )
      assert.match(foodMarkdown, /foodId:/u)
      assert.match(foodMarkdown, /## Aliases/u)
      assert.match(foodMarkdown, /## Ingredients/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food schedule creates a remembered food plus a daily auto-log job',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-food-daily-'))

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const foodSchedule = await runSliceCli<{
        foodId: string
        path: string
        created: boolean
        time: string
        jobId: string
        jobName: string
        nextRunAt: string | null
      }>([
        'food',
        'schedule',
        'Morning Smoothie',
        '--time',
        '08:00',
        '--note',
        'Bone broth protein, inulin, prebiotic GOS, creatine, and coconut water.',
        '--vault',
        vaultRoot,
      ])
      const foodShow = await runSliceCli<{
        entity: {
          id: string
          data: {
            autoLogDaily?: {
              time: string
            } | null
            note?: string
          }
        }
      }>([
        'food',
        'show',
        requireData(foodSchedule).foodId,
        '--vault',
        vaultRoot,
      ])
      const jobs = await listAssistantCronJobs(vaultRoot)

      assert.equal(foodSchedule.ok, true, JSON.stringify(foodSchedule))
      assert.equal(foodSchedule.meta?.command, 'food schedule')
      assert.match(requireData(foodSchedule).foodId, /^food_/u)
      assert.equal(requireData(foodSchedule).path, 'bank/foods/morning-smoothie.md')
      assert.equal(requireData(foodSchedule).created, true)
      assert.equal(requireData(foodSchedule).time, '08:00')
      assert.equal(requireData(foodSchedule).jobName, 'food-daily:morning-smoothie')
      assert.equal(requireData(foodSchedule).nextRunAt !== null, true)

      assert.equal(foodShow.ok, true)
      assert.equal(requireData(foodShow).entity.id, requireData(foodSchedule).foodId)
      assert.deepEqual(requireData(foodShow).entity.data.autoLogDaily, {
        time: '08:00',
      })
      assert.equal(
        requireData(foodShow).entity.data.note,
        'Bone broth protein, inulin, prebiotic GOS, creatine, and coconut water.',
      )

      assert.equal(jobs.length, 1)
      assert.equal(jobs[0]?.jobId, requireData(foodSchedule).jobId)
      assert.equal(jobs[0]?.name, 'food-daily:morning-smoothie')
      assert.equal(jobs[0]?.schedule.kind, 'dailyLocal')
      assert.equal(jobs[0]?.schedule.localTime, '08:00')
      assert.equal(
        jobs[0]?.schedule.timeZone,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      )
      assert.deepEqual(jobs[0]?.foodAutoLog, {
        foodId: requireData(foodSchedule).foodId,
      })

      const foodMarkdown = await readFile(
        path.join(vaultRoot, requireData(foodSchedule).path),
        'utf8',
      )
      assert.match(foodMarkdown, /autoLogDaily:/u)
      assert.match(foodMarkdown, /time: ['"]?08:00['"]?/u)
      assert.match(foodMarkdown, /Auto-log daily/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food rename moves the record to the new slug while preserving the id and prior title alias',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-food-rename-'))
    const foodPayloadPath = path.join(vaultRoot, 'food.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Morning Supplement Mix',
          slug: 'morning-supplement-mix',
          status: 'active',
          note: 'Bone broth protein, inulin, creatine, and coconut water.',
          aliases: ['morning mix'],
        }),
        'utf8',
      )

      const created = await runSliceCli<{
        foodId: string
        path: string
      }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(created.ok, true)

      const renamed = await runSliceCli<{
        foodId: string
        path: string
        created: boolean
      }>([
        'food',
        'rename',
        requireData(created).foodId,
        '--title',
        'Morning Protein Drink',
        '--vault',
        vaultRoot,
      ])

      assert.equal(renamed.ok, true)
      assert.equal(requireData(renamed).foodId, requireData(created).foodId)
      assert.equal(requireData(renamed).path, 'bank/foods/morning-protein-drink.md')
      assert.equal(requireData(renamed).created, false)

      await access(path.join(vaultRoot, 'bank/foods/morning-protein-drink.md'))
      await assert.rejects(() => access(path.join(vaultRoot, 'bank/foods/morning-supplement-mix.md')))

      const renamedMarkdown = await readFile(
        path.join(vaultRoot, requireData(renamed).path),
        'utf8',
      )

      assert.match(renamedMarkdown, /title: "Morning Protein Drink"/u)
      assert.match(renamedMarkdown, /- morning mix/u)
      assert.match(renamedMarkdown, /- Morning Supplement Mix/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider upsert/show/list, event upsert/show/list, and samples add work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-provider-'))
    const providerPayloadPath = path.join(vaultRoot, 'provider.json')
    const eventPayloadPath = path.join(vaultRoot, 'event.json')
    const samplesPayloadPath = path.join(vaultRoot, 'samples.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        providerPayloadPath,
        JSON.stringify({
          title: 'Labcorp',
          slug: 'labcorp',
          status: 'active',
          specialty: 'lab',
          organization: 'Labcorp',
          location: 'Research Triangle Park',
          website: 'https://labcorp.example.test',
          phone: '555-0101',
          note: 'Primary lab partner.',
          aliases: ['Laboratory Corporation'],
          body: '# Labcorp\n\nPrimary lab partner.\n',
        }),
        'utf8',
      )

      const providerUpsert = await runSliceCli<{
        providerId: string
        path: string
        created: boolean
      }>([
        'provider',
        'upsert',
        '--input',
        `@${providerPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(providerUpsert.ok, true, JSON.stringify(providerUpsert))
      assert.equal(providerUpsert.meta?.command, 'provider upsert')
      assert.match(requireData(providerUpsert).providerId, /^prov_/u)
      assert.equal(requireData(providerUpsert).path, 'bank/providers/labcorp.md')
      assert.equal(requireData(providerUpsert).created, true)
      await access(path.join(vaultRoot, requireData(providerUpsert).path))

      const providerShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          title: string | null
          data: {
            specialty?: string
          }
        }
      }>([
        'provider',
        'show',
        requireData(providerUpsert).providerId,
        '--vault',
        vaultRoot,
      ])
      const providerShowBySlug = await runSliceCli<{
        entity: {
          id: string
        }
      }>([
        'provider',
        'show',
        'labcorp',
        '--vault',
        vaultRoot,
      ])
      const providerList = await runSliceCli<{
        filters: {
          status: string | null
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'provider',
        'list',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])

      assert.equal(providerShow.ok, true)
      assert.equal(requireData(providerShow).entity.id, requireData(providerUpsert).providerId)
      assert.equal(requireData(providerShow).entity.kind, 'provider')
      assert.equal(requireData(providerShow).entity.title, 'Labcorp')
      assert.equal(requireData(providerShow).entity.data.specialty, 'lab')
      assert.equal(providerShowBySlug.ok, true)
      assert.equal(
        requireData(providerShowBySlug).entity.id,
        requireData(providerUpsert).providerId,
      )

      assert.equal(providerList.ok, true)
      assert.equal(requireData(providerList).filters.status, 'active')
      assert.equal(requireData(providerList).count, 1)
      assert.equal(requireData(providerList).items.length, 1)
      assert.equal(requireData(providerList).items[0]?.kind, 'provider')
      assert.equal(requireData(providerList).items[0]?.data.specialty, 'lab')

      await writeFile(
        eventPayloadPath,
        JSON.stringify({
          kind: 'symptom',
          occurredAt: '2026-03-12T08:15:00.000Z',
          title: 'Morning headache',
          symptom: 'headache',
          intensity: 4,
          bodySite: 'temple',
          note: 'Resolved after breakfast.',
          tags: ['symptom', 'morning'],
          relatedIds: [requireData(providerUpsert).providerId],
        }),
        'utf8',
      )

      const eventUpsert = await runSliceCli<{
        eventId: string
        ledgerFile: string
      }>([
        'event',
        'upsert',
        '--input',
        `@${eventPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(eventUpsert.ok, true)
      assert.equal(eventUpsert.meta?.command, 'event upsert')
      assert.match(requireData(eventUpsert).eventId, /^evt_/u)
      assert.match(requireData(eventUpsert).ledgerFile, /^ledger\/events\//u)

      const eventShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          data: {
            symptom?: string
            providerId?: string
          }
          links: Array<{
            id: string
            kind: string
          }>
        }
      }>([
        'event',
        'show',
        requireData(eventUpsert).eventId,
        '--vault',
        vaultRoot,
      ])
      const eventList = await runSliceCli<{
        filters: {
          kind: string | null
          tag: string[]
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
          links: Array<{
            id: string
            kind: string
          }>
        }>
      }>([
        'event',
        'list',
        '--kind',
        'symptom',
        '--tag',
        'symptom',
        '--tag',
        ' morning ',
        '--tag',
        'morning',
        '--vault',
        vaultRoot,
      ])

      assert.equal(eventShow.ok, true)
      assert.equal(requireData(eventShow).entity.id, requireData(eventUpsert).eventId)
      assert.equal(requireData(eventShow).entity.kind, 'symptom')
      assert.equal(requireData(eventShow).entity.data.symptom, 'headache')
      assert.equal(
        requireData(eventShow).entity.links.some(
          (link) =>
            link.id === requireData(providerUpsert).providerId &&
            link.kind === 'provider',
        ),
        true,
      )

      assert.equal(eventList.ok, true)
      assert.equal(requireData(eventList).filters.kind, 'symptom')
      assert.deepEqual(requireData(eventList).filters.tag, [
        'symptom',
        'morning',
      ])
      assert.equal(requireData(eventList).count, 1)
      assert.equal(requireData(eventList).items.length, 1)
      assert.equal(requireData(eventList).items[0]?.kind, 'symptom')
      assert.equal(requireData(eventList).items[0]?.data.symptom, 'headache')
      assert.equal(requireData(eventList).items[0]?.links[0]?.id, requireData(providerUpsert).providerId)

      const csvEventList = await runSliceCli([
        'event',
        'list',
        '--tag',
        'symptom,morning',
        '--vault',
        vaultRoot,
      ])
      assert.equal(csvEventList.ok, false)
      assert.match(
        csvEventList.error.message ?? '',
        /repeat the flag instead|comma-delimited values are not supported/iu,
      )

      await writeFile(
        samplesPayloadPath,
        JSON.stringify({
          stream: 'heart_rate',
          unit: 'bpm',
          source: 'manual',
          quality: 'raw',
          samples: [
            {
              recordedAt: '2026-03-12T08:00:00.000Z',
              value: 61,
            },
            {
              recordedAt: '2026-03-12T08:01:00.000Z',
              value: 63,
            },
          ],
        }),
        'utf8',
      )

      const samplesAdd = await runSliceCli<{
        stream: string
        source: string
        quality: string
        addedCount: number
        lookupIds: string[]
        ledgerFiles: string[]
      }>([
        'samples',
        'add',
        '--input',
        `@${samplesPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(samplesAdd.ok, true)
      assert.equal(samplesAdd.meta?.command, 'samples add')
      assert.equal(requireData(samplesAdd).stream, 'heart_rate')
      assert.equal(requireData(samplesAdd).source, 'manual')
      assert.equal(requireData(samplesAdd).quality, 'raw')
      assert.equal(requireData(samplesAdd).addedCount, 2)
      assert.equal(requireData(samplesAdd).lookupIds.length, 2)
      assert.equal(requireData(samplesAdd).ledgerFiles.length, 1)

      const sampleShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'samples',
        'show',
        requireData(samplesAdd).lookupIds[0] as string,
        '--vault',
        vaultRoot,
      ])
      const sampleList = await runSliceCli<{
        filters: {
          stream: string | null
          quality: string | null
        }
        count: number
        items: Array<{
          id: string
          kind: string
          stream: string | null
          quality: string | null
          data: Record<string, unknown>
        }>
      }>([
        'samples',
        'list',
        '--stream',
        'heart_rate',
        '--quality',
        'raw',
        '--vault',
        vaultRoot,
      ])

      assert.equal(sampleShow.ok, true)
      assert.equal(requireData(sampleShow).entity.id, requireData(samplesAdd).lookupIds[0])
      assert.equal(requireData(sampleShow).entity.kind, 'sample')
      assert.equal(sampleList.ok, true)
      assert.equal(requireData(sampleList).filters.stream, 'heart_rate')
      assert.equal(requireData(sampleList).filters.quality, 'raw')
      assert.equal(requireData(sampleList).count, 2)
      assert.equal(requireData(sampleList).items.length, 2)
      assert.equal(requireData(sampleList).items[0]?.kind, 'sample')
      assert.equal(requireData(sampleList).items[0]?.stream, 'heart_rate')
      assert.equal(requireData(sampleList).items[0]?.quality, 'raw')
      assert.equal(requireData(sampleList).items[0]?.data.stream, 'heart_rate')

      const providerMarkdown = await readFile(
        path.join(vaultRoot, requireData(providerUpsert).path),
        'utf8',
      )
      assert.match(providerMarkdown, /providerId:/u)
      assert.match(providerMarkdown, /Labcorp/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider upsert rejects slug collisions against another provider id',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-provider-collision-'))
    const alphaPayloadPath = path.join(vaultRoot, 'provider-alpha.json')
    const betaPayloadPath = path.join(vaultRoot, 'provider-beta.json')
    const collisionPayloadPath = path.join(vaultRoot, 'provider-collision.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        alphaPayloadPath,
        JSON.stringify({
          title: 'Alpha Clinic',
          slug: 'alpha',
          status: 'active',
          body: '# Alpha Clinic\n',
        }),
        'utf8',
      )
      await writeFile(
        betaPayloadPath,
        JSON.stringify({
          title: 'Beta Clinic',
          slug: 'beta',
          status: 'active',
          body: '# Beta Clinic\n',
        }),
        'utf8',
      )

      const alpha = await runSliceCli<{ providerId: string }>([
        'provider',
        'upsert',
        '--input',
        `@${alphaPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const beta = await runSliceCli<{ providerId: string }>([
        'provider',
        'upsert',
        '--input',
        `@${betaPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(alpha.ok, true)
      assert.equal(beta.ok, true)

      await writeFile(
        collisionPayloadPath,
        JSON.stringify({
          providerId: requireData(alpha).providerId,
          title: 'Alpha Clinic Renamed',
          slug: 'beta',
          status: 'active',
          body: '# Alpha Clinic Renamed\n',
        }),
        'utf8',
      )

      const collision = await runSliceCli([
        'provider',
        'upsert',
        '--input',
        `@${collisionPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(collision.ok, false)
      assert.equal(collision.error?.code, 'conflict')
      assert.match(
        collision.error?.message ?? '',
        /Provider slug "beta" is already owned by/u,
      )

      const alphaMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/alpha.md'),
        'utf8',
      )
      const betaMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/beta.md'),
        'utf8',
      )

      assert.match(alphaMarkdown, new RegExp(requireData(alpha).providerId, 'u'))
      assert.match(alphaMarkdown, /title: "Alpha Clinic"/u)
      assert.match(betaMarkdown, new RegExp(requireData(beta).providerId, 'u'))
      assert.match(betaMarkdown, /title: "Beta Clinic"/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider upsert renames the provider document when the same provider id moves to a new slug',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-provider-rename-'))
    const initialPayloadPath = path.join(vaultRoot, 'provider-initial.json')
    const renamedPayloadPath = path.join(vaultRoot, 'provider-renamed.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        initialPayloadPath,
        JSON.stringify({
          title: 'Alpha Clinic',
          slug: 'alpha',
          status: 'active',
          body: '# Alpha Clinic\n',
        }),
        'utf8',
      )

      const created = await runSliceCli<{ providerId: string; path: string }>([
        'provider',
        'upsert',
        '--input',
        `@${initialPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(created.ok, true)

      await writeFile(
        renamedPayloadPath,
        JSON.stringify({
          providerId: requireData(created).providerId,
          title: 'Alpha Clinic Renamed',
          slug: 'beta',
          status: 'active',
          body: '# Alpha Clinic Renamed\n',
        }),
        'utf8',
      )

      const renamed = await runSliceCli<{ path: string; created: boolean }>([
        'provider',
        'upsert',
        '--input',
        `@${renamedPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(renamed.ok, true)
      assert.equal(requireData(renamed).path, 'bank/providers/beta.md')
      assert.equal(requireData(renamed).created, false)

      await access(path.join(vaultRoot, 'bank/providers/beta.md'))
      await assert.rejects(() => access(path.join(vaultRoot, 'bank/providers/alpha.md')))

      const renamedMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/beta.md'),
        'utf8',
      )
      assert.match(renamedMarkdown, new RegExp(requireData(created).providerId, 'u'))
      assert.match(renamedMarkdown, /Alpha Clinic Renamed/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food and recipe edit rename the underlying document when slug is patched',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-edit-rename-'))
    const foodPayloadPath = path.join(vaultRoot, 'food.json')
    const recipePayloadPath = path.join(vaultRoot, 'recipe.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Regular Acai Bowl',
          slug: 'regular-acai-bowl',
          status: 'active',
          note: 'Typical order.',
        }),
        'utf8',
      )
      await writeFile(
        recipePayloadPath,
        JSON.stringify({
          title: 'Sheet Pan Salmon Bowls',
          slug: 'sheet-pan-salmon-bowls',
          status: 'saved',
          ingredients: ['2 salmon fillets'],
          steps: ['Roast the salmon.'],
        }),
        'utf8',
      )

      const foodCreated = await runSliceCli<{ foodId: string }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const recipeCreated = await runSliceCli<{ recipeId: string }>([
        'recipe',
        'upsert',
        '--input',
        `@${recipePayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodCreated.ok, true)
      assert.equal(recipeCreated.ok, true)

      const foodEdited = await runSliceCli<{
        entity: {
          id: string
          path: string | null
        }
      }>([
        'food',
        'edit',
        requireData(foodCreated).foodId,
        '--set',
        'slug=protein-acai-bowl',
        '--vault',
        vaultRoot,
      ])
      const recipeEdited = await runSliceCli<{
        entity: {
          id: string
          path: string | null
        }
      }>([
        'recipe',
        'edit',
        requireData(recipeCreated).recipeId,
        '--set',
        'slug=sheet-pan-salmon-skillet',
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodEdited.ok, true)
      assert.equal(
        requireData(foodEdited).entity.path,
        'bank/foods/protein-acai-bowl.md',
      )
      await access(path.join(vaultRoot, 'bank/foods/protein-acai-bowl.md'))
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/foods/regular-acai-bowl.md')))

      assert.equal(recipeEdited.ok, true)
      assert.equal(
        requireData(recipeEdited).entity.path,
        'bank/recipes/sheet-pan-salmon-skillet.md',
      )
      await access(path.join(vaultRoot, 'bank/recipes/sheet-pan-salmon-skillet.md'))
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/recipes/sheet-pan-salmon-bowls.md')))
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food and recipe edit accept input payload files while preserving canonical ids',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-edit-input-'))
    const foodPayloadPath = path.join(vaultRoot, 'food.json')
    const recipePayloadPath = path.join(vaultRoot, 'recipe.json')
    const foodEditPath = path.join(vaultRoot, 'food-edit.json')
    const recipeEditPath = path.join(vaultRoot, 'recipe-edit.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Regular Acai Bowl',
          slug: 'regular-acai-bowl',
          status: 'active',
          note: 'Typical order.',
        }),
        'utf8',
      )
      await writeFile(
        recipePayloadPath,
        JSON.stringify({
          title: 'Sheet Pan Salmon Bowls',
          slug: 'sheet-pan-salmon-bowls',
          status: 'saved',
          summary: 'Weeknight salmon bowls.',
          ingredients: ['2 salmon fillets'],
          steps: ['Roast the salmon.'],
        }),
        'utf8',
      )

      const foodCreated = await runSliceCli<{ foodId: string }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const recipeCreated = await runSliceCli<{ recipeId: string }>([
        'recipe',
        'upsert',
        '--input',
        `@${recipePayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodCreated.ok, true)
      assert.equal(recipeCreated.ok, true)

      await writeFile(
        foodEditPath,
        JSON.stringify({
          foodId: 'food_PATCHATTEMPT1',
          title: 'Protein Acai Bowl',
          slug: 'protein-acai-bowl',
          note: 'Now with chia seeds.',
        }),
        'utf8',
      )
      await writeFile(
        recipeEditPath,
        JSON.stringify({
          recipeId: 'rcp_PATCHATTEMPT1',
          title: 'Sheet Pan Salmon Skillet',
          slug: 'sheet-pan-salmon-skillet',
          summary: 'Updated rotation dinner.',
          ingredients: ['2 salmon fillets', '1 lemon'],
          steps: ['Roast the salmon.', 'Finish with lemon juice.'],
        }),
        'utf8',
      )

      const foodEdited = await runSliceCli<{
        entity: {
          id: string
          path: string | null
          title: string | null
          data: {
            note?: string
          }
        }
      }>([
        'food',
        'edit',
        requireData(foodCreated).foodId,
        '--input',
        `@${foodEditPath}`,
        '--vault',
        vaultRoot,
      ])
      const recipeEdited = await runSliceCli<{
        entity: {
          id: string
          path: string | null
          title: string | null
          data: {
            summary?: string
          }
        }
      }>([
        'recipe',
        'edit',
        requireData(recipeCreated).recipeId,
        '--input',
        `@${recipeEditPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodEdited.ok, true)
      assert.equal(requireData(foodEdited).entity.id, requireData(foodCreated).foodId)
      assert.equal(requireData(foodEdited).entity.title, 'Protein Acai Bowl')
      assert.equal(
        requireData(foodEdited).entity.path,
        'bank/foods/protein-acai-bowl.md',
      )
      assert.equal(requireData(foodEdited).entity.data.note, 'Now with chia seeds.')
      await access(path.join(vaultRoot, 'bank/foods/protein-acai-bowl.md'))
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/foods/regular-acai-bowl.md')))

      assert.equal(recipeEdited.ok, true)
      assert.equal(requireData(recipeEdited).entity.id, requireData(recipeCreated).recipeId)
      assert.equal(requireData(recipeEdited).entity.title, 'Sheet Pan Salmon Skillet')
      assert.equal(
        requireData(recipeEdited).entity.path,
        'bank/recipes/sheet-pan-salmon-skillet.md',
      )
      assert.equal(
        requireData(recipeEdited).entity.data.summary,
        'Updated rotation dinner.',
      )
      await access(path.join(vaultRoot, 'bank/recipes/sheet-pan-salmon-skillet.md'))
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/recipes/sheet-pan-salmon-bowls.md')))

      const foodShown = await runSliceCli<{
        entity: {
          id: string
          path: string | null
        }
      }>([
        'food',
        'show',
        requireData(foodCreated).foodId,
        '--vault',
        vaultRoot,
      ])
      const recipeShown = await runSliceCli<{
        entity: {
          id: string
          path: string | null
        }
      }>([
        'recipe',
        'show',
        requireData(recipeCreated).recipeId,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodShown.ok, true)
      assert.equal(requireData(foodShown).entity.id, requireData(foodCreated).foodId)
      assert.equal(
        requireData(foodShown).entity.path,
        'bank/foods/protein-acai-bowl.md',
      )
      assert.equal(recipeShown.ok, true)
      assert.equal(requireData(recipeShown).entity.id, requireData(recipeCreated).recipeId)
      assert.equal(
        requireData(recipeShown).entity.path,
        'bank/recipes/sheet-pan-salmon-skillet.md',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'food and recipe edit preserve canonical ids when set and clear target the id fields',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-edit-id-boundary-'))
    const foodPayloadPath = path.join(vaultRoot, 'food.json')
    const recipePayloadPath = path.join(vaultRoot, 'recipe.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Regular Acai Bowl',
          slug: 'regular-acai-bowl',
          status: 'active',
          note: 'Typical order.',
        }),
        'utf8',
      )
      await writeFile(
        recipePayloadPath,
        JSON.stringify({
          title: 'Sheet Pan Salmon Bowls',
          slug: 'sheet-pan-salmon-bowls',
          status: 'saved',
          summary: 'Weeknight salmon bowls.',
          ingredients: ['2 salmon fillets'],
          steps: ['Roast the salmon.'],
        }),
        'utf8',
      )

      const foodCreated = await runSliceCli<{ foodId: string }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const recipeCreated = await runSliceCli<{ recipeId: string }>([
        'recipe',
        'upsert',
        '--input',
        `@${recipePayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodCreated.ok, true)
      assert.equal(recipeCreated.ok, true)

      const attemptedFoodId = 'food_PATCHATTEMPT2'
      const attemptedRecipeId = 'rcp_PATCHATTEMPT2'

      const foodEdited = await runSliceCli<{
        entity: {
          id: string
          title: string | null
          data: {
            note?: string
          }
        }
      }>([
        'food',
        'edit',
        requireData(foodCreated).foodId,
        '--set',
        `foodId=${attemptedFoodId}`,
        '--set',
        'title=Protein Acai Bowl',
        '--clear',
        'foodId',
        '--clear',
        'note',
        '--vault',
        vaultRoot,
      ])
      const recipeEdited = await runSliceCli<{
        entity: {
          id: string
          title: string | null
          data: {
            summary?: string
          }
        }
      }>([
        'recipe',
        'edit',
        requireData(recipeCreated).recipeId,
        '--set',
        `recipeId=${attemptedRecipeId}`,
        '--set',
        'title=Sheet Pan Salmon Skillet',
        '--clear',
        'recipeId',
        '--clear',
        'summary',
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodEdited.ok, true)
      assert.equal(requireData(foodEdited).entity.id, requireData(foodCreated).foodId)
      assert.equal(requireData(foodEdited).entity.title, 'Protein Acai Bowl')
      assert.equal(requireData(foodEdited).entity.data.note, undefined)

      assert.equal(recipeEdited.ok, true)
      assert.equal(requireData(recipeEdited).entity.id, requireData(recipeCreated).recipeId)
      assert.equal(requireData(recipeEdited).entity.title, 'Sheet Pan Salmon Skillet')
      assert.equal(requireData(recipeEdited).entity.data.summary, undefined)

      const foodShown = await runSliceCli<{
        entity: {
          id: string
          title: string | null
        }
      }>([
        'food',
        'show',
        requireData(foodCreated).foodId,
        '--vault',
        vaultRoot,
      ])
      const recipeShown = await runSliceCli<{
        entity: {
          id: string
          title: string | null
        }
      }>([
        'recipe',
        'show',
        requireData(recipeCreated).recipeId,
        '--vault',
        vaultRoot,
      ])
      const foodAttemptedReplacement = await runSliceCli([
        'food',
        'show',
        attemptedFoodId,
        '--vault',
        vaultRoot,
      ])
      const recipeAttemptedReplacement = await runSliceCli([
        'recipe',
        'show',
        attemptedRecipeId,
        '--vault',
        vaultRoot,
      ])

      assert.equal(foodShown.ok, true)
      assert.equal(requireData(foodShown).entity.id, requireData(foodCreated).foodId)
      assert.equal(requireData(foodShown).entity.title, 'Protein Acai Bowl')
      assert.equal(recipeShown.ok, true)
      assert.equal(requireData(recipeShown).entity.id, requireData(recipeCreated).recipeId)
      assert.equal(requireData(recipeShown).entity.title, 'Sheet Pan Salmon Skillet')

      assert.equal(foodAttemptedReplacement.ok, false)
      assert.equal(foodAttemptedReplacement.error.code, 'not_found')
      assert.equal(recipeAttemptedReplacement.ok, false)
      assert.equal(recipeAttemptedReplacement.error.code, 'not_found')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider edit keeps templated markdown body aligned with note updates and body resets',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-provider-body-sync-'))
    const providerPayloadPath = path.join(vaultRoot, 'provider.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        providerPayloadPath,
        JSON.stringify({
          title: 'Labcorp',
          slug: 'labcorp',
          status: 'active',
          note: 'Primary lab partner.',
        }),
        'utf8',
      )

      const created = await runSliceCli<{ providerId: string; path: string }>([
        'provider',
        'upsert',
        '--input',
        `@${providerPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(created.ok, true)

      const noteEdited = await runSliceCli<{
        entity: {
          path: string | null
          data: {
            note?: string
          }
        }
      }>([
        'provider',
        'edit',
        requireData(created).providerId,
        '--set',
        'note=Updated lab note.',
        '--vault',
        vaultRoot,
      ])

      assert.equal(noteEdited.ok, true)
      assert.equal(requireData(noteEdited).entity.data.note, 'Updated lab note.')

      const editedMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/labcorp.md'),
        'utf8',
      )
      assert.match(editedMarkdown, /Updated lab note\./u)
      assert.doesNotMatch(editedMarkdown, /Primary lab partner\./u)

      const titleEdited = await runSliceCli<{
        entity: {
          title: string | null
        }
      }>([
        'provider',
        'edit',
        requireData(created).providerId,
        '--set',
        'title="Labcorp West"',
        '--vault',
        vaultRoot,
      ])

      assert.equal(titleEdited.ok, true)
      assert.equal(requireData(titleEdited).entity.title, 'Labcorp West')

      const retitledMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/labcorp.md'),
        'utf8',
      )
      assert.match(retitledMarkdown, /^# Labcorp West$/mu)
      assert.doesNotMatch(retitledMarkdown, /^# Labcorp$/mu)

      const bodyReset = await runSliceCli<{
        entity: {
          data: {
            note?: string
          }
        }
      }>([
        'provider',
        'edit',
        requireData(created).providerId,
        '--clear',
        'body',
        '--vault',
        vaultRoot,
      ])

      assert.equal(bodyReset.ok, true)
      assert.equal(requireData(bodyReset).entity.data.note, 'Updated lab note.')

      const resetMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/labcorp.md'),
        'utf8',
      )
      assert.match(resetMarkdown, /## Notes/u)
      assert.match(resetMarkdown, /Updated lab note\./u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider, food, recipe, and event edit/delete mutate existing records and remove them cleanly',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-record-mutations-'))
    const providerPayloadPath = path.join(vaultRoot, 'provider.json')
    const foodPayloadPath = path.join(vaultRoot, 'food.json')
    const recipePayloadPath = path.join(vaultRoot, 'recipe.json')
    const eventPayloadPath = path.join(vaultRoot, 'event.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        providerPayloadPath,
        JSON.stringify({
          title: 'Labcorp',
          slug: 'labcorp',
          status: 'active',
          specialty: 'lab',
          website: 'https://labcorp.example.test',
          body: '# Labcorp\n',
        }),
        'utf8',
      )
      await writeFile(
        foodPayloadPath,
        JSON.stringify({
          title: 'Regular Acai Bowl',
          slug: 'regular-acai-bowl',
          status: 'active',
          vendor: 'Neighborhood Acai Bar',
          aliases: ['regular acai bowl', 'usual acai bowl'],
          tags: ['breakfast'],
          note: 'Typical order.',
          autoLogDaily: {
            time: '08:00',
          },
        }),
        'utf8',
      )
      await writeFile(
        recipePayloadPath,
        JSON.stringify({
          title: 'Sheet Pan Salmon Bowls',
          slug: 'sheet-pan-salmon-bowls',
          status: 'saved',
          summary: 'Weeknight salmon bowls.',
          ingredients: ['2 salmon fillets'],
          steps: ['Roast the salmon.'],
        }),
        'utf8',
      )
      await writeFile(
        eventPayloadPath,
        JSON.stringify({
          kind: 'symptom',
          occurredAt: '2026-03-12T08:15:00.000Z',
          title: 'Morning headache',
          symptom: 'headache',
          intensity: 4,
          note: 'Resolved after breakfast.',
          tags: ['symptom'],
        }),
        'utf8',
      )

      const providerUpsert = await runSliceCli<{ providerId: string }>([
        'provider',
        'upsert',
        '--input',
        `@${providerPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const foodUpsert = await runSliceCli<{ foodId: string }>([
        'food',
        'upsert',
        '--input',
        `@${foodPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const recipeUpsert = await runSliceCli<{ recipeId: string }>([
        'recipe',
        'upsert',
        '--input',
        `@${recipePayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const eventUpsert = await runSliceCli<{ eventId: string }>([
        'event',
        'upsert',
        '--input',
        `@${eventPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(providerUpsert.ok, true)
      assert.equal(foodUpsert.ok, true)
      assert.equal(recipeUpsert.ok, true)
      assert.equal(eventUpsert.ok, true)

      const providerEdit = await runSliceCli<{
        entity: {
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'provider',
        'edit',
        requireData(providerUpsert).providerId,
        '--set',
        'title=Labcorp West',
        '--clear',
        'website',
        '--vault',
        vaultRoot,
      ])
      assert.equal(providerEdit.ok, true)
      assert.equal(providerEdit.meta?.command, 'provider edit')
      assert.equal(requireData(providerEdit).entity.title, 'Labcorp West')
      assert.equal(requireData(providerEdit).entity.data.website, undefined)

      const foodEdit = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'food',
        'edit',
        requireData(foodUpsert).foodId,
        '--set',
        'note=Now with chia seeds.',
        '--set',
        'tags=[\"breakfast\",\"protein\"]',
        '--clear',
        'aliases.0',
        '--clear',
        'autoLogDaily.time',
        '--vault',
        vaultRoot,
      ])
      assert.equal(foodEdit.ok, true)
      assert.equal(foodEdit.meta?.command, 'food edit')
      assert.equal(requireData(foodEdit).entity.data.note, 'Now with chia seeds.')
      assert.deepEqual(requireData(foodEdit).entity.data.aliases, ['usual acai bowl'])
      assert.deepEqual(requireData(foodEdit).entity.data.tags, ['breakfast', 'protein'])
      assert.equal(requireData(foodEdit).entity.data.autoLogDaily, undefined)

      const recipeEdit = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'recipe',
        'edit',
        requireData(recipeUpsert).recipeId,
        '--set',
        'summary=Updated rotation dinner.',
        '--clear',
        'ingredients',
        '--vault',
        vaultRoot,
      ])
      assert.equal(recipeEdit.ok, true)
      assert.equal(recipeEdit.meta?.command, 'recipe edit')
      assert.equal(requireData(recipeEdit).entity.data.summary, 'Updated rotation dinner.')
      assert.equal(requireData(recipeEdit).entity.data.ingredients, undefined)

      const eventEdit = await runSliceCli<{
        entity: {
          kind: string
          data: Record<string, unknown>
        }
      }>([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'note=Resolved after hydration.',
        '--set',
        'tags=[\"symptom\",\"resolved\"]',
        '--vault',
        vaultRoot,
      ])
      assert.equal(eventEdit.ok, true)
      assert.equal(eventEdit.meta?.command, 'event edit')
      assert.equal(requireData(eventEdit).entity.kind, 'symptom')
      assert.equal(requireData(eventEdit).entity.data.note, 'Resolved after hydration.')
      assert.deepEqual(requireData(eventEdit).entity.data.tags, ['symptom', 'resolved'])

      const eventDelete = await runSliceCli<DeleteEnvelope>([
        'event',
        'delete',
        requireData(eventUpsert).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(eventDelete.ok, true)
      assert.equal(requireData(eventDelete).kind, 'symptom')

      const recipeDelete = await runSliceCli<DeleteEnvelope>([
        'recipe',
        'delete',
        requireData(recipeUpsert).recipeId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(recipeDelete.ok, true)
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/recipes/sheet-pan-salmon-bowls.md')))

      const foodDelete = await runSliceCli<DeleteEnvelope>([
        'food',
        'delete',
        requireData(foodUpsert).foodId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(foodDelete.ok, true)
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/foods/regular-acai-bowl.md')))

      const providerDelete = await runSliceCli<DeleteEnvelope>([
        'provider',
        'delete',
        requireData(providerUpsert).providerId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(providerDelete.ok, true)
      await assert.rejects(() =>
        access(path.join(vaultRoot, 'bank/providers/labcorp.md')))

      const missingEvent = await runSliceCli([
        'event',
        'show',
        requireData(eventUpsert).eventId,
        '--vault',
        vaultRoot,
      ])
      const missingRecipe = await runSliceCli([
        'recipe',
        'show',
        requireData(recipeUpsert).recipeId,
        '--vault',
        vaultRoot,
      ])
      const missingFood = await runSliceCli([
        'food',
        'show',
        requireData(foodUpsert).foodId,
        '--vault',
        vaultRoot,
      ])
      const missingProvider = await runSliceCli([
        'provider',
        'show',
        requireData(providerUpsert).providerId,
        '--vault',
        vaultRoot,
      ])

      assert.equal(missingEvent.ok, false)
      assert.equal(missingEvent.error?.code, 'not_found')
      assert.equal(missingRecipe.ok, false)
      assert.equal(missingRecipe.error?.code, 'not_found')
      assert.equal(missingFood.ok, false)
      assert.equal(missingFood.error?.code, 'not_found')
      assert.equal(missingProvider.ok, false)
      assert.equal(missingProvider.error?.code, 'not_found')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'event edit requires an explicit dayKey policy for temporal edits and keeps fallback timezones out of legacy records',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-timezone-edit-'))
    const eventPayloadPath = path.join(vaultRoot, 'event.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot, '--timezone', 'Australia/Melbourne'])

      await writeFile(
        eventPayloadPath,
        JSON.stringify({
          kind: 'symptom',
          occurredAt: '2026-03-26T21:00:00.000Z',
          title: 'Breakfast headache',
          symptom: 'headache',
          intensity: 4,
        }),
        'utf8',
      )

      const eventUpsert = await runSliceCli<{ eventId: string }>([
        'event',
        'upsert',
        '--input',
        `@${eventPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(eventUpsert.ok, true)

      const missingPolicy = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T01:30:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(missingPolicy.ok, false)
      assert.match(
        missingPolicy.error?.message ?? '',
        /requires an explicit local-day choice/u,
      )

      const policyWithoutTemporalEdit = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'title="Retitled headache"',
        '--day-key-policy',
        'keep',
        '--vault',
        vaultRoot,
      ])
      assert.equal(policyWithoutTemporalEdit.ok, false)
      assert.equal(policyWithoutTemporalEdit.error?.code, 'invalid_option')
      assert.match(
        policyWithoutTemporalEdit.error?.message ?? '',
        /only valid when occurredAt or timeZone changes/u,
      )

      const explicitDayKeyWithoutPolicy = await runSliceCli<{
        entity: {
          occurredAt: string | null
          data: Record<string, unknown>
        }
      }>([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T01:30:00.000Z',
        '--set',
        'dayKey=2026-03-26',
        '--vault',
        vaultRoot,
      ])
      assert.equal(explicitDayKeyWithoutPolicy.ok, true)
      assert.equal(
        requireData(explicitDayKeyWithoutPolicy).entity.occurredAt,
        '2026-03-27T01:30:00.000Z',
      )
      assert.equal(
        requireData(explicitDayKeyWithoutPolicy).entity.data.dayKey,
        '2026-03-26',
      )
      assert.equal(
        requireData(explicitDayKeyWithoutPolicy).entity.data.timeZone,
        undefined,
      )

      const conflictingPolicyAndDayKeyPatch = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T02:30:00.000Z',
        '--set',
        'dayKey=2026-03-27',
        '--day-key-policy',
        'keep',
        '--vault',
        vaultRoot,
      ])
      assert.equal(conflictingPolicyAndDayKeyPatch.ok, false)
      assert.equal(conflictingPolicyAndDayKeyPatch.error?.code, 'invalid_payload')
      assert.match(
        conflictingPolicyAndDayKeyPatch.error?.message ?? '',
        /Choose either --day-key-policy or an explicit dayKey patch/u,
      )

      const nullDayKeyPatch = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T03:00:00.000Z',
        '--set',
        'dayKey=null',
        '--vault',
        vaultRoot,
      ])
      assert.equal(nullDayKeyPatch.ok, false)
      assert.equal(nullDayKeyPatch.error?.code, 'invalid_payload')
      assert.match(
        nullDayKeyPatch.error?.message ?? '',
        /direct dayKey patch must be a concrete YYYY-MM-DD value/u,
      )

      const invalidDayKeyPatch = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T03:15:00.000Z',
        '--set',
        'dayKey=not-a-date',
        '--vault',
        vaultRoot,
      ])
      assert.equal(invalidDayKeyPatch.ok, false)
      assert.equal(invalidDayKeyPatch.error?.code, 'invalid_payload')
      assert.match(
        invalidDayKeyPatch.error?.message ?? '',
        /direct dayKey patch must be a concrete YYYY-MM-DD value/u,
      )

      const recomputeWithoutExplicitTimeZone = await runSliceCli([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T03:30:00.000Z',
        '--day-key-policy',
        'recompute',
        '--vault',
        vaultRoot,
      ])
      assert.equal(recomputeWithoutExplicitTimeZone.ok, false)
      assert.match(
        recomputeWithoutExplicitTimeZone.error?.message ?? '',
        /Cannot recompute dayKey without an explicit timeZone/u,
      )

      const keepDayKey = await runSliceCli<{
        entity: {
          occurredAt: string | null
          data: Record<string, unknown>
        }
      }>([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'occurredAt=2026-03-27T04:30:00.000Z',
        '--day-key-policy',
        'keep',
        '--vault',
        vaultRoot,
      ])
      assert.equal(keepDayKey.ok, true)
      assert.equal(requireData(keepDayKey).entity.occurredAt, '2026-03-27T04:30:00.000Z')
      assert.equal(requireData(keepDayKey).entity.data.dayKey, '2026-03-26')
      assert.equal(requireData(keepDayKey).entity.data.timeZone, undefined)

      const setExplicitTimeZoneAndRecompute = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'event',
        'edit',
        requireData(eventUpsert).eventId,
        '--set',
        'timeZone=America/New_York',
        '--day-key-policy',
        'recompute',
        '--vault',
        vaultRoot,
      ])
      assert.equal(setExplicitTimeZoneAndRecompute.ok, true)
      assert.equal(requireData(setExplicitTimeZoneAndRecompute).entity.data.timeZone, 'America/New_York')
      assert.equal(requireData(setExplicitTimeZoneAndRecompute).entity.data.dayKey, '2026-03-27')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
