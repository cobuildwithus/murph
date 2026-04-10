import { FOOD_STATUSES, RECIPE_STATUSES } from '@murphai/contracts'
import { buildSharePackFromVault } from '@murphai/core'
import { z, type ZodTypeAny } from 'zod'
import type { AssistantToolProvenance } from '../inbox-model-contracts.js'
import {
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
} from '../knowledge.js'
import {
  assistantWebFetchExtractModeValues,
  fetchAssistantWeb,
  resolveAssistantWebFetchEnabled,
} from '../assistant/web-fetch.js'
import {
  assistantWebPdfReadMaxChars,
  assistantWebPdfReadMaxPages,
  readAssistantWebPdf,
} from '../assistant/web-pdf-read.js'
import {
  assistantWebSearchFreshnessValues,
  assistantWebSearchProviderValues,
  resolveConfiguredAssistantWebSearchProvider,
  searchAssistantWeb,
} from '../assistant/web-search.js'
import {
  healthEntityDescriptors,
  hasHealthCommandDescriptor,
} from '@murphai/vault-usecases'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import {
  defineAssistantCapability,
  type AssistantCapabilityDefinition,
  type AssistantCapabilityBackendKind,
  type AssistantCapabilityExecutor,
  type AssistantCapabilityHostKind,
} from '../model-harness.js'
import {
  listAssistantSelfDeliveryTargets,
  resolveAssistantSelfDeliveryTarget,
} from '@murphai/operator-config/operator-config'
import type {
  AssistantToolCatalogOptions,
  AssistantToolContext,
} from './shared.js'
import {
  assistantCliExecutorToolName,
  assistantCliMaxTimeoutMs,
  assistantToolTextReadMaxChars,
} from './shared.js'
import {
  assistantCliPolicyWrapperKinds,
} from './policy-wrappers.js'
import {
  executeAssistantCliCommand,
  readAssistantTextFile,
  withAssistantPayloadFile,
} from './execution-adapters.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

const isoTimestampSchema = z.string().min(1)
const vaultFilePathSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const optionalStringArraySchema = z.array(z.string().min(1)).optional()
const assistantWebFetchExtractModeSchema = z.enum(assistantWebFetchExtractModeValues)
const assistantWebSearchProviderSchema = z.enum(assistantWebSearchProviderValues)
const assistantWebSearchFreshnessSchema = z.enum(assistantWebSearchFreshnessValues)
const assistantWebSearchDomainFilterSchema = z.array(z.string().min(1)).max(20).optional()
const shareEntitySelectorSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.id || value.slug), {
    message: 'Provide either an id or slug.',
  })
const knowledgeMetadataTagSchema = z.string().min(1)
const knowledgeSourcePathSchema = z.string().min(1)
const knowledgeSlugSchema = z.string().min(1)

export function createAssistantCliExecutorToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineCliBackedTool({
      name: assistantCliExecutorToolName,
      description:
        'Run the local `vault-cli` directly inside the active Murph workspace. This is the primary Murph runtime surface for provider turns. Pass only the tokens that come after `vault-cli`. The active vault is injected automatically when the command path normally needs `--vault`. Use `--help`, `--schema --format json`, `--llms`, and `--llms-full` for discovery.',
      inputSchema: z.object({
        args: z.array(z.string().min(1)).min(1),
        stdin: z.string().optional(),
        timeoutMs: z.number().int().positive().max(assistantCliMaxTimeoutMs).optional(),
      }),
      inputExample: {
        args: ['device', 'provider', 'list'],
      },
      execute: async ({ args, stdin, timeoutMs }) => {
        const result = await executeAssistantCliCommand({
          args,
          stdin,
          timeoutMs,
          input,
        })

        if (result.json !== null) {
          return result.json
        }

        return result.stdout.length > 0 ? result.stdout : null
      },
    }),
  ]
}

export function createVaultTextReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineNativeLocalOnlyTool({
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
  ]
}

export function createWebSearchToolDefinitions() {
  if (resolveConfiguredAssistantWebSearchProvider() === null) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.search',
      description:
        'Search the public web through the configured Murph search backend. Use this for current events, provider docs, product pages, release notes, and other information that is not available inside the active vault.',
      inputSchema: z.object({
        query: z.string().min(1),
        provider: assistantWebSearchProviderSchema.optional(),
        count: z.number().int().positive().max(10).optional(),
        country: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
        freshness: assistantWebSearchFreshnessSchema.optional(),
        dateAfter: localDateSchema.optional(),
        dateBefore: localDateSchema.optional(),
        domainFilter: assistantWebSearchDomainFilterSchema,
      }),
      inputExample: {
        query: 'OpenAI Responses API web search tool',
        provider: 'auto',
        count: 5,
        domainFilter: ['platform.openai.com', 'openai.com'],
      },
      execute: async ({
        count,
        country,
        dateAfter,
        dateBefore,
        domainFilter,
        freshness,
        language,
        provider,
        query,
      }) =>
        await searchAssistantWeb({
          query,
          provider,
          count,
          country,
          language,
          freshness,
          dateAfter,
          dateBefore,
          domainFilter,
        }),
    }),
  ]
}

export function createWebFetchToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.fetch',
      description:
        'Fetch one public webpage over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text for the assistant. Use this after discovery tools like web.search when you need the actual page contents of a docs page, menu, article, or product page. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        extractMode: assistantWebFetchExtractModeSchema.optional(),
        maxChars: z.number().int().positive().max(40_000).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu',
        extractMode: 'markdown',
        maxChars: 8_000,
      },
      execute: async ({ extractMode, maxChars, url }) =>
        await fetchAssistantWeb({
          url,
          extractMode,
          maxChars,
        }),
    }),
  ]
}

export function createWebPdfReadToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.pdf.read',
      description:
        'Fetch one public PDF over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text with bounded page and character limits. Use this for menus, manuals, reports, or docs that are published as PDFs. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().int().positive().max(assistantWebPdfReadMaxChars).optional(),
        maxPages: z.number().int().positive().max(assistantWebPdfReadMaxPages).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu.pdf',
        maxPages: 4,
        maxChars: 8_000,
      },
      execute: async ({ maxChars, maxPages, url }) =>
        await readAssistantWebPdf({
          url,
          maxChars,
          maxPages,
        }),
    }),
  ]
}

export function createAssistantRuntimeToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  const readOnlyTools = [
    ...createAssistantKnowledgeReadToolDefinitions(input),
    defineHandAuthoredHelperTool({
      name: 'assistant.selfTarget.list',
      description:
        'List saved outbound self-target routes such as email, Telegram, or phone delivery settings.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: () => listAssistantSelfDeliveryTargets(),
    }),
    defineHandAuthoredHelperTool({
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
    ...createAssistantKnowledgeWriteToolDefinitions(input),
  ]
}

export function createAssistantKnowledgeReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.list',
      description:
        'List derived knowledge pages from Murph\'s non-canonical local wiki, optionally filtered by page type or status.',
      inputSchema: z.object({
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        pageType: 'concept',
      },
      execute: async ({ pageType, status }) =>
        await listKnowledgePages({
          vault: input.vault,
          pageType,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.search',
      description:
        'Search the derived knowledge wiki by lexical match across titles, summaries, narrative body text, related slugs, and source paths.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        query: 'sleep magnesium',
        limit: 5,
      },
      execute: async ({ limit, pageType, query, status }) =>
        await searchKnowledgePages({
          vault: input.vault,
          query,
          limit,
          pageType,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.get',
      description:
        'Show one derived knowledge page by slug, including the normalized markdown and canonical metadata.',
      inputSchema: z.object({
        slug: knowledgeSlugSchema,
      }),
      inputExample: {
        slug: 'sleep-quality',
      },
      execute: async ({ slug }) =>
        await getKnowledgePage({
          vault: input.vault,
          slug,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.lint',
      description:
        'Run deterministic structural checks over derived knowledge pages, including parse failures, duplicate slugs, missing sources, broken related links, and invalid bank/library references.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await lintKnowledgePages({
          vault: input.vault,
        }),
    }),
  ]
}

export function createAssistantKnowledgeWriteToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.upsert',
      description:
        'Persist one assistant-authored derived knowledge page, normalize its frontmatter and generated sections, and rebuild the derived knowledge index.',
      inputSchema: z.object({
        body: z.string().min(1),
        title: z.string().min(1).optional(),
        slug: knowledgeSlugSchema.optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
        clearLibrarySlugs: z.boolean().optional(),
        librarySlugs: z.array(knowledgeSlugSchema).optional(),
        sourcePaths: z.array(knowledgeSourcePathSchema).optional(),
        relatedSlugs: z.array(knowledgeSlugSchema).optional(),
      }),
      inputExample: {
        title: 'Sleep quality',
        body: '# Sleep quality\n\nMagnesium may help sleep continuity.\n',
        librarySlugs: ['sleep-architecture'],
        sourcePaths: ['research/2026/04/sleep-note.md'],
      },
      execute: async ({
        body,
        clearLibrarySlugs,
        librarySlugs,
        pageType,
        relatedSlugs,
        slug,
        sourcePaths,
        status,
        title,
      }) =>
        await upsertKnowledgePage({
          vault: input.vault,
          body,
          title,
          clearLibrarySlugs,
          slug,
          pageType,
          librarySlugs,
          relatedSlugs,
          sourcePaths,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.rebuildIndex',
      description:
        'Rebuild the derived knowledge index markdown from the current saved pages.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await rebuildKnowledgeIndex({
          vault: input.vault,
        }),
    }),
  ]
}

export function createInboxPromotionToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.inboxServices || !input.captureId) {
    return []
  }

  const captureIdSchema = z.object({
    captureId: z.literal(input.captureId),
  })

  return [
    defineHandAuthoredHelperTool({
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
    defineHandAuthoredHelperTool({
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
    defineHandAuthoredHelperTool({
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
    defineHandAuthoredHelperTool({
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

export function createQueryAndReadToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  return [
    ...(options.includeVaultTextReadTool ?? true
      ? createVaultTextReadToolDefinitions(input)
      : []),
    ...(options.includeQueryTools ?? true
      ? createVaultQueryToolDefinitions(input)
      : []),
    ...(options.includeWebSearchTools ?? true
      ? [
          ...createWebFetchToolDefinitions(),
          ...createWebPdfReadToolDefinitions(),
          ...createWebSearchToolDefinitions(),
        ]
      : []),
  ]
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
    defineVaultServiceBackedTool({
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
    defineVaultServiceBackedTool({
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
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.provider.upsert',
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
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.recipe.upsert',
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
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.food.upsert',
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
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.event.upsert',
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
      execute: ({ payload }) =>
        withAssistantPayloadFile(
          input.vault,
          'vault.samples.add',
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
    ...createHealthUpsertToolDefinitions(input),
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

export function createOutwardSideEffectToolDefinitions(
  input: AssistantToolContext,
) {
  const tools: AssistantCapabilityDefinition[] = []

  if (input.executionContext?.hosted?.issueDeviceConnectLink) {
    tools.push(
      defineHostedApiBackedTool({
        name: 'murph.device.connect',
        description:
          'Create a hosted wearable connection link for the requested provider and return a clickable authorization URL for the user. Prefer this over `vault.cli.run` when the user wants help connecting WHOOP, Oura, Garmin, or another hosted wearable integration in hosted assistant sessions.',
        inputSchema: z.object({
          provider: z.string().min(1),
        }),
        inputExample: {
          provider: 'whoop',
        },
        execute: ({ provider }) =>
          input.executionContext!.hosted!.issueDeviceConnectLink!({
            provider,
          }),
      }),
    )
  }

  if (input.executionContext?.hosted?.issueShareLink) {
    tools.push(
      defineHostedApiBackedTool({
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

          return input.executionContext!.hosted!.issueShareLink!({
            pack,
            expiresInHours,
            inviteCode,
            recipientPhoneNumber,
          })
        },
      }),
    )
  }

  return tools
}

export function createHealthUpsertToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return healthEntityDescriptors
    .filter(hasHealthCommandDescriptor)
    .map((descriptor) =>
      defineDescriptorGeneratedTool({
        name: `vault.${descriptor.command.commandName}.upsert`,
        description: `${descriptor.command.descriptions.upsert} The payload should follow the scaffold template for ${descriptor.command.commandName}.`,
        inputSchema: z.object({
          payload: jsonObjectSchema,
        }),
        inputExample: {
          payload: descriptor.core.payloadTemplate,
        },
        execute: ({ payload }) =>
          withAssistantPayloadFile(
            input.vault,
            `vault.${descriptor.command.commandName}.upsert`,
            payload,
            async (inputFile) => {
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
          ),
      }, 'healthEntityDescriptors'),
    )
}

type AssistantCapabilityToolDefinitionInput<
  TSchema extends ZodTypeAny,
  TResult,
> =
  | (Omit<AssistantCapabilityDefinition<TSchema, TResult>, 'executionBindings'> & {
    execute(input: z.infer<TSchema>): Promise<TResult>
  })
  | (Omit<AssistantCapabilityDefinition<TSchema, TResult>, 'executionBindings'> & {
    executionBindings: Partial<
      Record<
        AssistantCapabilityHostKind,
        AssistantCapabilityExecutor<TSchema, TResult>
      >
    >
  })

function defineHandAuthoredHelperTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'hand-authored-helper',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

function defineVaultServiceBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'vault-service-backed',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

function defineCliBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'cli-backed',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [...assistantCliPolicyWrapperKinds],
  }, 'cli-backed', 'cli-wrapper')
}

function defineConfiguredWebReadTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'configured-web-read',
    localOnly: false,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'configured-web-read')
}

function defineHostedApiBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'hosted-api-backed',
    localOnly: false,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'hosted-api')
}

function defineNativeLocalOnlyTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'native-local-only',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: ['output-redaction'],
  }, 'native-local', 'native-file')
}

function defineDescriptorGeneratedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
  generatedFrom: string,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'descriptor-generated',
    localOnly: true,
    generatedFrom,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

export function defineAssistantCapabilityTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
  provenance: AssistantToolProvenance,
  defaultHostKind: AssistantCapabilityHostKind,
  defaultBackendKind: AssistantCapabilityBackendKind,
) {
  const executionBindings =
    'executionBindings' in definition
      ? definition.executionBindings
      : {
          [defaultHostKind]: definition.execute,
        }
  const {
    backendKind = defaultBackendKind,
    preferredHostKind = defaultHostKind,
    ...capability
  } = definition
  return defineAssistantCapability({
    ...capability,
    backendKind,
    preferredHostKind,
    executionBindings,
    provenance,
  })
}
