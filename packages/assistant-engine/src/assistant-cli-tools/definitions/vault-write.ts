import {
  EXPERIMENT_STATUSES,
  eventSourceSchema,
  mealNutritionSchema,
  type MealNutrition,
} from '@murphai/contracts'
import {
  healthEntityDescriptors,
  hasHealthCommandDescriptor,
  type HealthCoreUpsertServiceMethodName,
} from '@murphai/vault-usecases'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { z } from 'zod'
import {
  withAssistantPayloadFile,
} from '../execution-adapters.js'
import type {
  AssistantToolCatalogOptions,
  AssistantToolContext,
} from '../shared.js'
import {
  defineDescriptorGeneratedTool,
  defineVaultServiceBackedTool,
} from '../definition-factory.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
const isoTimestampSchema = z.string().min(1)
const vaultFilePathSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const healthJsonImportCommandNames = new Set([
  'allergy',
  'blood-test',
  'condition',
  'family',
  'genetics',
  'goal',
])
const mealIngredientSchema = z.string().trim().min(1).max(4000)
const mealIngredientsSchema = z
  .array(mealIngredientSchema)
  .max(100)

const captureEntrySchema = z.object({
  media: z.array(vaultFilePathSchema).min(1).max(20),
  label: z.string().trim().min(1).max(160).optional(),
  bodySite: z.string().trim().min(1).max(400).optional(),
  collection: z.string().trim().min(1).max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().min(1).max(4000).optional(),
  occurredAt: isoTimestampSchema.optional(),
  source: eventSourceSchema.optional(),
})

function assertMealAddInputHasContent(input: {
  photo?: string
  audio?: string
  note?: string
  ingredients?: string[]
  nutrition?: MealNutrition
}) {
  const hasTrimmedNote = typeof input.note === 'string' && input.note.trim().length > 0
  const hasIngredients = Array.isArray(input.ingredients) && input.ingredients.length > 0
  const hasNutrition =
    input.nutrition !== undefined &&
    (Object.keys(input.nutrition.totals ?? {}).length > 0 ||
      Object.keys(input.nutrition.provenance ?? {}).length > 0)
  if (input.photo || input.audio || hasTrimmedNote || hasIngredients || hasNutrition) {
    return
  }

  throw new Error('Provide at least one of photo, audio, note, ingredients, or nutrition.')
}

function invokeHealthUpsertMethod(
  core: Pick<
    NonNullable<AssistantToolContext['vaultServices']>['core'],
    HealthCoreUpsertServiceMethodName
  >,
  methodName: HealthCoreUpsertServiceMethodName,
  input: {
    vault: string
    requestId: string | null
    input: string
  },
): Promise<unknown> {
  return core[methodName](input)
}

function healthJsonImportToolName(commandName: string) {
  return healthJsonImportCommandNames.has(commandName)
    ? `vault.${commandName}.importJson`
    : `vault.${commandName}.upsert`
}

function healthJsonImportToolDescription(descriptor: {
  command: {
    commandName: string
    descriptions: {
      upsert: string
    }
  }
  noun: string
}) {
  if (!healthJsonImportCommandNames.has(descriptor.command.commandName)) {
    return descriptor.command.descriptions.upsert
  }

  return `Import one ${descriptor.noun} from a JSON payload file or stdin.`
}

export function createCanonicalVaultWriteToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  if (!input.vaultServices) {
    return []
  }

  const tools = [
    defineVaultServiceBackedTool({
      name: 'vault.document.import',
      description:
        'Import one file into canonical document storage. Pass an absolute path or a vault-relative path copied into the vault.',
      inputSchema: z.object({
        file: vaultFilePathSchema,
        title: z.string().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
        note: z.string().min(1).optional(),
        source: eventSourceSchema.optional(),
      }),
      inputExample: {
        file: 'raw/inbox/captures/cap_123/attachments/1/report.pdf',
        source: 'import',
      },
      execute: async ({ file, title, occurredAt, note, source }) =>
        input.vaultServices!.importers.importDocument({
          vault: input.vault,
          requestId: input.requestId ?? null,
          file: await resolveAssistantVaultPath(input.vault, file, 'file path'),
          title,
          occurredAt,
          note,
          source,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.capture.add',
      description:
        'Create dated media captures from photos, videos, or similar evidence. Use one capture per observed thing/timepoint; pass multiple captures when the user sends a batch such as separate mole photos with labels/body sites. This records context only and does not diagnose the media.',
      inputSchema: z.object({
        collection: z.string().trim().min(1).max(160).optional(),
        tags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
        occurredAt: isoTimestampSchema.optional(),
        source: eventSourceSchema.optional(),
        captures: z.array(captureEntrySchema).min(1).max(100),
      }),
      inputExample: {
        collection: 'skin-check-2026-04',
        tags: ['mole', 'dermatology'],
        captures: [
          {
            media: ['raw/inbox/captures/cap_123/attachments/1/left-forearm.jpg'],
            label: 'mole-left-forearm-1',
            bodySite: 'Left forearm, dorsal side, about 8cm below elbow',
          },
        ],
      },
      execute: async ({ collection, tags, occurredAt, source, captures }) =>
        input.vaultServices!.core.addCapture({
          vault: input.vault,
          requestId: input.requestId ?? null,
          collection,
          tags,
          occurredAt,
          source,
          captures: await Promise.all(
            captures.map(async (capture) => ({
              ...capture,
              media: await Promise.all(
                capture.media.map((file) =>
                  resolveAssistantVaultPath(input.vault, file, 'file path'),
                ),
              ),
            })),
          ),
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.meal.add',
      description:
        'Create one canonical meal record from any combination of photo, audio note, text note, ingredients, and nutrition. Photo-only, note-only, and structured-only meals are allowed. Use structured ingredients and nutrition when you can recover them, and keep leftover context in the note.',
      inputSchema: z.object({
        photo: vaultFilePathSchema.optional(),
        audio: vaultFilePathSchema.optional(),
        note: z.string().trim().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
        source: eventSourceSchema.optional(),
        ingredients: mealIngredientsSchema.optional(),
        nutrition: mealNutritionSchema.optional(),
      }).refine(
        (value) =>
          Boolean(
            value.photo ||
              value.audio ||
              value.note ||
              value.ingredients?.length ||
              (value.nutrition &&
                (Object.keys(value.nutrition.totals ?? {}).length > 0 ||
                  Object.keys(value.nutrition.provenance ?? {}).length > 0)),
          ),
        {
          message:
            'Provide at least one of photo, audio, note, ingredients, or nutrition.',
        },
      ),
      inputExample: {
        note: 'Only ate the sweet potatoes and green beans from the pictured meal.',
        occurredAt: '2026-04-08T18:15:00Z',
        source: 'manual',
        ingredients: ['sweet potatoes', 'green beans'],
        nutrition: {
          totals: {
            calories: 180,
            carbsGrams: 33,
            fiberGrams: 7,
          },
          provenance: {
            source: 'estimated',
            confidence: 'medium',
            sourceDetail: 'Estimated from the photo and note.',
          },
        },
      },
      execute: async ({
        photo,
        audio,
        note,
        occurredAt,
        source,
        ingredients,
        nutrition,
      }) => {
        assertMealAddInputHasContent({ photo, audio, note, ingredients, nutrition })

        return input.vaultServices!.core.addMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          ...(photo
            ? {
                photo: await resolveAssistantVaultPath(input.vault, photo, 'file path'),
              }
            : {}),
          ...(audio
            ? {
                audio: await resolveAssistantVaultPath(input.vault, audio, 'file path'),
              }
            : {}),
          note,
          occurredAt,
          source,
          ingredients,
          nutrition,
        })
      },
    }),
    defineVaultServiceBackedTool({
      name: 'vault.journal.ensure',
      description:
        'Ensure the canonical journal page for one date exists.',
      inputSchema: z.object({
        date: localDateSchema,
      }),
      inputExample: {
        date: '2026-03-13',
      },
      execute: ({ date }) =>
        input.vaultServices!.core.ensureJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.journal.append',
      description:
        'Append one freeform markdown note block to the canonical journal page for a date.',
      inputSchema: z.object({
        date: localDateSchema,
        text: z.string().min(1),
      }),
      inputExample: {
        date: '2026-03-13',
        text: 'Workout: 30 minute zone 2 ride.',
      },
      execute: ({ date, text }) =>
        input.vaultServices!.core.appendJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          text,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.experiment.create',
      description:
        'Create or reuse a canonical experiment page.',
      inputSchema: z.object({
        slug: z.string().min(1),
        title: z.string().min(1).optional(),
        hypothesis: z.string().min(1).optional(),
        startedOn: localDateSchema.optional(),
        status: z.enum(EXPERIMENT_STATUSES).optional(),
      }),
      inputExample: {
        slug: 'creatine-trial',
        title: 'Creatine Trial',
      },
      execute: ({ slug, title, hypothesis, startedOn, status }) =>
        input.vaultServices!.core.createExperiment({
          vault: input.vault,
          requestId: input.requestId ?? null,
          slug,
          title,
          hypothesis,
          startedOn,
          status,
        }),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.provider.importJson',
      description:
        'Import one provider record from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          providerId: 'prov_example',
          title: 'Example Provider',
        },
      },
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.provider.importJson',
          payload,
          (inputFile) =>
            input.vaultServices!.core.upsertProvider({
              vault: input.vault,
              requestId: input.requestId ?? null,
              inputFile,
            }),
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.recipe.importJson',
      description:
        'Import one recipe record from a JSON payload object so the vault can remember dishes, ingredients, and prep notes.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          title: 'Sheet Pan Salmon Bowls',
          status: 'saved',
          ingredients: ['2 salmon fillets', '2 cups cooked rice'],
          steps: ['Roast the salmon.', 'Serve over rice.'],
        },
      },
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.recipe.importJson',
          payload,
          (inputFile) =>
            input.vaultServices!.core.upsertRecipe({
              vault: input.vault,
              requestId: input.requestId ?? null,
              inputFile,
            }),
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.food.importJson',
      description:
        'Import one regular food record from a JSON payload object so the vault can remember recurring meals, snacks, bowls, smoothies, and grocery staples.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          title: 'Regular Acai Bowl',
          status: 'active',
          vendor: 'Neighborhood Acai Bar',
          ingredients: ['acai base', 'banana', 'granola'],
        },
      },
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.food.importJson',
          payload,
          (inputFile) =>
            input.vaultServices!.core.upsertFood({
              vault: input.vault,
              requestId: input.requestId ?? null,
              inputFile,
            }),
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.event.importJson',
      description:
        'Import one canonical event record from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          kind: 'note',
          occurredAt: '2026-03-13T10:00:00-07:00',
          title: 'Example event',
        },
      },
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.event.importJson',
          payload,
          (inputFile) =>
            input.vaultServices!.core.upsertEvent({
              vault: input.vault,
              requestId: input.requestId ?? null,
              inputFile,
            }),
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.samples.importJson',
      description:
        'Import one or more sample records from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          stream: 'body_weight',
          source: 'manual',
          quality: 'curated',
          samples: [],
        },
      },
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.samples.importJson',
          payload,
          (inputFile) =>
            input.vaultServices!.core.addSamples({
              vault: input.vault,
              requestId: input.requestId ?? null,
              inputFile,
            }),
        ),
    }),
    defineVaultServiceBackedTool({
      name: 'vault.intake.import',
      description:
        'Import one assessment response file into canonical intake storage.',
      inputSchema: z.object({
        file: vaultFilePathSchema,
      }),
      inputExample: {
        file: 'raw/inbox/captures/cap_123/attachments/1/assessment.json',
      },
      execute: async ({ file }) =>
        input.vaultServices!.importers.importAssessmentResponse({
          vault: input.vault,
          requestId: input.requestId ?? null,
          file: await resolveAssistantVaultPath(input.vault, file, 'file path'),
        }),
    }),
    ...createHealthJsonImportToolDefinitions(input),
  ]

  if (options.includeStatefulWriteTools ?? true) {
    return [
      ...tools,
      defineVaultServiceBackedTool({
        name: 'vault.intake.project',
        description:
          'Project one imported intake assessment into a typed proposal object without directly mutating the health registries.',
        inputSchema: z.object({
          assessmentId: z.string().min(1),
        }),
        inputExample: {
          assessmentId: 'asmt_example',
        },
        execute: ({ assessmentId }) =>
          input.vaultServices!.core.projectAssessment({
            vault: input.vault,
            requestId: input.requestId ?? null,
            assessmentId,
          }),
      }),
      defineVaultServiceBackedTool({
        name: 'vault.regimen.stop',
        description:
          'Stop an existing regimen while preserving its canonical id.',
        inputSchema: z.object({
          regimenId: z.string().min(1),
          stoppedOn: localDateSchema.optional(),
        }),
        inputExample: {
          regimenId: 'reg_example',
          stoppedOn: '2026-03-13',
        },
        execute: ({ regimenId, stoppedOn }) =>
          input.vaultServices!.core.stopRegimen({
            vault: input.vault,
            requestId: input.requestId ?? null,
            regimenId,
            stoppedOn,
          }),
      }),
    ]
  }

  return tools
}

export function createHealthJsonImportToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return healthEntityDescriptors
    .filter(hasHealthCommandDescriptor)
    .map((descriptor) => {
      const toolName = healthJsonImportToolName(descriptor.command.commandName)

      return defineDescriptorGeneratedTool({
        name: toolName,
        description: `${healthJsonImportToolDescription(descriptor)} The payload should follow the scaffold template for ${descriptor.command.commandName}.`,
        inputSchema: z.object({
          payload: jsonObjectSchema,
        }),
        inputExample: {
          payload: descriptor.core.payloadTemplate,
        },
        execute: ({ payload }): Promise<unknown> =>
          withAssistantPayloadFile(
            input.vault,
            toolName,
            payload,
            (inputFile) =>
              invokeHealthUpsertMethod(
                input.vaultServices!.core,
                descriptor.core.upsertServiceMethod,
                {
                  vault: input.vault,
                  requestId: input.requestId ?? null,
                  input: inputFile,
                },
              ),
          ),
      }, 'healthEntityDescriptors')
    })
}
