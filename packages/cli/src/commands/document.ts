import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import { documentImportResultSchema, pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

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
      options: withBaseOptions(),
      output: documentImportResultSchema,
      async run({ args, options }) {
        return services.importers.importDocument({
          file: args.file,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(document)
}
