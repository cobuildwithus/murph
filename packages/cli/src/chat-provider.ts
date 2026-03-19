import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from './assistant-cli-contracts.js'
import type { AssistantProviderTraceEvent } from './assistant/provider-traces.js'
import { executeCodexPrompt } from './assistant-codex.js'
import { VaultCliError } from './vault-cli-errors.js'
import { getAssistantBindingContextLines } from './assistant/bindings.js'
import { normalizeNullableString } from './assistant/shared.js'

export interface AssistantProviderTurnInput {
  approvalPolicy?: AssistantApprovalPolicy | null
  codexCommand?: string
  configOverrides?: readonly string[]
  env?: NodeJS.ProcessEnv
  model?: string | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean
  profile?: string | null
  prompt?: string
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  resumeProviderSessionId?: string | null
  sandbox?: AssistantSandbox | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  userPrompt?: string | null
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
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}) {
  return {
    model: normalizeNullableString(input.model),
    reasoningEffort: normalizeNullableString(input.reasoningEffort),
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
  const prompt = flattenAssistantProviderPrompt(input)

  switch (provider) {
    case 'codex-cli': {
      const result = await executeCodexPrompt({
        codexCommand: input.codexCommand,
        configOverrides: mergeCodexConfigOverrides({
          configOverrides: input.configOverrides,
          showThinkingTraces: input.showThinkingTraces ?? false,
        }),
        env: input.env,
        workingDirectory: input.workingDirectory,
        prompt,
        resumeSessionId: input.resumeProviderSessionId,
        model: normalizeNullableString(input.model),
        reasoningEffort: normalizeNullableString(input.reasoningEffort),
        sandbox: input.sandbox ?? undefined,
        approvalPolicy: input.approvalPolicy ?? undefined,
        profile: normalizeNullableString(input.profile),
        oss: input.oss ?? false,
        onTraceEvent: input.onTraceEvent,
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

export function flattenAssistantProviderPrompt(
  input: Pick<
    AssistantProviderTurnInput,
    'prompt' | 'sessionContext' | 'systemPrompt' | 'userPrompt'
  >,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new VaultCliError(
      'ASSISTANT_PROMPT_REQUIRED',
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const systemPrompt = normalizeNullableString(input.systemPrompt)
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []

  return [
    systemPrompt,
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    `User message:\n${userPrompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

function mergeCodexConfigOverrides(input: {
  configOverrides?: readonly string[]
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides = [...(input.configOverrides ?? [])]

  if (!input.showThinkingTraces) {
    return overrides.length > 0 ? overrides : input.configOverrides
  }

  upsertCodexConfigOverride(overrides, 'model_reasoning_summary', '"auto"')
  upsertCodexConfigOverride(overrides, 'hide_agent_reasoning', 'false')

  return overrides
}

function upsertCodexConfigOverride(
  overrides: string[],
  key: string,
  value: string,
): void {
  const assignmentPrefix = `${key}=`
  const existingIndex = overrides.findIndex((override) =>
    override.trim().startsWith(assignmentPrefix),
  )

  if (existingIndex >= 0) {
    overrides[existingIndex] = `${key}=${value}`
    return
  }

  overrides.push(`${key}=${value}`)
}
