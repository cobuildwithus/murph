import { Cli, z } from 'incur'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import { saveEncounterBundleRecord } from '@murphai/vault-usecases/encounters'

export const encounterCommandDescriptions = {
  root: 'Encounter-centered clinical record commands.',
  save:
    'Save one encounter plus linked visit facts such as vitals, ordered procedures, and tests from a JSON payload file or stdin.',
  saveHint:
    'Use for imported visit summaries after raw document import. Child events are saved as canonical events and linked back to the encounter with related_to.',
} as const

export const encounterSaveResultSchema = z.object({
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

  encounter.command('save', {
    description: encounterCommandDescriptions.save,
    args: z.object({}),
    examples: [
      {
        description: 'Save a structured visit summary extracted from an imported medical record.',
        args: {},
        options: {
          vault: './vault',
          input: '@encounter.json',
        },
      },
    ],
    hint: encounterCommandDescriptions.saveHint,
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('Encounter bundle payload in @file.json form or - for stdin.'),
    }),
    output: encounterSaveResultSchema,
    async run({ options }) {
      return saveEncounterBundleRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  cli.command(encounter)
}
