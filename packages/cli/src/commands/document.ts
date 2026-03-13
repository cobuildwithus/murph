import { Cli, z } from 'incur'
import {
  documentImportResultSchema,
  isoTimestampSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  documentLookupSchema,
  rawImportManifestResultSchema,
} from './document-meal-read-helpers.js'
import { registerArtifactBackedEntityGroup } from './health-command-factory.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerDocumentCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  registerArtifactBackedEntityGroup(cli, {
    commandName: 'document',
    description: 'Document ingestion commands routed through importers.',
    primaryAction: {
      name: 'import',
      description: 'Copy a source document into the vault raw area and register it.',
      args: z.object({
        file: pathSchema.describe('Path to the source document to ingest.'),
      }),
      options: {
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
      },
      output: documentImportResultSchema,
      async run({ args, options, requestId }) {
        const sourceResult = eventSourceSchema.safeParse(options.source)
        return services.importers.importDocument({
          file: String(args.file ?? ''),
          vault: String(options.vault ?? ''),
          requestId,
          title: typeof options.title === 'string' ? options.title : undefined,
          occurredAt: typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
          note: typeof options.note === 'string' ? options.note : undefined,
          source: sourceResult.success ? sourceResult.data : undefined,
        })
      },
    },
    show: {
      description: 'Show one imported document event by document id or event id.',
      argName: 'id',
      argSchema: documentLookupSchema,
      output: showResultSchema,
      async run(input) {
        return services.query.showDocument({
          id: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List imported document events with optional date bounds.',
      output: listResultSchema,
      async run(input) {
        return services.query.listDocuments({
          vault: input.vault,
          requestId: input.requestId,
          from: input.from,
          to: input.to,
        })
      },
    },
    manifest: {
      description: 'Show the immutable raw import manifest for a document event.',
      argName: 'id',
      argSchema: documentLookupSchema,
      output: rawImportManifestResultSchema,
      async run(input) {
        return services.query.showDocumentManifest({
          id: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
  })
}
