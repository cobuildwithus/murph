import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listAssistantCronJobs } from '../src/assistant/cron.js'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerEventCommands } from '../src/commands/event.js'
import { registerFoodCommands } from '../src/commands/food.js'
import { registerProviderCommands } from '../src/commands/provider.js'
import { registerRecipeCommands } from '../src/commands/recipe.js'
import { registerSamplesCommands } from '../src/commands/samples.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultCliServices } from '../src/vault-cli-services.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'provider/food/recipe/event/samples slice test cli',
    version: '0.0.0-test',
  })
  const services = createIntegratedVaultCliServices()

  registerVaultCommands(cli, services)
  registerProviderCommands(cli, services)
  registerFoodCommands(cli, services)
  registerRecipeCommands(cli, services)
  registerEventCommands(cli, services)
  registerSamplesCommands(cli, services)

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

test.sequential(
  'recipe scaffold/upsert/show/list work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-recipe-'))
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
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-food-'))
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
  'food schedule creates a remembered food plus a daily auto-log job while keeping add-daily as a compatibility alias',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-food-daily-'))

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
      const legacyAlias = await runSliceCli<{
        foodId: string
        path: string
        created: boolean
        time: string
        jobId: string
      }>([
        'food',
        'add-daily',
        'Second Smoothie',
        '--time',
        '09:00',
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

      assert.equal(legacyAlias.ok, true, JSON.stringify(legacyAlias))
      assert.equal(legacyAlias.meta?.command, 'food add-daily')
      assert.match(requireData(legacyAlias).foodId, /^food_/u)
      assert.equal(requireData(legacyAlias).time, '09:00')

      assert.equal(jobs.length, 2)
      assert.equal(jobs[0]?.jobId, requireData(foodSchedule).jobId)
      assert.equal(jobs[0]?.name, 'food-daily:morning-smoothie')
      assert.equal(jobs[0]?.schedule.kind, 'cron')
      assert.equal(jobs[0]?.schedule.expression, '0 8 * * *')
      assert.deepEqual(jobs[0]?.foodAutoLog, {
        foodId: requireData(foodSchedule).foodId,
      })
      assert.equal(jobs[1]?.jobId, requireData(legacyAlias).jobId)
      assert.equal(jobs[1]?.name, 'food-daily:second-smoothie')

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
  'provider upsert/show/list, event upsert/show/list, and samples add work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-'))
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
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-collision-'))
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
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-rename-'))
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
