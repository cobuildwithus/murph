import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Cli, z } from 'incur'
import {
  buildHostedVaultShareProjectionScopeKey,
  flattenSharedVaultShareProjectionStore,
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  parseSharedVaultShareProjectionStore,
  SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
  type SharedGroupMemberView,
  type SharedVaultShareProjectionsFile,
} from '@murphai/hosted-execution/vault-share'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const groupSharedProjectionKindSchema = z.enum(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
)

const groupSharedProjectionScopeKeys = new Set(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) =>
    buildHostedVaultShareProjectionScopeKey(scope)
  ),
)

const groupSharedProjectionScopeKeySchema = z.string().refine(
  (value) => groupSharedProjectionScopeKeys.has(value),
  { message: 'Unsupported vault-share projection scope key.' },
)

const groupSharedRecordSchema = z.object({
  data: z.unknown(),
  occurredAt: z.string(),
  recordKey: z.string(),
  sourceRevision: z.string().optional(),
})

const groupSharedMemberShareSchema = z.object({
  // Bound to the closed projection-kind registry: the flatten only emits registry
  // kinds, so this tightens the output/--json contract to exactly the kinds the
  // shared vault-share contract can produce (never a raw string).
  projectionKind: z.enum(HOSTED_VAULT_SHARE_PROJECTION_KINDS),
  projectionScope: z.unknown(),
  projectionScopeKey: z.string(),
  records: z.array(groupSharedRecordSchema),
})

const groupSharedMemberSchema = z.object({
  displayName: z.string().nullable(),
  memberId: z.string(),
  shares: z.array(groupSharedMemberShareSchema),
})

export const groupSharedResultSchema = z.object({
  memberCount: z.number().int().nonnegative(),
  members: z.array(groupSharedMemberSchema),
  sharingMemberCount: z.number().int().nonnegative(),
  status: z.enum(['ok', 'empty', 'unavailable']),
})

export type GroupSharedResult = z.infer<typeof groupSharedResultSchema>

type SharedProjectionStoreReadResult =
  | { status: 'ok'; store: SharedVaultShareProjectionsFile }
  | { status: 'empty' }
  | { status: 'unavailable' }

export function registerGroupCommands(cli: Cli.Cli) {
  const group = Cli.create('group', {
    description:
      "Read the data group members have consented to share with this group runtime, so the group assistant can run challenges over it.",
  })

  group.command('shared', {
    description:
      "Show the consented data members share with this group, grouped by member and joined to each member's shared display name.",
    args: emptyArgsSchema,
    options: withBaseOptions({
      kind: z
        .array(groupSharedProjectionKindSchema)
        .optional()
        .describe(
          'Optional fixed projection-kind filter. Repeat --kind for fixed metrics such as --kind steps-days.v0. Use --scope for selector-scoped activity challenge data.',
        ),
      scope: z
        .array(groupSharedProjectionScopeKeySchema)
        .optional()
        .describe(
          'Optional exact projection-scope filter. Use activity-minutes-days.v1.activityKind.running, activity-distance-days.v1.activityKind.running, or activity-session-count-days.v1.activityKind.running for activity-specific challenge data.',
        ),
    }),
    examples: [
      {
        description: 'Read everything members have shared with this group before running a challenge.',
        options: { vault: './vault' },
      },
      {
        description: 'Build a steps leaderboard from the shared daily step totals.',
        options: { kind: ['steps-days.v0'], vault: './vault' },
      },
      {
        description: 'Build a running-minutes leaderboard from shared daily running totals.',
        options: {
          scope: ['activity-minutes-days.v1.activityKind.running'],
          vault: './vault',
        },
      },
      {
        description: 'Build a running-distance leaderboard from shared daily running distance totals.',
        options: {
          scope: ['activity-distance-days.v1.activityKind.running'],
          vault: './vault',
        },
      },
      {
        description: 'Build a running-session-count leaderboard from shared daily running session counts.',
        options: {
          scope: ['activity-session-count-days.v1.activityKind.running'],
          vault: './vault',
        },
      },
    ],
    hint:
      'Empty until members have connected the relevant data and their runtime has next woken. When empty, say so plainly and never invent figures.',
    output: groupSharedResultSchema,
    async run({ options }) {
      const result = await buildGroupSharedResult({
        kinds: options.kind ?? null,
        scopeKeys: options.scope ?? null,
        vault: options.vault,
      })
      return groupSharedResultSchema.parse(result)
    },
  })

  cli.command(group)
}

export async function buildGroupSharedResult(input: {
  kinds: readonly HostedVaultShareProjectionKind[] | null
  scopeKeys?: readonly string[] | null
  vault: string
}): Promise<GroupSharedResult> {
  const read = await readSharedProjectionStore(input.vault)
  if (read.status === 'unavailable') {
    return { memberCount: 0, members: [], sharingMemberCount: 0, status: 'unavailable' }
  }

  const view = read.status === 'empty'
    ? []
    : flattenSharedVaultShareProjectionStore(read.store)
  const members = applyShareFilter(view, {
    kinds: input.kinds,
    scopeKeys: input.scopeKeys ?? null,
  })

  return {
    memberCount: members.length,
    members: members.map(toMemberOutput),
    sharingMemberCount: members.filter((member) => member.shares.length > 0).length,
    status: members.length > 0 ? 'ok' : 'empty',
  }
}

/**
 * Narrow each member's shares to the requested scopes/kinds and drop members left with
 * nothing, so `--scope activity-minutes-days.v1.activityKind.running` returns a focused
 * leaderboard. No filter returns the full view, including members who have only shared
 * their name (empty shares).
 */
function applyShareFilter(
  view: readonly SharedGroupMemberView[],
  filters: {
    kinds: readonly HostedVaultShareProjectionKind[] | null
    scopeKeys: readonly string[] | null
  },
): SharedGroupMemberView[] {
  const kindSet = filters.kinds && filters.kinds.length > 0
    ? new Set<HostedVaultShareProjectionKind>(filters.kinds)
    : null
  const scopeKeySet = filters.scopeKeys && filters.scopeKeys.length > 0
    ? new Set(filters.scopeKeys)
    : null
  if (!kindSet && !scopeKeySet) {
    return [...view]
  }
  return view
    .map((member) => ({
      ...member,
      shares: member.shares.filter((share) =>
        (kindSet ? kindSet.has(share.projectionKind) : true)
        && (scopeKeySet ? scopeKeySet.has(share.projectionScopeKey) : true)
      ),
    }))
    .filter((member) => member.shares.length > 0)
}

function toMemberOutput(member: SharedGroupMemberView) {
  return {
    displayName: member.displayName,
    memberId: member.memberId,
    shares: member.shares.map((share) => ({
      projectionKind: share.projectionKind,
      projectionScope: toProjectionScopeOutput(share.projectionScope),
      projectionScopeKey: share.projectionScopeKey,
      records: share.records.map(toRecordOutput),
    })),
  }
}

function toProjectionScopeOutput(scope: HostedVaultShareProjectionScope) {
  return scope
}

function toRecordOutput(record: HostedVaultShareDeliveryRecord) {
  return {
    data: record.data,
    occurredAt: record.occurredAt,
    recordKey: record.recordKey,
    ...(record.sourceRevision !== undefined
      ? { sourceRevision: record.sourceRevision }
      : {}),
  }
}

async function readSharedProjectionStore(
  vault: string,
): Promise<SharedProjectionStoreReadResult> {
  const path = resolve(vault, SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH)

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (hasNodeErrorCode(error, 'ENOENT')) {
      return { status: 'empty' }
    }
    throw new VaultCliError(
      'group_shared_read_failed',
      'Could not read the group shared-data store.',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'unavailable' }
  }

  const store = parseSharedVaultShareProjectionStore(parsed)
  return store ? { status: 'ok', store } : { status: 'unavailable' }
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === code
  )
}
