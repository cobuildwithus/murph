import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  pathSchema,
  samplesImportCsvResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerSamplesCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  const samples = Cli.create('samples', {
    description: 'Sample ingestion commands routed through importers.',
  })

  samples.command(
    'import-csv',
    {
      description: 'Import timestamped numeric samples from a CSV file.',
      args: z.object({
        file: pathSchema.describe('Source CSV file to import.'),
      }),
      options: withBaseOptions({
        stream: z.string().min(1).describe('Stream identifier to write under.'),
        tsColumn: z
          .string()
          .min(1)
          .describe('CSV column containing timestamps.'),
        valueColumn: z
          .string()
          .min(1)
          .describe('CSV column containing the numeric value.'),
        unit: z.string().min(1).describe('Unit label for the imported values.'),
      }),
      output: samplesImportCsvResultSchema,
      async run({ args, options }) {
        return services.importers.importSamplesCsv({
          file: args.file,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          stream: options.stream,
          tsColumn: options.tsColumn,
          valueColumn: options.valueColumn,
          unit: options.unit,
        })
      },
    },
  )

  cli.command(samples)
}
