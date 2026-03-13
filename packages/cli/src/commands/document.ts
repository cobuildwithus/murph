import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  documentImportResultSchema,
  isoTimestampSchema,
  listResultSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  documentLookupSchema,
  rawImportManifestResultSchema,
} from './document-meal-read-helpers.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerDocumentCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  const document = Cli.create('document', {
    description: 'Document ingestion commands routed through importers.',
  })

  document.command(
    'import',
    {
      description: 'Copy a source document into the vault raw area and register it.',
      args: z.object({
        file: pathSchema.describe('Path to the source document to ingest.'),
      }),
      options: withBaseOptions({
        title: z
          .string()
          .min(1)
          .optional()
          .describe('Optional document title to record on the emitted event.'),
        occurredAt: isoTimestampSchema
          .optional()
          .describe('Optional occurrence timestamp in ISO 8601 form.'),
        note: z.string().min(1).optional().describe('Optional freeform note.'),
        source: eventSourceSchema
          .optional()
          .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      }),
      output: documentImportResultSchema,
      async run({ args, options }) {
        return services.importers.importDocument({
          file: args.file,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          title: options.title,
          occurredAt: options.occurredAt,
          note: options.note,
          source: options.source,
        })
      },
    },
  )

  document.command(
    'show',
    {
      description: 'Show one imported document event by document id or event id.',
      args: z.object({
        id: documentLookupSchema,
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return services.query.showDocument({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  document.command(
    'list',
    {
      description: 'List imported document events with optional date bounds.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        from: localDateSchema
          .optional()
          .describe('Optional inclusive start date in YYYY-MM-DD form.'),
        to: localDateSchema
          .optional()
          .describe('Optional inclusive end date in YYYY-MM-DD form.'),
      }),
      output: listResultSchema,
      async run({ options }) {
        return services.query.listDocuments({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          from: options.from,
          to: options.to,
        })
      },
    },
  )

  document.command(
    'manifest',
    {
      description: 'Show the immutable raw import manifest for a document event.',
      args: z.object({
        id: documentLookupSchema,
      }),
      options: withBaseOptions(),
      output: rawImportManifestResultSchema,
      async run({ args, options }) {
        return services.query.showDocumentManifest({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(document)
}
