import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Cli, z } from 'incur'
import {
  flattenSharedVaultShareProjectionStore,
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  parseSharedVaultShareProjectionStore,
  SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
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
          'Optional projection-kind filter. Repeat --kind to build a single-metric leaderboard, e.g. --kind steps-days.v0.',
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
    ],
    hint:
      'Empty until members have connected the relevant data and their runtime has next woken. When empty, say so plainly and never invent figures.',
    output: groupSharedResultSchema,
    async run({ options }) {
      const result = await buildGroupSharedResult({
        kinds: options.kind ?? null,
        vault: options.vault,
      })
      return groupSharedResultSchema.parse(result)
    },
  })

  cli.command(group)
}

export async function buildGroupSharedResult(input: {
  kinds: readonly HostedVaultShareProjectionKind[] | null
  vault: string
}): Promise<GroupSharedResult> {
  const read = await readSharedProjectionStore(input.vault)
  if (read.status === 'unavailable') {
    return { memberCount: 0, members: [], sharingMemberCount: 0, status: 'unavailable' }
  }

  const view = read.status === 'empty'
    ? []
    : flattenSharedVaultShareProjectionStore(read.store)
  const members = applyKindFilter(view, input.kinds)

  return {
    memberCount: members.length,
    members: members.map(toMemberOutput),
    sharingMemberCount: members.filter((member) => member.shares.length > 0).length,
    status: members.length > 0 ? 'ok' : 'empty',
  }
}

/**
 * Narrow each member's shares to the requested kinds and drop members left with nothing,
 * so `--kind steps-days.v0` returns a focused leaderboard. No filter returns the full
 * view, including members who have only shared their name (empty shares).
 */
function applyKindFilter(
  view: readonly SharedGroupMemberView[],
  kinds: readonly HostedVaultShareProjectionKind[] | null,
): SharedGroupMemberView[] {
  if (!kinds || kinds.length === 0) {
    return [...view]
  }
  const kindSet = new Set<HostedVaultShareProjectionKind>(kinds)
  return view
    .map((member) => ({
      ...member,
      shares: member.shares.filter((share) => kindSet.has(share.projectionKind)),
    }))
    .filter((member) => member.shares.length > 0)
}

function toMemberOutput(member: SharedGroupMemberView) {
  return {
    displayName: member.displayName,
    memberId: member.memberId,
    shares: member.shares.map((share) => ({
      projectionKind: share.projectionKind,
      records: share.records.map(toRecordOutput),
    })),
  }
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
