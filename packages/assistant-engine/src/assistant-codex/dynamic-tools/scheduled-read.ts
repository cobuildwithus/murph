import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import {
  isContractId,
  isValidIanaTimeZone,
  memoryRecordMetadataSchema,
  VAULT_LAYOUT,
} from '@murphai/contracts'
import { getMemoryRecord, loadVault, readMemoryDocument } from '@murphai/core'
import {
  buildHostedVaultShareProjectionScopeKey,
  flattenSharedVaultShareProjectionStore,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  type SharedGroupMemberView,
} from '@murphai/hosted-execution/vault-share'
import {
  readSharedVaultShareProjectionStore,
} from '@murphai/hosted-execution/vault-share-store-node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  buildSharedGroupWeeklyMembers,
  explainWearableDriftRuntime,
  listCanonicalEntities,
  lookupEntityById,
  readVault,
  searchVaultRuntime,
  summarizeWearableLatestRuntime,
  summarizeWearableMetricLatestRuntime,
  summarizeWearableMetricTrendRuntime,
  summarizeWearableSleepPatternRuntime,
  summarizeWearableSourceHealthRuntime,
} from '@murphai/query'
import { ALL_QUERY_ENTITY_FAMILIES } from '@murphai/query/entity-families'

import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
  type AssistantScheduledTaskSourceCurrentAssertion,
} from '../../assistant/scheduled-task-authority.js'
import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../../assistant-skill-assets.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  getKnowledgePage,
  listKnowledgePages,
  searchKnowledgePages,
} from '../../knowledge/service.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const TOOL_RESULT_MAX_BYTES = 256_000
const SKILL_FILE_MAX_BYTES = 64_000
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const BOUNDED_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const KNOWLEDGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const REGISTERED_SKILL_SLUGS = new Set<string>(
  ASSISTANT_SKILLS.map((skill) => skill.slug),
)
const GROUP_HEALTH_PROJECTION_SCOPES =
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES
    .filter((scope) => scope.projectionKind !== 'group-email.v0')
const GROUP_HEALTH_PROJECTION_SCOPE_KEYS = new Set(
  GROUP_HEALTH_PROJECTION_SCOPES.map(buildHostedVaultShareProjectionScopeKey),
)
const GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS = {
  baselines: 'Baselines',
  canon: 'Canon',
  comedyBank: 'Comedy bank',
  confoundersAndProtectedNotes: 'Confounders & protected notes',
  rulesAndMetric: 'Rules & metric',
  stakes: 'Stakes',
  standingsSnapshots: 'Standings snapshots',
} as const
const GROUP_CHALLENGE_SCHEDULED_SECTION_HEADING_SET = new Set<string>(
  Object.values(GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS),
)
const GROUP_CHALLENGE_SCHEDULED_VAULT_PATH_ROOTS = [
  VAULT_LAYOUT.auditDirectory,
  VAULT_LAYOUT.bankDirectory,
  VAULT_LAYOUT.derivedDirectory,
  VAULT_LAYOUT.exportsDirectory,
  VAULT_LAYOUT.journalDirectory,
  VAULT_LAYOUT.ledgerDirectory,
  VAULT_LAYOUT.rawDirectory,
  '.runtime',
  'skill-assets',
] as const
const GROUP_CHALLENGE_SCHEDULED_VAULT_FILES = new Set<string>([
  VAULT_LAYOUT.coreDocument,
  VAULT_LAYOUT.metadata,
])
const GROUP_CHALLENGE_SCHEDULED_PRIVATE_ID_PREFIXES = [
  'att_',
  'cap_',
  'capture_',
  'hbm_',
  'member_',
  'user_',
] as const
const GROUP_CHALLENGE_SCHEDULED_URI_PATTERN =
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]/u
const GROUP_CHALLENGE_SCHEDULED_DATA_URL_PATTERN =
  /\bdata:[^,\s]{1,120},[^\s]/iu
const GROUP_CHALLENGE_SCHEDULED_LOCATOR_TOKEN_PATTERN =
  /[A-Za-z0-9._~+\/\\:-]+/gu
const GROUP_CHALLENGE_SCHEDULED_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const GROUP_CHALLENGE_SCHEDULED_SHA256_PATTERN = /^[0-9a-f]{64}$/iu
const GROUP_CHALLENGE_SCHEDULED_WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/u
const GENERIC_SCHEDULED_READ_ACTIONS = [
  'knowledge_list',
  'knowledge_get',
  'knowledge_search',
  'search',
  'recent_records',
  'latest',
  'metric_latest',
  'metric_trend',
  'drift',
  'sources',
  'record',
  'skill_get',
] as const satisfies readonly ScheduledReadAction[]
const PRIVATE_GENERIC_SCHEDULED_READ_ACTIONS = [
  ...GENERIC_SCHEDULED_READ_ACTIONS,
  'sleep_pattern',
] as const satisfies readonly ScheduledReadAction[]
const dateSchema = z.string().regex(ISO_DATE_PATTERN)
const boundedTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(BOUNDED_TOKEN_PATTERN)
const boundedTokenListSchema = z.array(boundedTokenSchema).max(20)
const knowledgeSlugSchema = z
  .string()
  .trim()
  .max(100)
  .regex(KNOWLEDGE_SLUG_PATTERN)
const canonicalFamilySchema = z.enum(ALL_QUERY_ENTITY_FAMILIES)
const providersSchema = z.array(boundedTokenSchema).max(8)
const timeZoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .refine(isValidIanaTimeZone, {
    message: 'Time zone must be a valid IANA time zone.',
  })
const skillSlugSchema = z
  .string()
  .trim()
  .max(80)
  .regex(KNOWLEDGE_SLUG_PATTERN)
  .refine((slug) => REGISTERED_SKILL_SLUGS.has(slug), {
    message: 'Skill slug must name a registered bundled assistant skill.',
  })

const knowledgeListSchema = z.object({
  action: z.literal('knowledge_list'),
  limit: z.number().int().min(1).max(50).default(20),
  pageType: boundedTokenSchema.optional(),
  status: boundedTokenSchema.optional(),
}).strict()

const knowledgeGetSchema = z.object({
  action: z.literal('knowledge_get'),
  slug: knowledgeSlugSchema,
}).strict()

const knowledgeSearchSchema = z.object({
  action: z.literal('knowledge_search'),
  limit: z.number().int().min(1).max(50).default(20),
  pageType: boundedTokenSchema.optional(),
  query: z.string().trim().min(1).max(500),
  status: boundedTokenSchema.optional(),
}).strict()

const memoryShowSchema = z.object({
  action: z.literal('memory_show'),
  memoryId: memoryRecordMetadataSchema.shape.id.optional(),
}).strict()

const searchSchema = z.object({
  action: z.literal('search'),
  from: dateSchema.optional(),
  includeSamples: z.boolean().default(false),
  kinds: boundedTokenListSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  query: z.string().trim().min(1).max(500),
  recordTypes: z.array(canonicalFamilySchema).max(10).optional(),
  streams: boundedTokenListSchema.optional(),
  tags: boundedTokenListSchema.optional(),
  to: dateSchema.optional(),
}).strict()

const recentRecordsSchema = z.object({
  action: z.literal('recent_records'),
  family: canonicalFamilySchema.optional(),
  from: dateSchema.optional(),
  kinds: boundedTokenListSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  to: dateSchema.optional(),
}).strict()

const wearableFiltersShape = {
  date: dateSchema.optional(),
  from: dateSchema.optional(),
  providers: providersSchema.optional(),
  to: dateSchema.optional(),
}

const wearableLatestSchema = z.object({
  action: z.literal('latest'),
  ...wearableFiltersShape,
  limit: z.number().int().min(1).max(30).default(7),
}).strict()

const wearableMetricLatestSchema = z.object({
  action: z.literal('metric_latest'),
  ...wearableFiltersShape,
  metric: boundedTokenSchema,
  windowDays: z.number().int().min(1).max(30).default(7),
}).strict()

const wearableMetricTrendSchema = z.object({
  action: z.literal('metric_trend'),
  ...wearableFiltersShape,
  metric: boundedTokenSchema,
  windowDays: z.number().int().min(2).max(30).default(14),
}).strict()

const wearableDriftSchema = z.object({
  action: z.literal('drift'),
  ...wearableFiltersShape,
  windowDays: z.number().int().min(2).max(30).default(14),
}).strict()

const wearableSleepPatternSchema = z.object({
  action: z.literal('sleep_pattern'),
  ...wearableFiltersShape,
  timeZone: timeZoneSchema.optional(),
  windowDays: z.number().int().min(1).max(366).default(28),
}).strict()

const wearableSourcesSchema = z.object({
  action: z.literal('sources'),
  ...wearableFiltersShape,
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

const recordSchema = z.object({
  action: z.literal('record'),
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u),
}).strict()

const skillGetSchema = z.object({
  action: z.literal('skill_get'),
  slug: skillSlugSchema,
}).strict()

const groupChallengeContextSchema = z.object({
  action: z.literal('group_challenge_context'),
}).strict()

const groupSharedSchema = z.object({
  action: z.literal('group_shared'),
}).strict()

const scheduledReadArgumentsSchema = z.discriminatedUnion('action', [
  knowledgeListSchema,
  knowledgeGetSchema,
  knowledgeSearchSchema,
  memoryShowSchema,
  searchSchema,
  recentRecordsSchema,
  wearableLatestSchema,
  wearableMetricLatestSchema,
  wearableMetricTrendSchema,
  wearableDriftSchema,
  wearableSleepPatternSchema,
  wearableSourcesSchema,
  recordSchema,
  skillGetSchema,
  groupChallengeContextSchema,
  groupSharedSchema,
])

type ScheduledReadArguments = z.infer<typeof scheduledReadArgumentsSchema>
export type ScheduledReadAction = ScheduledReadArguments['action']

export const MURPH_SCHEDULED_READ_TOOL = {
  namespace: 'murph',
  name: 'scheduled_read',
  description:
    'Read bounded canonical state for a scheduled turn from the exact active vault supplied by the trusted parent. Supports authority-scoped knowledge, memory, canonical search and records, normalized wearable summaries, server-approved group projections, and registered bundled skill instructions. It accepts no command, shell, path, URL, token, credential, route, member selector, experiment selector, or arbitrary file input and never mutates state.',
  inputSchema: z.toJSONSchema(scheduledReadArgumentsSchema, { io: 'input' }),
} as const

export type ScheduledReadDynamicToolRequest =
  | {
      kind: 'scheduled-read'
      request: ScheduledReadArguments
    }
  | {
      kind: 'invalid-scheduled-read-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledReadDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledReadDynamicToolRequest | null {
  if (input.tool !== MURPH_SCHEDULED_READ_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: scheduledReadArgumentsSchema,
    schemaRootKeys: [
      'action',
      'date',
      'family',
      'from',
      'id',
      'includeSamples',
      'kinds',
      'limit',
      'memoryId',
      'metric',
      'pageType',
      'providers',
      'query',
      'recordTypes',
      'slug',
      'status',
      'streams',
      'tags',
      'to',
      'timeZone',
      'windowDays',
    ],
    toolName: 'murph.scheduled_read',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'scheduled-read', request: parsed.args }
    : {
        kind: 'invalid-scheduled-read-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeScheduledReadDynamicTool(input: {
  assertCurrentGroupRoute?: (() => Promise<void>) | null
  assertSourceCurrent: AssistantScheduledTaskSourceCurrentAssertion
  authority: AssistantScheduledTaskAuthority | null
  request: Extract<ScheduledReadDynamicToolRequest, { kind: 'scheduled-read' }>
  scheduledOccurrenceAt?: string | null
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  const action = input.request.request.action
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (!resolveScheduledReadActions(authority.kind).includes(action)) {
    return scheduledReadTextResult(false, JSON.stringify({
      code: 'scheduled_read_action_unauthorized',
    }))
  }
  if (
    action === 'knowledge_get' &&
    !scheduledKnowledgeSlugIsAuthorized(
      authority,
      input.request.request.slug,
    )
  ) {
    return scheduledReadTextResult(false, JSON.stringify({
      code: 'scheduled_read_action_unauthorized',
    }))
  }
  if (
    action === 'skill_get' &&
    !scheduledSkillSlugIsAuthorized(authority, input.request.request.slug)
  ) {
    return scheduledReadTextResult(false, JSON.stringify({
      code: 'scheduled_read_action_unauthorized',
    }))
  }
  try {
    await input.assertSourceCurrent(input.authority)
    if (
      authority.kind === 'group_notification' ||
      authority.kind === 'group_health_update' ||
      authority.kind === 'group_challenge'
    ) {
      if (!input.assertCurrentGroupRoute) {
        throw new VaultCliError(
          'scheduled_group_route_unavailable',
          'The current scheduled group route could not be verified.',
        )
      }
      await input.assertCurrentGroupRoute()
    }
    const payload = action === 'skill_get'
      ? await readRegisteredSkill(input.request.request.slug)
      : action === 'group_challenge_context'
        ? input.vaultRoot && authority.kind === 'group_challenge'
          ? await readBoundGroupChallengeContext(input.vaultRoot, authority.slug)
          : null
      : action === 'group_shared'
        ? input.vaultRoot
          ? authority.kind === 'group_challenge'
            ? await readGroupSharedProjection(
                input.vaultRoot,
                input.request.request,
                {
                  kind: 'exact',
                  projectionScopeKey: authority.projectionScopeKey,
                },
              )
            : authority.kind === 'group_health_update'
              ? await readGroupHealthSummary(
                  input.vaultRoot,
                  input.request.request,
                  input.scheduledOccurrenceAt ?? null,
                )
              : null
          : null
      : input.vaultRoot
        ? await executeVaultRead(input.vaultRoot, input.request.request)
        : null

    if (payload === null && action !== 'skill_get') {
      return scheduledReadTextResult(false, JSON.stringify({
        code: 'scheduled_read_unavailable',
      }))
    }

    const text = serializeBounded(payload)
    return text === null
      ? scheduledReadTextResult(false, JSON.stringify({
          code: 'scheduled_read_result_too_large',
        }))
      : scheduledReadTextResult(true, text)
  } catch (error) {
    return scheduledReadTextResult(false, JSON.stringify({
      code: error instanceof ScheduledSkillReadError
        ? error.code
        : error instanceof VaultCliError
          ? error.code
          : 'scheduled_read_unavailable',
    }))
  }
}

function resolveScheduledReadActions(
  kind: ReturnType<typeof resolveAssistantScheduledTaskAuthority>['kind'],
): readonly ScheduledReadAction[] {
  switch (kind) {
    case 'none':
      return []
    case 'memory_maintenance':
      return ['memory_show']
    case 'onboarding_followup':
    case 'experiment_lifecycle':
    case 'group_newsletter':
      return ['skill_get']
    case 'product_notes':
      return ['knowledge_get']
    case 'group_challenge':
      return ['group_challenge_context', 'group_shared', 'skill_get']
    case 'group_health_update':
      return [...GENERIC_SCHEDULED_READ_ACTIONS, 'group_shared']
    case 'group_notification':
      return GENERIC_SCHEDULED_READ_ACTIONS
    case 'generic_notification':
    case 'managed_knowledge_ledger':
    case 'research_ledger':
      return PRIVATE_GENERIC_SCHEDULED_READ_ACTIONS
  }
}

function scheduledKnowledgeSlugIsAuthorized(
  authority: ReturnType<typeof resolveAssistantScheduledTaskAuthority>,
  slug: string,
): boolean {
  switch (authority.kind) {
    case 'generic_notification':
    case 'group_notification':
    case 'group_health_update':
      return true
    case 'managed_knowledge_ledger':
      return slug === authority.slug ||
        (
          authority.slug === 'improvement-opportunities' &&
          slug === 'weekly-health-insights'
        )
    case 'research_ledger':
    case 'product_notes':
      return slug === authority.slug
    case 'none':
    case 'group_challenge':
    case 'group_newsletter':
    case 'memory_maintenance':
    case 'experiment_lifecycle':
    case 'onboarding_followup':
      return false
  }
}

function scheduledSkillSlugIsAuthorized(
  authority: ReturnType<typeof resolveAssistantScheduledTaskAuthority>,
  slug: string,
): boolean {
  switch (authority.kind) {
    case 'onboarding_followup':
      return slug === 'murph-onboarding'
    case 'experiment_lifecycle':
      return [
        'behavior-followthrough',
        'experiment-onboarding',
        'self-management-experiments',
      ].includes(slug)
    case 'group_challenge':
      return [
        'group-chat',
        'group-challenge',
        'groupchat-comedy',
        'music-generation',
      ].includes(slug)
    case 'group_newsletter':
      return slug === 'group-newsletter'
    case 'none':
    case 'product_notes':
    case 'memory_maintenance':
      return false
    case 'generic_notification':
    case 'group_notification':
    case 'group_health_update':
    case 'managed_knowledge_ledger':
    case 'research_ledger':
      return true
  }
}

async function executeVaultRead(
  vaultRoot: string,
  request: Exclude<ScheduledReadArguments, {
    action: 'group_challenge_context' | 'group_shared' | 'skill_get'
  }>,
): Promise<unknown> {
  switch (request.action) {
    case 'knowledge_list': {
      const { vault: _vault, ...result } = await listKnowledgePages({
        limit: request.limit,
        pageType: request.pageType,
        status: request.status,
        vault: vaultRoot,
      })
      return { action: request.action, ...result }
    }
    case 'knowledge_get': {
      const { vault: _vault, ...result } = await getKnowledgePage({
        slug: request.slug,
        vault: vaultRoot,
      })
      return { action: request.action, ...result }
    }
    case 'knowledge_search': {
      const { vault: _vault, ...result } = await searchKnowledgePages({
        limit: request.limit,
        pageType: request.pageType,
        query: request.query,
        status: request.status,
        vault: vaultRoot,
      })
      return { action: request.action, ...result }
    }
    case 'memory_show': {
      const document = await readMemoryDocument(vaultRoot)
      const exactRecord = request.memoryId
        ? await getMemoryRecord(vaultRoot, request.memoryId)
        : undefined
      return {
        action: request.action,
        document: {
          exists: document.exists,
          frontmatter: document.frontmatter,
          records: document.records.map((record) => ({
            createdAt: record.createdAt,
            id: record.id,
            section: record.section,
            text: record.text,
            updatedAt: record.updatedAt,
          })),
          updatedAt: document.updatedAt,
        },
        ...(request.memoryId ? {
          record: exactRecord
            ? {
                createdAt: exactRecord.createdAt,
                id: exactRecord.id,
                section: exactRecord.section,
                text: exactRecord.text,
                updatedAt: exactRecord.updatedAt,
              }
            : null,
        } : {}),
      }
    }
    case 'search':
      return {
        action: request.action,
        result: await searchVaultRuntime(vaultRoot, request.query, {
          from: request.from,
          includeSamples: request.includeSamples,
          kinds: request.kinds,
          limit: request.limit,
          recordTypes: request.recordTypes,
          streams: request.streams,
          tags: request.tags,
          to: request.to,
        }),
      }
    case 'recent_records': {
      const records = await listCanonicalEntities(vaultRoot, {
        family: request.family,
        from: request.from,
        kinds: request.kinds,
        limit: request.limit,
        to: request.to,
      })
      return {
        action: request.action,
        count: records.length,
        records: [...records].reverse(),
      }
    }
    case 'latest':
      return {
        action: request.action,
        summary: await summarizeWearableLatestRuntime(vaultRoot, {
          date: request.date,
          from: request.from,
          limit: request.limit,
          providers: request.providers,
          to: request.to,
        }),
      }
    case 'metric_latest':
      return {
        action: request.action,
        summary: await summarizeWearableMetricLatestRuntime(
          vaultRoot,
          request.metric,
          {
            date: request.date,
            from: request.from,
            providers: request.providers,
            to: request.to,
            windowDays: request.windowDays,
          },
        ),
      }
    case 'metric_trend':
      return {
        action: request.action,
        summary: await summarizeWearableMetricTrendRuntime(
          vaultRoot,
          request.metric,
          {
            date: request.date,
            from: request.from,
            providers: request.providers,
            to: request.to,
            windowDays: request.windowDays,
          },
        ),
      }
    case 'drift':
      return {
        action: request.action,
        summary: await explainWearableDriftRuntime(vaultRoot, {
          date: request.date,
          from: request.from,
          providers: request.providers,
          to: request.to,
          windowDays: request.windowDays,
        }),
      }
    case 'sleep_pattern':
      return {
        action: request.action,
        summary: await summarizeWearableSleepPatternRuntime(vaultRoot, {
          date: request.date,
          from: request.from,
          providers: request.providers,
          timeZone: request.timeZone,
          to: request.to,
          windowDays: request.windowDays,
        }),
      }
    case 'sources':
      return {
        action: request.action,
        sources: await summarizeWearableSourceHealthRuntime(vaultRoot, {
          date: request.date,
          from: request.from,
          limit: request.limit,
          providers: request.providers,
          to: request.to,
        }),
      }
    case 'record':
      return {
        action: request.action,
        record: lookupEntityById(await readVault(vaultRoot), request.id),
      }
  }
}

async function readGroupSharedProjection(
  vaultRoot: string,
  request: z.infer<typeof groupSharedSchema>,
  scope: { kind: 'exact'; projectionScopeKey: string },
): Promise<unknown> {
  const read = await readSharedVaultShareProjectionStore(vaultRoot)
  if (read.status === 'corrupt' || read.status === 'read_failed') {
    return {
      action: request.action,
      memberCount: 0,
      members: [],
      sharingMemberCount: 0,
      status: 'unavailable',
    }
  }

  const members = read.status === 'empty'
    ? []
    : flattenSharedVaultShareProjectionStore(read.store)
      .map((member) => ({
        displayName: member.displayName,
        shares: member.shares
          .filter((share) =>
            share.projectionScopeKey === scope.projectionScopeKey)
          .map((share) => ({
            projectionKind: share.projectionKind,
            projectionScope: share.projectionScope,
            projectionScopeKey: share.projectionScopeKey,
            records: share.records
              .slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS)
              .map((record) => ({
                data: record.data,
                occurredAt: record.occurredAt,
                recordKey: record.recordKey,
                ...(record.sourceRevision !== undefined
                  ? { sourceRevision: record.sourceRevision }
                  : {}),
              })),
          })),
      }))
      .filter((member) => member.shares.length > 0)

  return {
    action: request.action,
    memberCount: members.length,
    members,
    sharingMemberCount: members.length,
    status: members.length > 0 ? 'ok' : 'empty',
  }
}

async function readGroupHealthSummary(
  vaultRoot: string,
  request: z.infer<typeof groupSharedSchema>,
  scheduledOccurrenceAt: string | null,
): Promise<unknown | null> {
  const referenceAt = readExactIsoTimestamp(scheduledOccurrenceAt)
  if (referenceAt === null) {
    return null
  }
  const read = await readSharedVaultShareProjectionStore(vaultRoot)
  if (read.status === 'corrupt' || read.status === 'read_failed') {
    return emptyGroupHealthSummary(request.action, referenceAt, 'unavailable')
  }

  let timeZone: string
  try {
    timeZone = (await loadVault({ vaultRoot })).metadata.timezone
  } catch {
    return null
  }
  if (read.status === 'empty') {
    return emptyGroupHealthSummary(request.action, referenceAt, 'empty', timeZone)
  }

  const members = flattenSharedVaultShareProjectionStore(read.store)
    .map((member) => ({
      ...member,
      shares: member.shares.filter((share) =>
        GROUP_HEALTH_PROJECTION_SCOPE_KEYS.has(share.projectionScopeKey)),
    }))
    .filter((member) => member.shares.length > 0)
  const weeklyMembers = buildSharedGroupWeeklyMembers({
    members,
    referenceAt,
    timeZone,
  })
  const weeklyMemberById = new Map(
    weeklyMembers.map((member) => [member.memberId, member]),
  )
  const presentScopeKeys = new Set(
    members.flatMap((member) =>
      member.shares.map((share) => share.projectionScopeKey)),
  )
  const scopes = GROUP_HEALTH_PROJECTION_SCOPES
    .map((projectionScope) => ({
      projectionScope,
      projectionScopeKey:
        buildHostedVaultShareProjectionScopeKey(projectionScope),
    }))
    .filter(({ projectionScopeKey }) => presentScopeKeys.has(projectionScopeKey))
  const scopeIndexByKey = new Map(
    scopes.map(({ projectionScopeKey }, index) => [projectionScopeKey, index]),
  )
  const metrics = [...new Map(
    weeklyMembers.flatMap((member) =>
      member.weeklyStats.map((stat) => [
        JSON.stringify([stat.stream, stat.unit]),
        { stream: stat.stream, unit: stat.unit },
      ] as const)),
  ).values()]
    .sort((left, right) =>
      left.stream.localeCompare(right.stream) ||
      (left.unit ?? '').localeCompare(right.unit ?? ''))
  const metricIndexByKey = new Map(
    metrics.map((metric, index) => [
      JSON.stringify([metric.stream, metric.unit]),
      index,
    ]),
  )

  return {
    action: request.action,
    currentWeekFormat: ['metricIndex', 'average'],
    memberCount: members.length,
    members: members.map((member) => {
      const weekly = weeklyMemberById.get(member.memberId)
      return {
        currentWeek: (weekly?.weeklyStats ?? [])
          .map((stat): [number, number] => [
            metricIndexByKey.get(JSON.stringify([stat.stream, stat.unit]))!,
            stat.currentWeekAvg,
          ])
          .sort((left, right) => left[0] - right[0]),
        displayName: member.displayName,
        shares: member.shares
          .map((share): [number, number] => [
            scopeIndexByKey.get(share.projectionScopeKey)!,
            Math.min(
              share.records.length,
              HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
            ),
          ])
          .sort((left, right) => left[0] - right[0]),
        sleepWindows: compactRetainedSleepWindows(member, scopeIndexByKey),
      }
    }),
    metrics,
    referenceAt,
    schema: 'murph.group-health-summary.v1',
    scopeFormat: ['scopeIndex', 'retainedRecordCount'],
    scopes: scopes.map(({ projectionScope, projectionScopeKey }) => ({
      projectionKind: projectionScope.projectionKind,
      projectionScopeKey,
      ...('selector' in projectionScope
        ? { selector: projectionScope.selector }
        : {}),
    })),
    sharingMemberCount: members.length,
    sleepWindowFormat: ['scopeIndex', 'date', 'sleepStartAt', 'sleepEndAt'],
    status: members.length > 0 ? 'ok' : 'empty',
    timeZone,
  }
}

function compactRetainedSleepWindows(
  member: SharedGroupMemberView,
  scopeIndexByKey: ReadonlyMap<string, number>,
): Array<[number, string, string, string]> {
  return member.shares.flatMap((share) => {
    if (share.projectionKind !== 'sleep-times.v0') {
      return []
    }
    const scopeIndex = scopeIndexByKey.get(share.projectionScopeKey)
    if (scopeIndex === undefined) {
      return []
    }
    return share.records
      .slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS)
      .flatMap((record): Array<[number, string, string, string]> => {
        const data = record.data
        return 'sleepStartAt' in data && 'sleepEndAt' in data
          ? [[scopeIndex, data.date, data.sleepStartAt, data.sleepEndAt]]
          : []
      })
  })
}

function emptyGroupHealthSummary(
  action: 'group_shared',
  referenceAt: string,
  status: 'empty' | 'unavailable',
  timeZone?: string,
): object {
  return {
    action,
    currentWeekFormat: ['metricIndex', 'average'],
    memberCount: 0,
    members: [],
    metrics: [],
    referenceAt,
    schema: 'murph.group-health-summary.v1',
    scopeFormat: ['scopeIndex', 'retainedRecordCount'],
    scopes: [],
    sharingMemberCount: 0,
    sleepWindowFormat: ['scopeIndex', 'date', 'sleepStartAt', 'sleepEndAt'],
    status,
    ...(timeZone ? { timeZone } : {}),
  }
}

function readExactIsoTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) || date.toISOString() !== value
    ? null
    : value
}

async function readBoundGroupChallengeContext(
  vaultRoot: string,
  slug: string,
): Promise<unknown> {
  const { page } = await getKnowledgePage({
    slug,
    vault: vaultRoot,
  })
  if (page.pageType !== 'challenge' || page.status !== 'active') {
    throw new VaultCliError(
      'scheduled_challenge_not_active',
      'The scheduled challenge context is not an active challenge page.',
    )
  }

  const sections = projectScheduledGroupChallengeSections(page.body)
  if (!sections) {
    throw new VaultCliError(
      'scheduled_challenge_context_invalid',
      'The scheduled challenge page does not have the required safe section structure.',
    )
  }

  return {
    action: 'group_challenge_context',
    sections,
    status: 'active',
  }
}

interface ScheduledGroupChallengeSections {
  baselines: string
  canon: string
  comedyBank: string
  confoundersAndProtectedNotes: string
  rulesAndMetric: string
  stakes: string
  standingsSnapshots: string
}

function projectScheduledGroupChallengeSections(
  markdown: string,
): ScheduledGroupChallengeSections | null {
  const sections = scanExactLevelTwoSections(markdown)
  if (!sections) {
    return null
  }

  const baselines = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.baselines,
  )
  const canon = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.canon,
  )
  const comedyBank = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.comedyBank,
  )
  const confoundersAndProtectedNotes = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.confoundersAndProtectedNotes,
  )
  const rulesAndMetric = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.rulesAndMetric,
  )
  const stakes = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.stakes,
  )
  const standingsSnapshots = sections.get(
    GROUP_CHALLENGE_SCHEDULED_SECTION_HEADINGS.standingsSnapshots,
  )

  if (
    baselines === undefined ||
    canon === undefined ||
    comedyBank === undefined ||
    confoundersAndProtectedNotes === undefined ||
    rulesAndMetric === undefined ||
    stakes === undefined ||
    standingsSnapshots === undefined
  ) {
    return null
  }

  const projection = {
    baselines,
    canon,
    comedyBank,
    confoundersAndProtectedNotes,
    rulesAndMetric,
    stakes,
    standingsSnapshots,
  }
  return Object.values(projection).some(
    scheduledGroupChallengeSectionHasForbiddenLocator,
  )
    ? null
    : projection
}

function scheduledGroupChallengeSectionHasForbiddenLocator(
  value: string,
): boolean {
  if (
    GROUP_CHALLENGE_SCHEDULED_URI_PATTERN.test(value) ||
    GROUP_CHALLENGE_SCHEDULED_DATA_URL_PATTERN.test(value) ||
    hasNonAnchorMarkdownLinkDestination(value)
  ) {
    return true
  }

  return (value.match(GROUP_CHALLENGE_SCHEDULED_LOCATOR_TOKEN_PATTERN) ?? [])
    .some((token) => scheduledGroupChallengeTokenIsForbiddenLocator(
      token.replace(/\.+$/u, ''),
    ))
}

function hasNonAnchorMarkdownLinkDestination(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const opening = value.indexOf('](', searchFrom)
    if (opening === -1) {
      return false
    }
    let destination = opening + 2
    while (destination < value.length && value[destination]?.trim() === '') {
      destination += 1
    }
    const firstCharacter = value[destination]
    if (
      firstCharacter !== undefined &&
      firstCharacter !== ')' &&
      firstCharacter !== '#'
    ) {
      return true
    }
    searchFrom = opening + 2
  }
  return false
}

function scheduledGroupChallengeTokenIsForbiddenLocator(
  token: string,
): boolean {
  if (token.length === 0) {
    return false
  }
  if (GROUP_CHALLENGE_SCHEDULED_WINDOWS_PATH_PATTERN.test(token)) {
    return true
  }

  return token.split(':').some((candidate) => {
    if (
      (candidate.startsWith('/') && candidate.length > 1) ||
      candidate.startsWith('~/') ||
      candidate.startsWith('./') ||
      candidate.startsWith('../') ||
      candidate.startsWith('\\\\') ||
      GROUP_CHALLENGE_SCHEDULED_VAULT_FILES.has(candidate) ||
      GROUP_CHALLENGE_SCHEDULED_VAULT_PATH_ROOTS.some(
        (root) => candidate.startsWith(`${root}/`),
      ) ||
      isContractId(candidate) ||
      GROUP_CHALLENGE_SCHEDULED_UUID_PATTERN.test(candidate) ||
      GROUP_CHALLENGE_SCHEDULED_SHA256_PATTERN.test(candidate)
    ) {
      return true
    }

    const normalized = candidate.toLowerCase()
    return normalized.startsWith('www.') ||
      GROUP_CHALLENGE_SCHEDULED_PRIVATE_ID_PREFIXES.some(
        (prefix) =>
          candidate.startsWith(prefix) && candidate.length > prefix.length,
      )
  })
}

function scanExactLevelTwoSections(
  markdown: string,
): Map<string, string> | null {
  const sections = new Map<string, string>()
  let activeHeading: string | null = null
  let activeLines: string[] = []
  let fence: MarkdownFence | null = null

  const commitActiveSection = (): boolean => {
    if (activeHeading === null) {
      return true
    }
    if (sections.has(activeHeading)) {
      return false
    }
    sections.set(activeHeading, activeLines.join('\n').trim())
    return true
  }

  const lines = markdown
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
  for (const line of lines) {
    if (fence) {
      if (activeHeading !== null) {
        activeLines.push(line)
      }
      if (closesMarkdownFence(line, fence)) {
        fence = null
      }
      continue
    }

    const openingFence = readMarkdownFence(line)
    if (openingFence) {
      fence = openingFence
      if (activeHeading !== null) {
        activeLines.push(line)
      }
      continue
    }

    const heading = readExactLevelTwoHeading(line)
    if (heading !== null) {
      if (!commitActiveSection()) {
        return null
      }
      activeHeading = GROUP_CHALLENGE_SCHEDULED_SECTION_HEADING_SET.has(heading)
        ? heading
        : null
      activeLines = []
      continue
    }

    if (activeHeading !== null) {
      activeLines.push(line)
    }
  }

  return fence === null && commitActiveSection() ? sections : null
}

interface MarkdownFence {
  character: '`' | '~'
  length: number
}

function readExactLevelTwoHeading(line: string): string | null {
  if (!line.startsWith('## ') || line.startsWith('### ')) {
    return null
  }
  const heading = line.slice(3).trimEnd()
  return heading.length > 0 ? heading : null
}

function readMarkdownFence(line: string): MarkdownFence | null {
  const content = stripMarkdownFenceIndent(line)
  if (content === null) {
    return null
  }
  const character = content[0]
  if (character !== '`' && character !== '~') {
    return null
  }
  const length = countLeadingCharacter(content, character)
  return length >= 3 ? { character, length } : null
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
  const content = stripMarkdownFenceIndent(line)
  if (content === null) {
    return false
  }
  const length = countLeadingCharacter(content, fence.character)
  return length >= fence.length && content.slice(length).trim().length === 0
}

function stripMarkdownFenceIndent(line: string): string | null {
  let indent = 0
  while (indent < line.length && line[indent] === ' ') {
    indent += 1
  }
  return indent <= 3 ? line.slice(indent) : null
}

function countLeadingCharacter(value: string, character: string): number {
  let length = 0
  while (value[length] === character) {
    length += 1
  }
  return length
}

async function readRegisteredSkill(slug: string): Promise<{
  action: 'skill_get'
  content: string
  slug: string
}> {
  if (!REGISTERED_SKILL_SLUGS.has(slug)) {
    throw new ScheduledSkillReadError('scheduled_skill_unavailable')
  }

  const root = path.resolve(resolveAssistantSkillsRoot())
  const candidate = path.resolve(root, slug, 'SKILL.md')
  if (!isContainedPath(root, candidate)) {
    throw new ScheduledSkillReadError('scheduled_skill_unavailable')
  }

  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ])
  if (!isContainedPath(resolvedRoot, resolvedCandidate)) {
    throw new ScheduledSkillReadError('scheduled_skill_unavailable')
  }

  const metadata = await stat(resolvedCandidate)
  if (!metadata.isFile() || metadata.size > SKILL_FILE_MAX_BYTES) {
    throw new ScheduledSkillReadError(
      metadata.size > SKILL_FILE_MAX_BYTES
        ? 'scheduled_skill_result_too_large'
        : 'scheduled_skill_unavailable',
    )
  }

  const content = await readFile(resolvedCandidate, 'utf8')
  if (new TextEncoder().encode(content).byteLength > SKILL_FILE_MAX_BYTES) {
    throw new ScheduledSkillReadError('scheduled_skill_result_too_large')
  }

  return { action: 'skill_get', content, slug }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

class ScheduledSkillReadError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function serializeBounded(value: unknown): string | null {
  try {
    const text = JSON.stringify(value) ?? 'null'
    return new TextEncoder().encode(text).byteLength <= TOOL_RESULT_MAX_BYTES
      ? text
      : null
  } catch {
    return null
  }
}

function scheduledReadTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
