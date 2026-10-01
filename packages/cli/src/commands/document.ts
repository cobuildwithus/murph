import path from 'node:path'
import { Cli, z } from 'incur'
import { eventSourceSchema } from '@murphai/contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  documentImportResultSchema,
  occurredAtOptionSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  deleteDocumentRecord,
  documentLookupSchema,
  editDocumentRecord,
  rawImportManifestResultSchema,
} from '@murphai/vault-usecases/records'
import { registerArtifactBackedEntityGroup } from './entity-command-groups.js'
import {
  commonListLimitOptionSchema,
  type AnyFactoryCommandConfig,
} from './command-factory-primitives.js'
import {
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const workoutImportStatusResultSchema = z.object({
  vault: pathSchema,
  rawRef: pathSchema,
  status: z.enum(['not_imported', 'completed', 'partial_conflict']),
})

function createWorkoutImportStatusCommand(services: VaultServices): AnyFactoryCommandConfig {
  return {
    name: 'workout-import-status',
    description: 'Resolve whole-source workout import completion for one preserved raw source.',
    args: z.object({
      rawRef: z
        .string()
        .regex(/^raw\/[A-Za-z0-9._/-]+$/u, 'Expected a vault-relative raw/* path.'),
    }),
    output: workoutImportStatusResultSchema,
    async run({ args, options, requestId }) {
      return services.query.resolveWorkoutImportStatusForRawSource({
        vault: String(options.vault ?? ''),
        requestId,
        rawRef: String(args.rawRef ?? ''),
      })
    },
  }
}

export function registerDocumentCommands(
  cli: Cli.Cli,
  services: VaultServices,
  inboxServices: Pick<InboxServices, 'preserveDocumentAttachment'>,
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
        occurredAt: occurredAtOptionSchema
          .optional()
          .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
        note: z.string().min(1).optional().describe('Optional freeform note.'),
        source: eventSourceSchema
          .optional()
          .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
        reuseExact: z
          .boolean()
          .default(false)
          .describe('Reuse one live document with verified identical bytes instead of creating another document.'),
      },
      output: documentImportResultSchema,
      async run({ args, options, requestId }) {
        const file = String(args.file ?? '')
        const vault = String(options.vault ?? '')
        const inboxDocumentSource = resolveDefaultInboxDocumentImportSource({
          file,
          vault,
          title: options.title,
          occurredAt: options.occurredAt,
          note: options.note,
          source: options.source,
          reuseExact: options.reuseExact,
        })
        if (inboxDocumentSource !== null) {
          const preserved = await inboxServices.preserveDocumentAttachment({
            file: inboxDocumentSource,
            vault,
            requestId,
          })
          const manifestResult = await services.query.showDocumentManifest({
            id: preserved.relatedId,
            vault,
            requestId,
          })
          const rawFile = manifestResult.manifest.artifacts.find(
            (artifact) => artifact.role === 'source_document',
          )?.relativePath
          const eventId = manifestResult.manifest.provenance.eventId
          if (
            typeof rawFile !== 'string' ||
            typeof eventId !== 'string' ||
            manifestResult.entityId !== preserved.relatedId
          ) {
            throw new VaultCliError(
              'RAW_MANIFEST_INVALID',
              'The preserved inbox document is missing its canonical import receipt.',
            )
          }

          return {
            created: preserved.created,
            vault: manifestResult.vault,
            sourceFile: file,
            rawFile,
            manifestFile: manifestResult.manifestFile,
            documentId: preserved.relatedId,
            eventId,
            lookupId: preserved.relatedId,
          }
        }

        const sourceResult = eventSourceSchema.safeParse(options.source)
        return services.importers.importDocument({
          file,
          vault,
          requestId,
          title: typeof options.title === 'string' ? options.title : undefined,
          occurredAt: await normalizeOccurredAtOption({
            vault: String(options.vault ?? ''),
            occurredAt:
              typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
          }),
          note: typeof options.note === 'string' ? options.note : undefined,
          source: sourceResult.success ? sourceResult.data : undefined,
          reuseExact: options.reuseExact === true,
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
      limitOption: commonListLimitOptionSchema,
      output: listResultSchema,
      async run(input) {
        return services.query.listDocuments({
          vault: input.vault,
          requestId: input.requestId,
          from: input.from,
          limit: input.limit,
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
      createWorkoutImportStatusCommand(services),
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: documentLookupSchema,
        },
        description:
          'Edit one imported document event from typed fields.',
        run(input) {
          return editDocumentRecord({
            vault: input.vault,
            lookup: input.lookup,
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

function resolveDefaultInboxDocumentImportSource(input: {
  file: string
  vault: string
  title: unknown
  occurredAt: unknown
  note: unknown
  source: unknown
  reuseExact: unknown
}): string | null {
  if (
    typeof input.title === 'string' ||
    typeof input.occurredAt === 'string' ||
    typeof input.note === 'string' ||
    typeof input.source === 'string' ||
    input.reuseExact === true
  ) {
    return null
  }

  const absoluteVaultRoot = path.resolve(input.vault)
  const absoluteFile = path.resolve(input.file)
  const relativePath = path.relative(absoluteVaultRoot, absoluteFile)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null
  }

  const segments = relativePath.split(path.sep)
  return segments[0] === 'raw' && segments[1] === 'inbox'
    ? absoluteFile
    : null
}
