import { Cli, z } from 'incur'
import {
  documentImportResultSchema,
  isoTimestampSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-inbox/vault-services'
import {
  deleteDocumentRecord,
  documentLookupSchema,
  editDocumentRecord,
  rawImportManifestResultSchema,
} from '@murphai/vault-inbox/usecases/document-meal-read'
import { registerArtifactBackedEntityGroup } from './health-command-factory.js'
import {
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerDocumentCommands(
  cli: Cli.Cli,
  services: VaultServices,
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
      description: 'Show one imported document event by document id.',
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
      description: 'Show the immutable raw import manifest for a document.',
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
    additionalCommands: [
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: documentLookupSchema,
        },
        description:
          'Edit one imported document event by merging a partial JSON patch or one or more path assignments into the saved event.',
        run(input) {
          return editDocumentRecord({
            vault: input.vault,
            lookup: input.lookup,
            inputFile: input.inputFile,
            set: input.set,
            clear: input.clear,
            dayKeyPolicy: input.dayKeyPolicy,
          })
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: documentLookupSchema,
        },
        description:
          'Delete one imported document event while retaining any immutable raw artifacts and manifest files.',
        run(input) {
          return deleteDocumentRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })
}
