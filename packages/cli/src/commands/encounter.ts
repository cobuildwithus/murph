import { Cli, z } from 'incur'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import {
  encounterBundlePayloadSchema,
  importEncounterBundleRecord,
  scaffoldEncounterBundlePayload,
} from '@murphai/vault-usecases/encounters'

export const encounterCommandDescriptions = {
  root: 'Encounter-centered clinical record commands.',
  scaffold:
    'Emit a representative encounter import payload with linked vitals, procedures, and tests.',
  scaffoldHint:
    'Edit the emitted payload, keep stable eventId values for the encounter and every child fact, then import it with encounter import-json --input @encounter.json or pipe it to --input -.',
  importJson:
    'Import one encounter plus linked visit facts such as vitals, ordered procedures, and tests from a JSON payload file or stdin.',
  importJsonHint:
    'Use for imported visit summaries after raw document import. Run encounter scaffold first when you need the nested payload shape; the encounter and every child fact must include a stable eventId so retries cannot create duplicate clinical facts.',
} as const

export const encounterScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('encounter'),
  payload: encounterBundlePayloadSchema,
})

export const encounterImportResultSchema = z.object({
  vault: pathSchema,
  encounterId: z.string().min(1),
  lookupId: z.string().min(1),
  eventIds: z.array(z.string().min(1)),
  childEventIds: z.array(z.string().min(1)),
  ledgerFiles: z.array(pathSchema),
  auditPath: pathSchema,
})

export function registerEncounterCommands(cli: Cli.Cli) {
  const encounter = Cli.create('encounter', {
    description: encounterCommandDescriptions.root,
  })

  encounter.command('scaffold', {
    description: encounterCommandDescriptions.scaffold,
    args: z.object({}),
    examples: [
      {
        description: 'Emit a starter payload for a structured visit summary import.',
        args: {},
        options: {
          vault: './vault',
        },
      },
    ],
    hint: encounterCommandDescriptions.scaffoldHint,
    options: withBaseOptions(),
    output: encounterScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'encounter' as const,
        payload: scaffoldEncounterBundlePayload(),
      }
    },
  })

  encounter.command('import-json', {
    description: encounterCommandDescriptions.importJson,
    args: z.object({}),
    examples: [
      {
        description: 'Import a structured visit summary extracted from an imported medical record.',
        args: {},
        options: {
          vault: './vault',
          input: '@encounter.json',
        },
      },
    ],
    hint: encounterCommandDescriptions.importJsonHint,
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('Encounter bundle payload in @file.json form or - for stdin. Every encounter and child fact must include eventId.'),
    }),
    output: encounterImportResultSchema,
    async run({ options }) {
      return importEncounterBundleRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  cli.command(encounter)
}
