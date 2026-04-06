import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  listFilterSchema,
  listResultSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/assistant-engine/vault-services'

export function registerReadCommands(cli: Cli.Cli, services: VaultServices) {
  cli.command(
    'show',
    {
      description:
        'Read one canonical vault record through the query layer when you already know the exact canonical read id to inspect.',
      args: z.object({
        id: z
          .string()
          .min(1)
          .describe('Canonical read identifier to resolve with `show`.'),
      }),
      options: withBaseOptions(),
      examples: [
        {
          args: {
            id: 'evt_123',
          },
          description: 'Show one known canonical event record by its exact canonical read id.',
          options: {
            vault: './vault',
          },
        },
      ],
      hint:
        'Use generic `show` with canonical read ids such as `meal_*`, `doc_*`, `evt_*`, or `journal:*`. Prefer family-specific `manifest` commands when you need import provenance rather than the canonical read-model record.',
      output: showResultSchema,
      async run({ args, options }) {
        return services.query.show({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(
    'list',
    {
      description:
        'List canonical vault records through the query layer when you need filtered recent records rather than one exact id.',
      args: z.object({}),
      options: withBaseOptions({
        recordType: listFilterSchema.shape.recordType,
        kind: listFilterSchema.shape.kind,
        status: listFilterSchema.shape.status,
        stream: listFilterSchema.shape.stream,
        experiment: listFilterSchema.shape.experiment,
        from: listFilterSchema.shape.from,
        to: listFilterSchema.shape.to,
        tag: listFilterSchema.shape.tag,
        limit: listFilterSchema.shape.limit,
      }),
      examples: [
        {
          description: 'List recent meal-related event records from the last week.',
          options: {
            kind: 'meal',
            from: '2026-04-01',
            to: '2026-04-07',
            vault: './vault',
          },
        },
        {
          description: 'List active protocols with a smaller page size.',
          options: {
            recordType: ['protocol'],
            status: 'active',
            limit: 10,
            vault: './vault',
          },
        },
      ],
      hint:
        'Use `list` for family/kind/status/tag/date filtering, `search query` for fuzzy text recall, and `timeline` for chronology across record types.',
      output: listResultSchema,
      async run({ options }) {
        return services.query.list({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          recordType: options.recordType,
          kind: options.kind,
          status: options.status,
          stream: options.stream,
          experiment: options.experiment,
          from: options.from,
          to: options.to,
          tag: options.tag,
          limit: options.limit,
        })
      },
    },
  )
}
