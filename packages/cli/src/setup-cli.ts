import { Cli, z } from 'incur'
import {
  type SetupCommandOptions,
  setupCommandOptionsSchema,
  setupResultSchema,
} from './setup-cli-contracts.js'
import {
  createSetupServices,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-services.js'

interface SetupCliOptions {
  commandName?: string
  services?: ReturnType<typeof createSetupServices>
}

export function createSetupCli(options: SetupCliOptions = {}): Cli.Cli {
  const commandName = options.commandName ?? 'vault-cli'
  const services = options.services ?? createSetupServices()
  const cli = Cli.create(commandName, {
    description: 'Healthy Bob local machine setup helpers.',
  })

  cli.command('setup', {
    args: z.object({}),
    description:
      'Provision the macOS parser/runtime toolchain, initialize the vault, and run inbox bootstrap in one command.',
    examples: [
      {
        description: 'Bootstrap a local vault with the default base.en Whisper model.',
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Preview the actions without mutating the machine or vault.',
        options: {
          dryRun: true,
          vault: './vault',
        },
      },
      {
        description: 'Skip OCR and choose a different Whisper model.',
        options: {
          skipOcr: true,
          vault: './vault',
          whisperModel: 'small.en',
        },
      },
    ],
    hint:
      'Use the repo-local scripts/setup-macos.sh wrapper when the workspace itself still needs Node, pnpm, and a build before this command can run.',
    options: setupCommandOptionsSchema,
    output: setupResultSchema,
    async run(context) {
      const result = await services.setupMacos({
        dryRun: context.options.dryRun,
        rebuild: context.options.rebuild,
        requestId: context.options.requestId ?? null,
        skipOcr: context.options.skipOcr,
        strict: context.options.strict,
        toolchainRoot: context.options.toolchainRoot,
        vault: context.options.vault,
        whisperModel: context.options.whisperModel,
      })

      if (result.dryRun) {
        return context.ok(result)
      }

      const vaultArgument = formatCliPathArgument(result.vault)

      return context.ok(result, {
        cta: {
          description: 'Suggested next commands:',
          commands: [
            {
              command: `inbox doctor --vault ${vaultArgument}`,
              description: 'Verify the local runtime after setup.',
            },
            {
              command: `inbox source add imessage --id imessage:self --account self --includeOwn --vault ${vaultArgument}`,
              description:
                'Add a local iMessage connector when you are ready to ingest captures.',
            },
          ],
        },
      })
    },
  })

  return cli
}

function formatCliPathArgument(value: string): string {
  if (value === '~') {
    return '"$HOME"'
  }

  if (value.startsWith('~/')) {
    return `"${'$'}HOME"${quoteShellArgument(value.slice(1))}`
  }

  return quoteShellArgument(value)
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
}

export { detectSetupProgramName, isSetupInvocation }
export type { SetupCommandOptions }
