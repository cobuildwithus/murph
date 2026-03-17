import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
} from './assistant-cli-contracts.js'
import { executeCodexPrompt } from './assistant-codex.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface AssistantProviderTurnInput {
  approvalPolicy?: AssistantApprovalPolicy | null
  codexCommand?: string
  model?: string | null
  oss?: boolean
  profile?: string | null
  prompt: string
  provider?: AssistantChatProvider
  resumeProviderSessionId?: string | null
  sandbox?: AssistantSandbox | null
  workingDirectory: string
}

export interface AssistantProviderTurnResult {
  provider: AssistantChatProvider
  providerSessionId: string | null
  response: string
  stderr: string
  stdout: string
  rawEvents: unknown[]
}

export function resolveAssistantProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  sandbox?: AssistantSandbox | null
}) {
  return {
    model: normalizeNullableString(input.model),
    sandbox: input.sandbox ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    profile: normalizeNullableString(input.profile),
    oss: input.oss ?? false,
  }
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnResult> {
  const provider = input.provider ?? 'codex-cli'

  switch (provider) {
    case 'codex-cli': {
      const result = await executeCodexPrompt({
        codexCommand: input.codexCommand,
        workingDirectory: input.workingDirectory,
        prompt: input.prompt,
        resumeSessionId: input.resumeProviderSessionId,
        model: normalizeNullableString(input.model),
        sandbox: input.sandbox ?? undefined,
        approvalPolicy: input.approvalPolicy ?? undefined,
        profile: normalizeNullableString(input.profile),
        oss: input.oss ?? false,
      })

      return {
        provider,
        providerSessionId: result.sessionId,
        response: result.finalMessage,
        stderr: result.stderr,
        stdout: result.stdout,
        rawEvents: result.jsonEvents,
      }
    }

    default:
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        `Assistant provider "${provider}" is not supported in this build.`,
      )
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
