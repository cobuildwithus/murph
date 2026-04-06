import { Cli, z } from 'incur'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import { researchRunResultSchema } from '../research-cli-contracts.js'
import {
  runDeepthinkPrompt,
  runResearchPrompt,
} from '../research-runtime.js'

const researchArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe(
      'Prompt to send through review:gpt before Murph saves the captured response into research/ inside the vault.',
    ),
})

const researchOptionsSchema = withBaseOptions({
  title: z
    .string()
    .min(1)
    .optional()
    .describe('Optional note title override for the saved markdown file.'),
  chat: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional ChatGPT chat URL or id to target instead of opening a fresh thread.',
    ),
  browserPath: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Chromium-compatible browser binary override for review:gpt.'),
  timeout: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional overall browser automation timeout such as 10m or 40m. Murph defaults this to 40m when omitted.',
    ),
  waitTimeout: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional assistant-response timeout override. Usually leave this unset; it defaults to the overall timeout.',
    ),
})

function createResearchCommandDefinition(input: {
  description: string
  hint: string
  examples: Array<Record<string, unknown>>
  runPrompt: typeof runResearchPrompt
}) {
  return {
    args: researchArgsSchema,
    description: input.description,
    hint: input.hint,
    examples: input.examples,
    options: researchOptionsSchema,
    output: researchRunResultSchema,
    async run(context: {
      args: z.infer<typeof researchArgsSchema>
      options: z.infer<typeof researchOptionsSchema>
    }) {
      return input.runPrompt({
        vault: context.options.vault,
        prompt: context.args.prompt,
        title: context.options.title,
        chat: context.options.chat,
        browserPath: context.options.browserPath,
        timeout: context.options.timeout,
        waitTimeout: context.options.waitTimeout,
      })
    },
  }
}

export function registerResearchCommands(cli: Cli.Cli) {
  cli.command(
    'research',
    createResearchCommandDefinition({
      description:
        'Run ChatGPT Deep Research through review:gpt, auto-send the staged prompt, wait for the result, and save the captured markdown note under research/ in the selected vault.',
      hint:
        'Use this when you need a deeper current-evidence scan that should leave a durable markdown note in the vault. Deep Research commonly takes 10 to 60 minutes, so keep the command running unless it errors. Murph defaults the overall timeout to 40m; raise `--timeout` for longer runs, and only use `--wait-timeout` when you want a different response-wait cap. Free-tier access may be more limited.',
      examples: [
        {
          args: {
            prompt:
              'Research new LDL cholesterol therapies and practical interventions from the last 30 days.',
          },
          options: {
            vault: './vault',
          },
          description:
            'Run one Deep Research prompt and save the captured note into the current vault.',
        },
        {
          args: {
            prompt:
              'Check Brisbane environmental health hazards from the last week and focus on water and air quality.',
          },
          options: {
            vault: './vault',
            title: 'Brisbane environmental health watch',
            chat: 'https://chatgpt.com/c/69a86c41-cca8-8327-975a-1716caa599cf',
          },
          description:
            'Reuse one chat thread and save the note under a stable title.',
        },
      ],
      runPrompt: runResearchPrompt,
    }),
  )

  cli.command(
    'deepthink',
    createResearchCommandDefinition({
      description:
        'Run GPT Pro through review:gpt, auto-send the staged prompt, wait for the result, and save the captured markdown note under research/ in the selected vault.',
      hint:
        'Use this when you want a durable GPT Pro synthesis saved into the vault without switching into Deep Research mode. Murph still defaults the overall timeout to 40m here; `--wait-timeout` is only for the uncommon case where you want the response-wait cap different from the overall timeout. Murph will warn when the saved assistant account is not Pro.',
      examples: [
        {
          args: {
            prompt:
              'Think through the strongest arguments for and against increasing weekly zone-2 training volume.',
          },
          options: {
            vault: './vault',
          },
          description:
            'Capture one GPT Pro deepthink note into the current vault.',
        },
      ],
      runPrompt: runDeepthinkPrompt,
    }),
  )
}
