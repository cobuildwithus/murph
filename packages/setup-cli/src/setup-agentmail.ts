import { createInterface } from 'node:readline'
import {
  createAgentmailApiClient,
  listAllAgentmailInboxes,
  matchesAgentmailHttpError,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
  type AgentmailApiClient,
  type AgentmailInbox,
} from '@murphai/operator-config/agentmail-runtime'
import { normalizeNullableString } from '@murphai/operator-config/assistant/shared'
import { prepareSetupPromptInput } from '@murphai/operator-config/setup-prompt-io'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface SetupAgentmailInboxSelection {
  accountId: string
  emailAddress: string | null
  mode: 'discovered' | 'manual' | 'selected'
}

export interface SetupAgentmailPrompter {
  chooseInbox(input: {
    inboxes: readonly AgentmailInbox[]
  }): Promise<AgentmailInbox | null>
  promptManualInboxId(): Promise<string | null>
}

export type SetupAgentmailSelectionResolver = (input: {
  allowPrompt: boolean
  env: NodeJS.ProcessEnv
}) => Promise<SetupAgentmailInboxSelection | null>

interface SetupAgentmailSelectionResolverDependencies {
  createClient?: (input: {
    apiKey: string
    baseUrl?: string
  }) => AgentmailApiClient
  prompter?: SetupAgentmailPrompter
}

export function createSetupAgentmailSelectionResolver(
  dependencies: SetupAgentmailSelectionResolverDependencies = {},
): SetupAgentmailSelectionResolver {
  const createClient =
    dependencies.createClient ??
    ((input: { apiKey: string; baseUrl?: string }) =>
      createAgentmailApiClient(input.apiKey, {
        baseUrl: input.baseUrl,
      }))
  const prompter = dependencies.prompter ?? createSetupAgentmailPrompter()

  return async (input) => {
    const apiKey = resolveAgentmailApiKey(input.env)
    if (!apiKey) {
      return null
    }

    const client = createClient({
      apiKey,
      baseUrl: resolveAgentmailBaseUrl(input.env) ?? undefined,
    })

    try {
      const inboxes = await listAllAgentmailInboxes(client)
      if (inboxes.length === 1) {
        const inbox = inboxes[0]!
        return {
          accountId: inbox.inbox_id,
          emailAddress: normalizeNullableString(inbox.email),
          mode: 'discovered',
        }
      }

      if (inboxes.length > 1 && input.allowPrompt) {
        const selected = await prompter.chooseInbox({
          inboxes,
        })
        if (selected) {
          return {
            accountId: selected.inbox_id,
            emailAddress: normalizeNullableString(selected.email),
            mode: 'selected',
          }
        }
      }

      return null
    } catch (error) {
      if (
        matchesAgentmailHttpError(error, {
          status: 403,
          method: 'GET',
          path: '/inboxes',
        })
      ) {
        if (!input.allowPrompt) {
          return null
        }

        const accountId = await prompter.promptManualInboxId()
        if (!accountId) {
          return null
        }

        return {
          accountId,
          emailAddress: null,
          mode: 'manual',
        }
      }

      if (error instanceof Error) {
        throw error
      }

      throw new Error(String(error))
    }
  }
}

export function createSetupAgentmailPrompter(input: {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
} = {}): SetupAgentmailPrompter {
  const stdin = input.input ?? process.stdin
  const stderr = input.output ?? process.stderr

  return {
    async chooseInbox(context) {
      stderr.write(
        '\nMurph found multiple AgentMail inboxes for this API key:\n',
      )
      context.inboxes.forEach((inbox, index) => {
        const display =
          normalizeNullableString(inbox.display_name) ??
          normalizeNullableString(inbox.email) ??
          inbox.inbox_id
        const suffix =
          normalizeNullableString(inbox.email) &&
          normalizeNullableString(inbox.email) !== display
            ? ` (${inbox.email})`
            : ''
        stderr.write(`  ${index + 1}. ${display}${suffix}\n`)
      })
      stderr.write('\n')

      while (true) {
        const answer = await promptForLine({
          input: stdin,
          output: stderr,
          prompt:
            'Choose an inbox number to reuse, or press Enter to try provisioning a new inbox: ',
        })
        if (!answer) {
          return null
        }

        const numericIndex = Number.parseInt(answer, 10)
        if (
          Number.isFinite(numericIndex) &&
          numericIndex >= 1 &&
          numericIndex <= context.inboxes.length
        ) {
          return context.inboxes[numericIndex - 1] ?? null
        }

        stderr.write(
          `Enter a number between 1 and ${context.inboxes.length}, or press Enter to skip.\n`,
        )
      }
    },

    async promptManualInboxId() {
      stderr.write(
        '\nAgentMail inbox discovery is not available for this API key.\n',
      )
      const accountId = await promptForLine({
        input: stdin,
        output: stderr,
        prompt:
          'Enter an existing AgentMail inbox id from the dashboard (often the inbox email address), or press Enter to try provisioning a new inbox: ',
      })
      return accountId ? accountId : null
    },
  }
}

async function promptForLine(input: {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  prompt: string
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    prepareSetupPromptInput(input.input)
    const readline = createInterface({
      input: input.input,
      output: input.output,
    })

    const cancel = () => {
      readline.close()
      reject(
        new VaultCliError('setup_cancelled', 'Murph setup was cancelled.'),
      )
    }

    readline.once('SIGINT', cancel)
    readline.question(input.prompt, (answer) => {
      readline.removeListener('SIGINT', cancel)
      readline.close()
      resolve(answer.trim())
    })
  })
}
