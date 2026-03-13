import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  healthPayloadSchema,
  registerHealthCrudCommands,
} from './health-command-factory.js'

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('profile'),
  payload: healthPayloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  snapshotId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  currentProfilePath: pathSchema.optional(),
  created: z.boolean(),
  profile: healthPayloadSchema.optional(),
})

const profileShowResultSchema = z.object({
  vault: pathSchema,
  entity: healthPayloadSchema,
})

const profileListResultSchema = z.object({
  vault: pathSchema,
  items: z.array(healthPayloadSchema),
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

export function registerProfileCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as ProfileServices
  const profile = Cli.create('profile', {
    description: 'Profile snapshot commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List profile snapshots through the health read model.',
      scaffold: 'Emit a payload template for a profile snapshot upsert.',
      show: 'Show one profile snapshot or the derived current profile.',
      upsert: 'Upsert one profile snapshot from an @file.json payload.',
    },
    examples: {
      show: [
        {
          args: {
            id: 'current',
          },
          description: 'Show the derived current profile.',
          options: {
            vault: './vault',
          },
        },
        {
          args: {
            id: '<snapshot-id>',
          },
          description: 'Show one saved profile snapshot.',
          options: {
            vault: './vault',
          },
        },
      ],
      upsert: [
        {
          description: 'Upsert one profile snapshot from a JSON payload file.',
          options: {
            input: '@profile-snapshot.json',
            vault: './vault',
          },
        },
      ],
    },
    group: profile,
    groupName: 'profile',
    hints: {
      show: 'Use `current` to read the derived profile or pass a snapshot id to inspect one saved payload.',
    },
    noun: 'profile snapshot',
    outputs: {
      list: profileListResultSchema,
      scaffold: scaffoldResultSchema,
      show: profileShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'profile-snapshot.json',
    pluralNoun: 'profile snapshots',
    services: {
      list(input) {
        return healthServices.query.listProfileSnapshots(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldProfileSnapshot(input)
      },
      show(input) {
        return healthServices.query.showProfile(input)
      },
      upsert(input) {
        return healthServices.core.upsertProfileSnapshot(input)
      },
    },
    showId: {
      description: 'Snapshot id or `current`.',
      example: 'current',
      fromUpsert(result) {
        return result.snapshotId
      },
    },
  })

  const current = Cli.create('current', {
    description: 'Derived current-profile commands.',
  })

  current.command('rebuild', {
    args: z.object({}),
    description: 'Rebuild bank/profile/current.md from the latest accepted profile snapshot.',
    examples: [
      {
        description: 'Regenerate the derived current profile after editing snapshots.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint: 'Run this after accepting a snapshot if you need to refresh the derived current profile document immediately.',
    options: withBaseOptions(),
    output: rebuildResultSchema,
    async run(context) {
      const result = await healthServices.core.rebuildCurrentProfile({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })

      return context.ok(result, {
        cta: {
          commands: [
            {
              command: 'profile show',
              args: {
                id: 'current',
              },
              description: 'Show the rebuilt derived current profile.',
              options: {
                vault: true,
              },
            },
            {
              command: 'profile list',
              description: 'List saved profile snapshots.',
              options: {
                vault: true,
              },
            },
          ],
          description: 'Suggested commands:',
        },
      })
    },
  })

  profile.command(current)
  cli.command(profile)
}
