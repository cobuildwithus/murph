import { mkdir, open, writeFile } from 'node:fs/promises'
import { FOOD_STATUSES, RECIPE_STATUSES } from '@murph/contracts'
import { buildSharePackFromVault } from '@murph/core'
import path from 'node:path'
import { z } from 'zod'
import {
  assistantCronScheduleInputSchema,
  assistantMemoryLongTermSectionValues,
  assistantMemoryQueryScopeValues,
  assistantMemoryVisibleSectionValues,
  assistantMemoryWriteScopeValues,
} from './assistant-cli-contracts.js'
import {
  forgetAssistantMemory,
  getAssistantMemory,
  searchAssistantMemory,
  upsertAssistantMemory,
} from './assistant/memory.js'
import {
  deleteAssistantStateDocument,
  getAssistantStateDocument,
  listAssistantStateDocuments,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  redactAssistantStateDocumentListEntry,
  redactAssistantStateDocumentSnapshot,
} from './assistant/state.js'
import { redactAssistantDisplayPath } from './assistant/store.js'
import {
  healthEntityDescriptors,
  hasHealthCommandDescriptor,
} from './health-cli-descriptors.js'
import { resolveAssistantVaultPath } from './assistant-vault-paths.js'
import type { InboxServices } from './inbox-services.js'
import {
  createAssistantToolCatalog,
  type AssistantToolCatalog,
  defineAssistantTool,
} from './model-harness.js'
import {
  listAssistantSelfDeliveryTargets,
  resolveAssistantSelfDeliveryTarget,
} from './operator-config.js'
import { VaultCliError } from './vault-cli-errors.js'
import type { VaultServices } from './vault-services.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

const isoTimestampSchema = z.string().min(1)
const vaultFilePathSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const optionalStringArraySchema = z.array(z.string().min(1)).optional()
const shareEntitySelectorSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.id || value.slug), {
    message: 'Provide either an id or slug.',
  })
const assistantMemoryQueryScopeSchema = z.enum(assistantMemoryQueryScopeValues)
const assistantMemoryWriteScopeSchema = z.enum(assistantMemoryWriteScopeValues)
const assistantMemoryLongTermSectionSchema = z.enum(assistantMemoryLongTermSectionValues)
const assistantMemoryVisibleSectionSchema = z.enum(assistantMemoryVisibleSectionValues)
const assistantToolTextReadDefaultMaxChars = 8_000
const assistantToolTextReadMaxChars = 20_000
const assistantToolTextReadChunkBytes = 4_096


interface AssistantToolContext {
  captureId?: string
  inboxServices?: InboxServices
  requestId?: string | null
  vault: string
  vaultServices?: VaultServices
}

export interface AssistantToolCatalogOptions {
  includeAssistantRuntimeTools?: boolean
  includeQueryTools?: boolean
  includeStatefulWriteTools?: boolean
}

export function createDefaultAssistantToolCatalog(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolCatalog {
  return createAssistantToolCatalog([
    ...(options.includeAssistantRuntimeTools ?? true
      ? createAssistantRuntimeToolDefinitions(input, options)
      : []),
    ...createInboxPromotionToolDefinitions(input),
    ...(options.includeQueryTools ?? true ? createVaultQueryToolDefinitions(input) : []),
    ...createVaultWriteToolDefinitions(input, options),
  ])
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createDefaultAssistantToolCatalog(input, {
    includeAssistantRuntimeTools: false,
    includeQueryTools: false,
    includeStatefulWriteTools: false,
  })
}

async function loadAssistantCronTools() {
  return await import('./assistant/cron.js')
}

function createAssistantRuntimeToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  const readOnlyTools = [
    defineAssistantTool({
      name: 'vault.fs.readText',
      description:
        'Read one UTF-8 text file inside the active vault with bounded truncation. Use this for targeted inspection of parser outputs, markdown notes, or attachment-derived text artifacts when canonical query tools are not enough.',
      inputSchema: z.object({
        path: vaultFilePathSchema,
        maxChars: z.number().int().positive().max(assistantToolTextReadMaxChars).optional(),
      }),
      inputExample: {
        path: 'raw/inbox/captures/cap_123/attachments/1/parser/plain-text.txt',
      },
      execute: ({ path: candidatePath, maxChars }) =>
        readAssistantTextFile(input.vault, candidatePath, maxChars),
    }),
    defineAssistantTool({
      name: 'assistant.state.list',
      description:
        'List small non-canonical assistant scratch-state documents, optionally filtered by prefix.',
      inputSchema: z.object({
        prefix: z.string().min(1).optional(),
      }),
      inputExample: {
        prefix: 'cron/',
      },
      execute: async ({ prefix }) =>
        (await listAssistantStateDocuments({
          vault: input.vault,
          prefix,
        })).map((entry) => redactAssistantStateDocumentListEntry(entry)),
    }),
    defineAssistantTool({
      name: 'assistant.state.show',
      description:
        'Show one assistant scratch-state document by doc id.',
      inputSchema: z.object({
        docId: z.string().min(1),
      }),
      inputExample: {
        docId: 'cron/my-reminder',
      },
      execute: async ({ docId }) =>
        redactAssistantStateDocumentSnapshot(
          await getAssistantStateDocument({
            docId,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.memory.search',
      description:
        'Search assistant memory for prior preferences, naming, standing instructions, or durable health context.',
      inputSchema: z.object({
        text: z.string().min(1).optional(),
        scope: assistantMemoryQueryScopeSchema.optional(),
        section: assistantMemoryVisibleSectionSchema.optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      inputExample: {
        text: 'tone',
        limit: 5,
      },
      execute: ({ text, scope, section, limit }) =>
        searchAssistantMemory({
          vault: input.vault,
          text,
          scope,
          section: section ?? null,
          limit,
          includeSensitiveHealthContext: true,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.memory.get',
      description:
        'Show one assistant memory record by id.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'long-term:preferences%7Cslot%3Aassistant-style%3Atone',
      },
      execute: ({ id }) =>
        getAssistantMemory({
          id,
          vault: input.vault,
          includeSensitiveHealthContext: true,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.status',
      description:
        'Show the current assistant cron scheduler snapshot for the active vault.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).getAssistantCronStatus(input.vault),
    }),
    defineAssistantTool({
      name: 'assistant.cron.list',
      description:
        'List configured assistant cron jobs for the active vault.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).listAssistantCronJobs(input.vault),
    }),
    defineAssistantTool({
      name: 'assistant.cron.show',
      description:
        'Show one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).getAssistantCronJob(input.vault, job),
    }),
    defineAssistantTool({
      name: 'assistant.cron.runs',
      description:
        'List recent runs for one assistant cron job.',
      inputSchema: z.object({
        job: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      }),
      inputExample: {
        job: 'weekly-digest',
        limit: 10,
      },
      execute: async ({ job, limit }) =>
        (await loadAssistantCronTools()).listAssistantCronRuns({
          vault: input.vault,
          job,
          limit,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.list',
      description:
        'List built-in assistant cron presets.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).listAssistantCronPresets(),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.show',
      description:
        'Show one built-in assistant cron preset definition.',
      inputSchema: z.object({
        presetId: z.string().min(1),
      }),
      inputExample: {
        presetId: 'weekly-summary',
      },
      execute: async ({ presetId }) => (await loadAssistantCronTools()).getAssistantCronPreset(presetId),
    }),
    defineAssistantTool({
      name: 'assistant.selfTarget.list',
      description:
        'List saved outbound self-target routes such as email, Telegram, or phone delivery settings.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: () => listAssistantSelfDeliveryTargets(),
    }),
    defineAssistantTool({
      name: 'assistant.selfTarget.show',
      description:
        'Show the saved outbound self-target route for one channel.',
      inputSchema: z.object({
        channel: z.string().min(1),
      }),
      inputExample: {
        channel: 'telegram',
      },
      execute: ({ channel }) => resolveAssistantSelfDeliveryTarget(channel),
    }),
  ]

  if (!(options.includeStatefulWriteTools ?? true)) {
    return readOnlyTools
  }

  return [
    ...readOnlyTools,
    defineAssistantTool({
      name: 'assistant.state.put',
      description:
        'Replace one assistant scratch-state document with the provided JSON object.',
      inputSchema: z.object({
        docId: z.string().min(1),
        value: jsonObjectSchema,
      }),
      inputExample: {
        docId: 'cron/my-reminder',
        value: {
          snoozedUntil: '2026-03-31',
        },
      },
      execute: async ({ docId, value }) =>
        redactAssistantStateDocumentSnapshot(
          await putAssistantStateDocument({
            docId,
            value,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.state.patch',
      description:
        'Merge one JSON object patch into an existing assistant scratch-state document.',
      inputSchema: z.object({
        docId: z.string().min(1),
        patch: jsonObjectSchema,
      }),
      inputExample: {
        docId: 'cron/my-reminder',
        patch: {
          snoozedUntil: '2026-03-31',
        },
      },
      execute: async ({ docId, patch }) =>
        redactAssistantStateDocumentSnapshot(
          await patchAssistantStateDocument({
            docId,
            patch,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.state.delete',
      description:
        'Delete one assistant scratch-state document by doc id.',
      inputSchema: z.object({
        docId: z.string().min(1),
      }),
      inputExample: {
        docId: 'cron/my-reminder',
      },
      execute: async ({ docId }) => {
        const deleted = await deleteAssistantStateDocument({
          docId,
          vault: input.vault,
        })
        return {
          ...deleted,
          documentPath: redactAssistantDisplayPath(deleted.documentPath),
        }
      },
    }),
    defineAssistantTool({
      name: 'assistant.memory.upsert',
      description:
        'Upsert one assistant memory sentence into long-term or daily memory. Use this only when the user wants something remembered or a durable instruction clearly should persist.',
      inputSchema: z.object({
        text: z.string().min(1),
        scope: assistantMemoryWriteScopeSchema.optional(),
        section: assistantMemoryLongTermSectionSchema.optional(),
        allowSensitiveHealthContext: z.boolean().optional(),
      }),
      inputExample: {
        text: 'User prefers concise replies.',
        scope: 'long-term',
        section: 'Preferences',
      },
      execute: ({ allowSensitiveHealthContext, scope, section, text }) =>
        upsertAssistantMemory({
          vault: input.vault,
          text,
          scope,
          section: section ?? null,
          allowSensitiveHealthContext: allowSensitiveHealthContext ?? false,
          provenance: {
            writtenBy: 'assistant',
            sessionId: null,
            turnId: input.requestId ?? null,
          },
        }),
    }),
    defineAssistantTool({
      name: 'assistant.memory.forget',
      description:
        'Remove one assistant memory record by id when it is mistaken or obsolete.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'long-term:preferences%7Cslot%3Aassistant-style%3Atone',
      },
      execute: ({ id }) =>
        forgetAssistantMemory({
          id,
          vault: input.vault,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.add',
      description:
        'Create one assistant cron job with an explicit prompt and schedule.',
      inputSchema: z.object({
        name: z.string().min(1),
        prompt: z.string().min(1),
        schedule: assistantCronScheduleInputSchema,
        enabled: z.boolean().optional(),
        keepAfterRun: z.boolean().optional(),
        bindState: z.boolean().optional(),
        stateDocId: z.string().min(1).nullable().optional(),
      }),
      inputExample: {
        name: 'weekly-digest',
        prompt: 'Summarize the past week and propose one small next step.',
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
          timeZone: 'America/Los_Angeles',
        },
      },
      execute: async ({ bindState, enabled, keepAfterRun, name, prompt, schedule, stateDocId }) =>
        (await loadAssistantCronTools()).addAssistantCronJob({
          vault: input.vault,
          name,
          prompt,
          schedule,
          enabled,
          keepAfterRun,
          bindState,
          stateDocId: stateDocId ?? null,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.install',
      description:
        'Install one built-in assistant cron preset into the active vault with optional overrides.',
      inputSchema: z.object({
        presetId: z.string().min(1),
        name: z.string().min(1).optional(),
        schedule: assistantCronScheduleInputSchema.optional(),
        enabled: z.boolean().optional(),
        bindState: z.boolean().optional(),
        stateDocId: z.string().min(1).nullable().optional(),
        additionalInstructions: z.string().min(1).optional(),
        variables: z.record(z.string(), z.string().nullable()).optional(),
      }),
      inputExample: {
        presetId: 'weekly-summary',
      },
      execute: async ({
        additionalInstructions,
        bindState,
        enabled,
        name,
        presetId,
        schedule,
        stateDocId,
        variables,
      }) =>
        (await loadAssistantCronTools()).installAssistantCronPreset({
          vault: input.vault,
          presetId,
          name: name ?? null,
          schedule: schedule ?? null,
          enabled,
          bindState,
          stateDocId: stateDocId ?? null,
          additionalInstructions: additionalInstructions ?? null,
          variables: variables ?? null,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.enable',
      description:
        'Enable one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).setAssistantCronJobEnabled(input.vault, job, true),
    }),
    defineAssistantTool({
      name: 'assistant.cron.disable',
      description:
        'Disable one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).setAssistantCronJobEnabled(input.vault, job, false),
    }),
    defineAssistantTool({
      name: 'assistant.cron.remove',
      description:
        'Remove one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).removeAssistantCronJob(input.vault, job),
    }),
    defineAssistantTool({
      name: 'assistant.cron.runNow',
      description:
        'Run one assistant cron job immediately.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) =>
        (await loadAssistantCronTools()).runAssistantCronJobNow({
          vault: input.vault,
          job,
        }),
    }),
  ]
}

function createInboxPromotionToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.inboxServices || !input.captureId) {
    return []
  }

  const captureIdSchema = z.object({
    captureId: z.literal(input.captureId),
  })

  return [
    defineAssistantTool({
      name: 'inbox.promote.meal',
      description:
        'Promote the current inbox capture into canonical meal storage when the capture is primarily a meal, snack, or drink log anchored by an image.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.document',
      description:
        'Promote the current inbox capture into canonical document storage when the primary value is a PDF, report, scan, screenshot, form, or other stored document attachment.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteDocument({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.journal',
      description:
        'Promote the current inbox capture into the canonical journal day when it is best represented as a freeform note, workout note, symptom note, or reminder.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.experimentNote',
      description:
        'Promote the current inbox capture into one matching experiment page when the capture is clearly an experiment checkpoint or experiment note.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteExperimentNote({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
  ]
}

function createVaultQueryToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return [
    defineAssistantTool({
      name: 'vault.show',
      description:
        'Show one canonical record or document by its lookup id. Use this to inspect an existing entity before deciding how to write related data.',
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
    defineAssistantTool({
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
          } as Parameters<VaultServices['query']['list']>[0],
        ),
    }),
    defineAssistantTool({
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
    defineAssistantTool({
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
    defineAssistantTool({
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
    defineAssistantTool({
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

function createVaultWriteToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  if (!input.vaultServices) {
    return []
  }

  const tools = [
    defineAssistantTool({
      name: 'vault.document.import',
      description:
        'Import one file into canonical document storage. Pass an absolute path or a vault-relative path copied into the vault.',
      inputSchema: z.object({
        file: vaultFilePathSchema,
        title: z.string().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
        note: z.string().min(1).optional(),
        source: z.enum(['manual', 'import', 'device', 'derived']).optional(),
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
    defineAssistantTool({
      name: 'vault.meal.add',
      description:
        'Create one canonical meal record from a photo plus an optional audio note and optional text note. Use this for meals, snacks, and drink logs, preserving snack/drink context in the note when helpful.',
      inputSchema: z.object({
        photo: vaultFilePathSchema,
        audio: vaultFilePathSchema.optional(),
        note: z.string().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
      }),
      inputExample: {
        photo: 'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
        note: 'Post-workout meal',
      },
      execute: async ({ photo, audio, note, occurredAt }) =>
        input.vaultServices!.core.addMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          photo: await resolveAssistantVaultPath(input.vault, photo, 'file path'),
          audio: audio
            ? await resolveAssistantVaultPath(input.vault, audio, 'file path')
            : undefined,
          note,
          occurredAt,
        }),
    }),
    defineAssistantTool({
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
    defineAssistantTool({
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
    defineAssistantTool({
      name: 'vault.experiment.create',
      description:
        'Create or reuse a canonical experiment page.',
      inputSchema: z.object({
        slug: z.string().min(1),
        title: z.string().min(1).optional(),
        hypothesis: z.string().min(1).optional(),
        startedOn: localDateSchema.optional(),
        status: z.string().min(1).optional(),
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
    defineAssistantTool({
      name: 'vault.provider.upsert',
      description:
        'Upsert one provider record from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          providerId: 'prov_example',
          title: 'Example Provider',
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.provider.upsert', payload)
        return input.vaultServices!.core.upsertProvider({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.recipe.upsert',
      description:
        'Upsert one recipe record from a JSON payload object so the vault can remember dishes, ingredients, and prep notes.',
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
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.recipe.upsert', payload)
        return input.vaultServices!.core.upsertRecipe({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.food.upsert',
      description:
        'Upsert one regular food record from a JSON payload object so the vault can remember recurring meals, snacks, bowls, smoothies, and grocery staples.',
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
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.food.upsert', payload)
        return input.vaultServices!.core.upsertFood({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.share.createLink',
      description:
        'Create a one-time hosted share link for remembered foods, recipes, and protocols. When a food has attached protocol ids, keep includeAttachedProtocols=true so the recipient gets the full smoothie + supplement bundle.',
      inputSchema: z.object({
        title: z.string().min(1).optional(),
        foods: z.array(shareEntitySelectorSchema).optional(),
        protocols: z.array(shareEntitySelectorSchema).optional(),
        recipes: z.array(shareEntitySelectorSchema).optional(),
        includeAttachedProtocols: z.boolean().optional(),
        logMeal: z.object({
          food: shareEntitySelectorSchema,
          note: z.string().min(1).optional(),
          occurredAt: isoTimestampSchema.optional(),
        }).optional(),
        recipientPhoneNumber: z.string().min(1).optional(),
        inviteCode: z.string().min(1).optional(),
        expiresInHours: z.number().int().positive().max(24 * 30).optional(),
      }),
      inputExample: {
        foods: [
          {
            slug: 'morning-smoothie',
          },
        ],
        includeAttachedProtocols: true,
        logMeal: {
          food: {
            slug: 'morning-smoothie',
          },
        },
      },
      execute: async ({ expiresInHours, foods, includeAttachedProtocols, inviteCode, logMeal, protocols, recipientPhoneNumber, recipes, title }) => {
        const pack = await buildSharePackFromVault({
          vaultRoot: input.vault,
          title,
          foods,
          protocols,
          recipes,
          includeAttachedProtocols,
          logMeal,
        })

        return issueHostedShareLink({
          pack,
          expiresInHours,
          inviteCode,
          recipientPhoneNumber,
          senderMemberId: process.env.HOSTED_MEMBER_ID ?? null,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.event.upsert',
      description:
        'Upsert one canonical event record from a JSON payload object.',
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
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.event.upsert', payload)
        return input.vaultServices!.core.upsertEvent({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.samples.add',
      description:
        'Append one or more sample records from a JSON payload object.',
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
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.samples.add', payload)
        return input.vaultServices!.core.addSamples({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
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
    ...createHealthUpsertToolDefinitions(input),
  ]

  if (options.includeStatefulWriteTools ?? true) {
    return [
      ...tools,
      defineAssistantTool({
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
      defineAssistantTool({
        name: 'vault.profile.rebuildCurrent',
        description:
          'Rebuild the derived current profile page from the latest accepted profile snapshot.',
        inputSchema: z.object({}),
        inputExample: {},
        execute: () =>
          input.vaultServices!.core.rebuildCurrentProfile({
            vault: input.vault,
            requestId: input.requestId ?? null,
          }),
      }),
      defineAssistantTool({
        name: 'vault.protocol.stop',
        description:
          'Stop an existing protocol while preserving its canonical id.',
        inputSchema: z.object({
          protocolId: z.string().min(1),
          stoppedOn: localDateSchema.optional(),
        }),
        inputExample: {
          protocolId: 'prot_example',
          stoppedOn: '2026-03-13',
        },
        execute: ({ protocolId, stoppedOn }) =>
          input.vaultServices!.core.stopProtocol({
            vault: input.vault,
            requestId: input.requestId ?? null,
            protocolId,
            stoppedOn,
          }),
      }),
    ]
  }

  return tools
}

function createHealthUpsertToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return healthEntityDescriptors
    .filter(hasHealthCommandDescriptor)
    .map((descriptor) =>
      defineAssistantTool({
        name: `vault.${descriptor.command.commandName}.upsert`,
        description: `${descriptor.command.descriptions.upsert} The payload should follow the scaffold template for ${descriptor.command.commandName}.`,
        inputSchema: z.object({
          payload: jsonObjectSchema,
        }),
        inputExample: {
          payload: descriptor.core.payloadTemplate,
        },
        execute: async ({ payload }) => {
          const inputFile = await writeAssistantPayloadFile(
            input.vault,
            `vault.${descriptor.command.commandName}.upsert`,
            payload,
          )
          const method = input.vaultServices!.core[
            descriptor.core.upsertServiceMethod
          ] as unknown as (input: {
            vault: string
            requestId: string | null
            input: string
          }) => Promise<unknown>

          return method({
            vault: input.vault,
            requestId: input.requestId ?? null,
            input: inputFile,
          })
        },
      }),
    )
}

async function readAssistantTextFile(
  vaultRoot: string,
  candidatePath: string,
  maxChars?: number,
): Promise<{
  path: string
  text: string
  totalChars: number
  truncated: boolean
}> {
  const resolvedPath = await resolveAssistantVaultPath(vaultRoot, candidatePath, 'file path')
  const limit = maxChars ?? assistantToolTextReadDefaultMaxChars
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const fileHandle = await open(resolvedPath, 'r')
  const buffer = Buffer.allocUnsafe(assistantToolTextReadChunkBytes)
  let text = ''
  let totalChars = 0

  try {
    while (true) {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }

      const chunk = buffer.subarray(0, bytesRead)
      if (chunk.includes(0)) {
        throw createAssistantToolFileNotTextError(candidatePath)
      }

      const chunkText = decodeAssistantTextChunk(decoder, chunk, candidatePath)
      totalChars += chunkText.length
      if (text.length < limit) {
        text += chunkText.slice(0, limit - text.length)
      }
    }

    const trailingText = decodeAssistantTextChunk(decoder, undefined, candidatePath)
    totalChars += trailingText.length
    if (text.length < limit) {
      text += trailingText.slice(0, limit - text.length)
    }
  } finally {
    await fileHandle.close()
  }

  const truncated = totalChars > limit
  const relativePath = path.relative(vaultRoot, resolvedPath).split(path.sep).join('/')

  return {
    path: relativePath,
    text:
      truncated
        ? `${text.slice(0, limit)}

[truncated ${text.length - limit} characters]`
        : text,
    totalChars,
    truncated,
  }
}

function createAssistantToolFileNotTextError(candidatePath: string) {
  return new VaultCliError(
    'ASSISTANT_TOOL_FILE_NOT_TEXT',
    `Assistant file path "${candidatePath}" must reference a UTF-8 text file inside the vault.`,
  )
}

function decodeAssistantTextChunk(
  decoder: TextDecoder,
  chunk: Buffer | undefined,
  candidatePath: string,
): string {
  try {
    return chunk
      ? decoder.decode(chunk, { stream: true })
      : decoder.decode()
  } catch {
    throw createAssistantToolFileNotTextError(candidatePath)
  }
}

async function issueHostedShareLink(input: {
  pack: Awaited<ReturnType<typeof buildSharePackFromVault>>
  expiresInHours?: number
  inviteCode?: string
  recipientPhoneNumber?: string
  senderMemberId?: string | null
}) {
  const baseUrl = normalizeHostedShareApiBaseUrl(
    process.env.HOSTED_SHARE_API_BASE_URL
      ?? process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL
      ?? null,
  )
  const token = normalizeHostedShareApiToken(process.env.HOSTED_SHARE_INTERNAL_TOKEN ?? null)

  if (!baseUrl || !token) {
    throw new Error(
      'Hosted share link creation requires HOSTED_SHARE_API_BASE_URL or HOSTED_ONBOARDING_PUBLIC_BASE_URL plus HOSTED_SHARE_INTERNAL_TOKEN in the assistant environment.',
    )
  }

  const response = await fetch(`${baseUrl}/api/hosted-share/internal/create`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      pack: input.pack,
      expiresInHours: input.expiresInHours,
      inviteCode: input.inviteCode,
      recipientPhoneNumber: input.recipientPhoneNumber,
      senderMemberId: input.senderMemberId,
    }),
  })
  const payload = (await response.json()) as
    | ({
        error?: {
          message?: string
        }
      } & Record<string, unknown>)
    | null

  if (!response.ok) {
    throw new Error(
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : 'Hosted share link creation failed.',
    )
  }

  return payload
}

function normalizeHostedShareApiBaseUrl(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const url = new URL(normalized)
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/u, '')
}

function normalizeHostedShareApiToken(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

async function writeAssistantPayloadFile(
  vaultRoot: string,
  toolName: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`
  const directory = path.join(
    vaultRoot,
    'derived',
    'assistant',
    'payloads',
    sanitizeToolName(toolName),
  )
  const absolutePath = path.join(directory, fileName)
  await mkdir(directory, { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return absolutePath
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/[.]+/gu, '-')
}
