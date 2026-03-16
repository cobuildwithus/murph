import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  healthEntityDescriptors,
  hasHealthCommandDescriptor,
} from './health-cli-descriptors.js'
import { resolveAssistantVaultPath } from './assistant-vault-paths.js'
import {
  createAssistantToolCatalog,
  type AssistantToolCatalog,
  type AssistantToolDefinition,
} from './assistant-harness.js'
import type { InboxCliServices } from './inbox-services.js'
import type { VaultCliServices } from './vault-cli-services.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

const isoTimestampSchema = z.string().min(1)
const vaultFilePathSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const optionalStringArraySchema = z.array(z.string().min(1)).optional()

interface AssistantToolContext {
  captureId?: string
  inboxServices?: InboxCliServices
  requestId?: string | null
  vault: string
  vaultServices?: VaultCliServices
}

export interface AssistantToolCatalogOptions {
  includeQueryTools?: boolean
  includeStatefulWriteTools?: boolean
}

export function createDefaultAssistantToolCatalog(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolCatalog {
  return createAssistantToolCatalog([
    ...createInboxPromotionToolDefinitions(input),
    ...(options.includeQueryTools ?? true ? createVaultQueryToolDefinitions(input) : []),
    ...createVaultWriteToolDefinitions(input, options),
  ])
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createDefaultAssistantToolCatalog(input, {
    includeQueryTools: false,
    includeStatefulWriteTools: false,
  })
}

function createInboxPromotionToolDefinitions(
  input: AssistantToolContext,
): AssistantToolDefinition[] {
  if (!input.inboxServices || !input.captureId) {
    return []
  }

  const captureIdSchema = z.object({
    captureId: z.literal(input.captureId),
  })

  return [
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
  ]
}

function createVaultQueryToolDefinitions(
  input: AssistantToolContext,
): AssistantToolDefinition[] {
  if (!input.vaultServices) {
    return []
  }

  return [
    {
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
    },
    {
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
        input.vaultServices!.query.list({
          vault: input.vault,
          requestId: input.requestId ?? null,
          ...filters,
        }),
    },
  ]
}

function createVaultWriteToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolDefinition[] {
  if (!input.vaultServices) {
    return []
  }

  const tools: AssistantToolDefinition[] = [
    {
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
    },
    {
      name: 'vault.meal.add',
      description:
        'Create one canonical meal record from a photo plus an optional audio note and optional text note.',
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    ...createHealthUpsertToolDefinitions(input),
  ]

  if (options.includeStatefulWriteTools ?? true) {
    tools.push(
      {
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
      },
      {
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
      },
      {
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
      },
    )
  }

  return tools
}

function createHealthUpsertToolDefinitions(
  input: AssistantToolContext,
): AssistantToolDefinition[] {
  if (!input.vaultServices) {
    return []
  }

  return healthEntityDescriptors
    .filter(hasHealthCommandDescriptor)
    .map((descriptor): AssistantToolDefinition => ({
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
    }))
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
