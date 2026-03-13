import { Cli, z } from 'incur'
import { defineCommand, withBaseOptions } from '../command-helpers.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const payloadSchema = z.record(z.string(), z.unknown())
const inputFileSchema = z
  .string()
  .regex(/^@.+/u, 'Expected an @file.json payload reference.')

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('profile'),
  payload: payloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  snapshotId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  currentProfilePath: pathSchema.optional(),
  created: z.boolean(),
  profile: payloadSchema.optional(),
})

const profileShowResultSchema = z.object({
  vault: pathSchema,
  entity: payloadSchema,
})

const profileListResultSchema = z.object({
  vault: pathSchema,
  items: z.array(payloadSchema),
  count: z.number().int().nonnegative(),
})

const rebuildResultSchema = z.object({
  vault: pathSchema,
  profilePath: pathSchema,
  snapshotId: z.string().min(1).nullable(),
  updated: z.boolean(),
})

interface ProfileServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldProfileSnapshot(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertProfileSnapshot(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
    rebuildCurrentProfile(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof rebuildResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showProfile(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof profileShowResultSchema>>
    listProfileSnapshots(input: {
      vault: string
      requestId: string | null
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof profileListResultSchema>>
  }
}

function stripAtPrefix(input: string) {
  return input.slice(1)
}

export function registerProfileCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as ProfileServices
  const profile = Cli.create('profile', {
    description: 'Profile snapshot commands for the health extension surface.',
  })

  profile.command(
    'scaffold',
    defineCommand({
      command: 'profile scaffold',
      description: 'Emit a payload template for a profile snapshot upsert.',
      args: z.object({}),
      options: withBaseOptions(),
      data: scaffoldResultSchema,
      async run({ vault, requestId }) {
        return healthServices.core.scaffoldProfileSnapshot({
          vault,
          requestId,
        })
      },
      renderMarkdown({ data }) {
        return `# Profile Scaffold\n\n- payloadKeys: ${Object.keys(data.payload).length}`
      },
    }),
  )

  profile.command(
    'upsert',
    defineCommand({
      command: 'profile upsert',
      description: 'Upsert one profile snapshot from an @file.json payload.',
      args: z.object({}),
      options: withBaseOptions({
        input: inputFileSchema.describe('Payload file reference in @file.json form.'),
      }),
      data: upsertResultSchema,
      async run({ options, vault, requestId }) {
        return healthServices.core.upsertProfileSnapshot({
          input: stripAtPrefix(options.input),
          vault,
          requestId,
        })
      },
      renderMarkdown({ data }) {
        return `# Profile Upserted\n\n- snapshotId: ${data.snapshotId}\n- lookupId: ${data.lookupId}\n- created: ${data.created}`
      },
    }),
  )

  profile.command(
    'show',
    defineCommand({
      command: 'profile show',
      description: 'Show one profile snapshot or the derived current profile.',
      args: z.object({
        id: z
          .string()
          .min(1)
          .describe('Snapshot id or `current`.'),
      }),
      options: withBaseOptions(),
      data: profileShowResultSchema,
      async run({ args, vault, requestId }) {
        return healthServices.query.showProfile({
          id: args.id,
          vault,
          requestId,
        })
      },
      renderMarkdown({ data }) {
        return `# Profile\n\n- keys: ${Object.keys(data.entity).length}`
      },
    }),
  )

  profile.command(
    'list',
    defineCommand({
      command: 'profile list',
      description: 'List profile snapshots through the health read model.',
      args: z.object({}),
      options: withBaseOptions({
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      data: profileListResultSchema,
      async run({ options, vault, requestId }) {
        return healthServices.query.listProfileSnapshots({
          vault,
          requestId,
          cursor: options.cursor,
          limit: options.limit,
        })
      },
      renderMarkdown({ data }) {
        return `# Profiles\n\n- count: ${data.count}`
      },
    }),
  )

  const current = Cli.create('current', {
    description: 'Derived current-profile commands.',
  })

  current.command(
    'rebuild',
    defineCommand({
      command: 'profile current rebuild',
      description: 'Rebuild bank/profile/current.md from the latest accepted profile snapshot.',
      args: z.object({}),
      options: withBaseOptions(),
      data: rebuildResultSchema,
      async run({ vault, requestId }) {
        return healthServices.core.rebuildCurrentProfile({
          vault,
          requestId,
        })
      },
      renderMarkdown({ data }) {
        return `# Current Profile Rebuilt\n\n- path: ${data.profilePath}\n- snapshotId: ${data.snapshotId ?? 'none'}\n- updated: ${data.updated}`
      },
    }),
  )

  profile.command(current)
  cli.command(profile)
}
