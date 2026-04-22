import {
  FOOD_STATUSES,
  RECIPE_STATUSES,
} from '@murphai/contracts'
import { z } from 'zod'
import type { AssistantToolContext } from '../shared.js'
import { defineVaultServiceBackedTool } from '../definition-factory.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
const optionalStringArraySchema = z.array(z.string().min(1)).optional()
const wearableMetricSchema = z.string().min(1)

async function executeVaultQueryMethod<TResult>(
  input: AssistantToolContext,
  methodName: string,
  methodInput: Record<string, unknown>,
): Promise<TResult> {
  const candidate = (
    input.vaultServices?.query as Record<string, unknown> | undefined
  )?.[methodName]

  if (typeof candidate !== 'function') {
    throw new Error(`Missing vault query service method ${methodName}`)
  }

  return (
    candidate as (runtimeInput: Record<string, unknown>) => Promise<TResult>
  )(methodInput)
}

export function createVaultQueryToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return [
    defineVaultServiceBackedTool({
      name: 'vault.show',
      description:
        'Show one canonical record or document by its canonical read id. Use this to inspect an existing entity before deciding how to write related data.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'journal:2026-03-13',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.show({
          vault: input.vault,
          requestId: input.requestId ?? null,
          id,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.list',
      description:
        'List canonical records with query-layer filters. Use this to inspect existing records before choosing a write target.',
      inputSchema: z.object({
        recordType: optionalStringArraySchema,
        kind: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
        stream: optionalStringArraySchema,
        experiment: z.string().min(1).optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        tag: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        kind: 'goal',
        limit: 10,
      },
      execute: (filters) =>
        input.vaultServices!.query.list(
          {
            vault: input.vault,
            requestId: input.requestId ?? null,
            ...filters,
          } as Parameters<NonNullable<typeof input.vaultServices>['query']['list']>[0],
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.latest',
      description:
        'Show the normalized latest wearable bundle across connected providers. Prefer this as the first read for common "latest nightly metrics" or "how am I doing lately?" questions before raw wearable reads.',
      inputSchema: z.object({
        providers: optionalStringArraySchema,
      }),
      inputExample: {
        providers: ['oura'],
      },
      execute: ({ providers }) =>
        executeVaultQueryMethod(input, 'showWearableLatest', {
          vault: input.vault,
          requestId: input.requestId ?? null,
          providers,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.metric_latest',
      description:
        'Show the normalized latest reading for one wearable metric alias such as resting-heart-rate, hrv, or skin-temp. Prefer this before raw wearable record inspection for single-metric latest questions.',
      inputSchema: z.object({
        metric: wearableMetricSchema,
        providers: optionalStringArraySchema,
      }),
      inputExample: {
        metric: 'resting-heart-rate',
      },
      execute: ({ metric, providers }) =>
        executeVaultQueryMethod(input, 'showWearableMetricLatest', {
          vault: input.vault,
          requestId: input.requestId ?? null,
          metric,
          providers,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.metric_trend',
      description:
        'Show the normalized recent trend for one wearable metric alias. Prefer this before raw wearable record inspection for "is this trending up or down?" questions.',
      inputSchema: z.object({
        metric: wearableMetricSchema,
        providers: optionalStringArraySchema,
      }),
      inputExample: {
        metric: 'hrv',
      },
      execute: ({ metric, providers }) =>
        executeVaultQueryMethod(input, 'showWearableMetricTrend', {
          vault: input.vault,
          requestId: input.requestId ?? null,
          metric,
          providers,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.drift',
      description:
        'Explain recent wearable drift across the normalized surfaces so the assistant can answer "what changed?" questions before dropping down to raw wearable reads.',
      inputSchema: z.object({
        providers: optionalStringArraySchema,
      }),
      inputExample: {},
      execute: ({ providers }) =>
        executeVaultQueryMethod(input, 'showWearableDrift', {
          vault: input.vault,
          requestId: input.requestId ?? null,
          providers,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.day',
      description:
        'Show one semantic daily wearable mirror with deduplicated sleep, activity, and recovery summaries plus source-confidence details for that day.',
      inputSchema: z.object({
        date: localDateSchema,
        providers: optionalStringArraySchema,
      }),
      inputExample: {
        date: '2026-03-31',
      },
      execute: ({ date, providers }) =>
        input.vaultServices!.query.showWearableDay({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          providers,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.sleep',
      description:
        'List semantic daily sleep summaries with deduplicated provider selection and source-confidence details. Prefer this over raw sample reads when interpreting wearable sleep data.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        from: '2026-03-25',
        limit: 7,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableSleep({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.activity',
      description:
        'List semantic daily activity summaries with deduplicated workouts, steps, and source-confidence details across connected wearables.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        date: '2026-03-31',
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableActivity({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.body',
      description:
        'List semantic daily body-state summaries with deduplicated weight, body-fat, BMI, temperature, and source-confidence details.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        limit: 14,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableBodyState({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.recovery',
      description:
        'List semantic daily recovery summaries with deduplicated readiness, recovery, HRV, and temperature signals plus source-confidence details.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        from: '2026-03-25',
        limit: 7,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableRecovery({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.wearables.sources',
      description:
        'List wearable-source health, coverage, and freshness so the assistant can explain which providers are present and how much evidence each source contributes.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        limit: 10,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableSources({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 10,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.recipe.show',
      description:
        'Show one remembered recipe by canonical recipe id or slug.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'sheet-pan-salmon-bowls',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.showRecipe({
          vault: input.vault,
          requestId: input.requestId ?? null,
          lookup: id,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.recipe.list',
      description:
        'List remembered recipe records with an optional recipe status filter.',
      inputSchema: z.object({
        status: z.enum(RECIPE_STATUSES).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        status: 'saved',
        limit: 10,
      },
      execute: ({ status, limit }) =>
        input.vaultServices!.query.listRecipes({
          vault: input.vault,
          requestId: input.requestId ?? null,
          status,
          limit: limit ?? 10,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.food.show',
      description:
        'Show one remembered food by canonical food id or slug.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'regular-acai-bowl',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.showFood({
          vault: input.vault,
          requestId: input.requestId ?? null,
          lookup: id,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.food.list',
      description:
        'List remembered regular foods with an optional status filter.',
      inputSchema: z.object({
        status: z.enum(FOOD_STATUSES).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        status: 'active',
        limit: 10,
      },
      execute: ({ status, limit }) =>
        input.vaultServices!.query.listFoods({
          vault: input.vault,
          requestId: input.requestId ?? null,
          status,
          limit: limit ?? 10,
        }),
    }),
  ]
}
