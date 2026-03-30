import { Cli, z } from 'incur'
import {
  isoTimestampSchema,
  listResultSchema,
  mealAddResultSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import {
  deleteMealRecord,
  editMealRecord,
  listMealRecords,
  mealLookupSchema,
  rawImportManifestResultSchema,
  showMealManifest,
  showMealRecord,
} from '../usecases/document-meal-read.js'
import { loadImportersRuntimeModule } from '../usecases/runtime.js'
import type { VaultServices } from '../vault-services.js'
import { registerArtifactBackedEntityGroup } from './health-command-factory.js'
import {
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerMealCommands(cli: Cli.Cli, _services: VaultServices) {
  registerArtifactBackedEntityGroup(cli, {
    commandName: 'meal',
    description: 'Meal capture commands routed through the core write API.',
    primaryAction: {
      name: 'add',
      description: 'Record a meal event using optional media references and/or a freeform note.',
      args: z.object({}),
      options: {
        photo: pathSchema
          .optional()
          .describe('Optional meal photo path.'),
        audio: pathSchema
          .optional()
          .describe('Optional audio note path.'),
        note: z
          .string()
          .min(1)
          .optional()
          .describe('Optional freeform meal description when no media is available.'),
        occurredAt: isoTimestampSchema
          .optional()
          .describe('Optional occurrence timestamp in ISO 8601 form.'),
        source: eventSourceSchema
          .optional()
          .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      },
      output: mealAddResultSchema,
      async run({ options }) {
        const importers = (await loadImportersRuntimeModule()).createImporters()
        const result = await importers.addMeal({
          photoPath: typeof options.photo === 'string' ? options.photo : undefined,
          audioPath: typeof options.audio === 'string' ? options.audio : undefined,
          vaultRoot: String(options.vault ?? ''),
          note: typeof options.note === 'string' ? options.note : undefined,
          occurredAt: typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
          source: typeof options.source === 'string' ? options.source : undefined,
        })

        return {
          vault: String(options.vault ?? ''),
          mealId: result.mealId,
          eventId: result.event.id,
          lookupId: result.event.id,
          occurredAt: result.event.occurredAt ?? null,
          photoPath: result.photo?.relativePath ?? null,
          audioPath: result.audio?.relativePath ?? null,
          manifestFile: result.manifestPath,
          note:
            result.event.note ??
            (typeof options.note === 'string' ? options.note : null),
        }
      },
    },
    show: {
      description: 'Show one meal event by meal id or event id.',
      argName: 'id',
      argSchema: mealLookupSchema,
      output: showResultSchema,
      async run(input) {
        return showMealRecord(input.vault, input.id)
      },
    },
    list: {
      description: 'List meal events with optional date bounds.',
      output: listResultSchema,
      async run(input) {
        return listMealRecords({
          vault: input.vault,
          from: input.from,
          to: input.to,
        })
      },
    },
    manifest: {
      description: 'Show the immutable raw import manifest for a meal event.',
      argName: 'id',
      argSchema: mealLookupSchema,
      output: rawImportManifestResultSchema,
      async run(input) {
        return showMealManifest(input.vault, input.id)
      },
    },
    additionalCommands: [
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: mealLookupSchema,
        },
        description:
          'Edit one meal by merging a partial JSON patch or one or more path assignments into the saved event.',
        run(input) {
          return editMealRecord({
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
          schema: mealLookupSchema,
        },
        description:
          'Delete one meal event while retaining any immutable raw artifacts and manifest files.',
        run(input) {
          return deleteMealRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })
}
