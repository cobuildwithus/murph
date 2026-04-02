import { Cli, z } from 'incur'
import {
  assistantApprovalPolicyValues,
  assistantAskResultSchema,
  assistantChatProviderValues,
  assistantChatResultSchema,
  assistantCronAddResultSchema,
  assistantCronListResultSchema,
  assistantCronPresetInstallResultSchema,
  assistantCronPresetListResultSchema,
  assistantCronPresetShowResultSchema,
  assistantCronRemoveResultSchema,
  assistantCronRunResultSchema,
  assistantCronRunsResultSchema,
  assistantCronShowResultSchema,
  assistantCronStatusResultSchema,
  assistantCronTargetSetResultSchema,
  assistantCronTargetShowResultSchema,
  assistantDeliverResultSchema,
  assistantDoctorResultSchema,
  assistantMemoryForgetResultSchema,
  assistantMemoryGetResultSchema,
  assistantMemoryLongTermSectionValues,
  assistantMemoryQueryScopeValues,
  assistantMemorySearchResultSchema,
  assistantMemoryUpsertResultSchema,
  assistantMemoryVisibleSectionValues,
  assistantMemoryWriteScopeValues,
  assistantRunResultSchema,
  assistantStateDeleteResultSchema,
  assistantStateListResultSchema,
  assistantStatePatchResultSchema,
  assistantStatePutResultSchema,
  assistantStateShowResultSchema,
  assistantSelfDeliveryTargetClearResultSchema,
  assistantSelfDeliveryTargetListResultSchema,
  assistantSelfDeliveryTargetSetResultSchema,
  assistantSelfDeliveryTargetShowResultSchema,
  assistantSandboxValues,
  assistantSessionListResultSchema,
  assistantSessionShowResultSchema,
  assistantStopResultSchema,
  assistantStatusResultSchema,
} from '@murphai/assistant-core/assistant-cli-contracts'
import { deliverAssistantMessage } from '@murphai/assistant-core/outbound-channel'
import type { ConversationRef } from '@murphai/assistant-core/assistant-runtime'
import {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronPreset,
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  getAssistantStateDocument,
  installAssistantCronPreset,
  listAssistantCronPresets,
  listAssistantCronJobs,
  listAssistantCronRuns,
  listAssistantStateDocuments,
  deleteAssistantStateDocument,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  removeAssistantCronJob,
  runAssistantAutomation,
  runAssistantChat,
  runAssistantCronJobNow,
  sendAssistantMessage,
  setAssistantCronJobTarget,
  setAssistantCronJobEnabled,
  stopAssistantAutomation,
} from '../assistant-runtime.js'
import { runAssistantDoctor } from '../assistant/doctor.js'
import { getAssistantStatus } from '../assistant/status.js'
import {
  redactAssistantSessionForDisplay,
  redactAssistantSessionsForDisplay,
} from '@murphai/assistant-core/assistant-runtime'
import {
  assertAssistantMemoryTurnContextVault,
  forgetAssistantMemory,
  getAssistantMemory,
  redactAssistantMemoryRecord,
  redactAssistantMemorySearchHit,
  resolveAssistantMemoryStoragePaths,
  resolveAssistantMemoryTurnContext,
  searchAssistantMemory,
  upsertAssistantMemory,
} from '@murphai/assistant-core/assistant-runtime'
import {
  redactAssistantDisplayPath,
  getAssistantSession,
  listAssistantSessions,
  redactAssistantStateDocumentListEntry,
  redactAssistantStateDocumentSnapshot,
  resolveAssistantStatePaths,
} from '@murphai/assistant-core/assistant-state'
import {
  emptyArgsSchema,
  parseHeadersJsonOption,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/assistant-core/command-helpers'
import type { InboxServices } from '@murphai/assistant-core/inbox-services'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/assistant-core/json-input'
import { normalizeRepeatableFlagOption } from '@murphai/assistant-core/option-utils'
import {
  applyAssistantSelfDeliveryTargetDefaults,
  clearAssistantSelfDeliveryTargets,
  listAssistantSelfDeliveryTargets,
  resolveAssistantSelfDeliveryTarget,
  resolveOperatorConfigPath,
  saveAssistantSelfDeliveryTarget,
} from '@murphai/assistant-core/operator-config'
import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
} from '../run-terminal-logging.js'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import type { VaultServices } from '@murphai/assistant-core/vault-services'
import { requestIdSchema } from '@murphai/assistant-core/vault-cli-contracts'

const assistantSessionOptionFields = {
  session: z
    .string()
    .min(1)
    .optional()
    .describe('Existing Murph assistant session id to resume.'),
  alias: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional stable alias used to map an external conversation onto one assistant session.',
    ),
  channel: z
    .string()
    .min(1)
    .optional()
    .describe('Optional channel label such as imessage, telegram, linq, or email.'),
  identity: z
    .string()
    .min(1)
    .optional()
    .describe('Optional local assistant identity id for multi-user routing.'),
  participant: z
    .string()
    .min(1)
    .optional()
    .describe('Optional remote actor id for multi-user routing and direct-conversation binding.'),
  sourceThread: z
    .string()
    .min(1)
    .optional()
    .describe('Optional upstream thread id from the source channel. Thread ids anchor stored conversation bindings when present.'),
}

const assistantProviderOptionFields = {
  provider: z
    .enum(assistantChatProviderValues)
    .optional()
    .describe(
      'Chat provider adapter for the local assistant surface. The runtime is provider-backed even when only one adapter is installed.',
    ),
  codexCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex CLI executable path. Defaults to `codex`.'),
  model: z
    .string()
    .min(1)
    .optional()
    .describe('Optional provider model override for local chat turns.'),
  baseUrl: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional OpenAI-compatible base URL for local assistant chat, such as http://127.0.0.1:11434/v1 for Ollama.',
    ),
  apiKeyEnv: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional environment variable name that stores the OpenAI-compatible API key for local assistant chat.',
    ),
  providerName: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional stable provider label for OpenAI-compatible local assistant chat sessions.',
    ),
  headersJson: z
    .string()
    .min(1)
    .optional()
    .describe('Optional JSON object of extra HTTP headers for OpenAI-compatible local assistant chat sessions.'),
  sandbox: z
    .enum(assistantSandboxValues)
    .optional()
    .describe(
      'Codex sandbox mode for local assistant chat. Codex runs as a privileged local adapter by default, so leaving this unset keeps its normal unsandboxed behavior.',
    ),
  approvalPolicy: z
    .enum(assistantApprovalPolicyValues)
    .optional()
    .describe(
      'Codex approval policy for local assistant chat. Defaults to never for the privileged local Codex adapter.',
    ),
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex config profile name.'),
  oss: z
    .boolean()
    .optional()
    .describe(
      'Use Codex OSS mode, which expects a local Ollama-backed open-source provider.',
    ),
}

const assistantDeliveryOptionFields = {
  deliverResponse: z
    .boolean()
    .optional()
    .describe(
      'After generating a response, deliver it over the mapped outbound channel session when available.',
    ),
  deliveryTarget: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for Linq it can be a chat id; for email it can be a recipient address while thread-bound sessions reply in place.',
  ),
}

const assistantCronDeliveryOptionFields = {
  deliveryTarget: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional explicit outbound destination for each cron run. For iMessage this can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for Linq it can be a chat id; for email it can be a recipient address while thread-bound cron jobs reply in place.',
    ),
}

const assistantCronTargetSourceOptionFields = {
  copyFrom: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Copy the current delivery target from another assistant cron job instead of providing route flags directly.',
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe('Validate and preview the target change without writing scheduler state.'),
  resetContinuity: z
    .boolean()
    .optional()
    .describe(
      'Clear the saved sessionId and alias while retargeting so the next run starts fresh instead of rebinding the existing assistant session.',
    ),
  toSelf: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Use the saved self-delivery target for one channel, such as email or telegram.',
    ),
}

const assistantCronStateOptionFields = {
  state: z
    .boolean()
    .optional()
    .describe(
      'Bind this cron job to a default assistant state document under assistant-state/state/cron/<jobId>.json. Use this only when the cron needs run-to-run scratch state such as cooldowns, dedupe, unresolved follow-ups, or delivery policy.',
    ),
  stateDoc: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional explicit assistant state document id to bind to this cron job, such as cron/weekly-health-snapshot. Prefer this only when the cron needs stable cross-run scratch state or must share one state doc across related jobs.',
    ),
}

const assistantSelfDeliveryTargetOptionFields = {
  identity: z
    .string()
    .min(1)
    .optional()
    .describe('Optional local assistant identity id to reuse for this saved channel target.'),
  participant: z
    .string()
    .min(1)
    .optional()
    .describe('Optional remote actor id to reuse for this saved channel target.'),
  sourceThread: z
    .string()
    .min(1)
    .optional()
    .describe('Optional upstream thread id to reuse for this saved channel target.'),
  deliveryTarget: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional explicit outbound destination to save for this channel target, such as a phone number, Telegram chat id, or email address.',
    ),
}

function parseAssistantCronPresetVariables(
  value: readonly string[] | undefined,
): Record<string, string> {
  const entries = normalizeRepeatableFlagOption(value, 'var') ?? []
  const variables: Record<string, string> = {}

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new VaultCliError(
        'invalid_option',
        'Preset variables must use key=value form. Repeat --var for multiple values.',
      )
    }

    const key = entry.slice(0, separatorIndex).trim()
    const variableValue = entry.slice(separatorIndex + 1).trim()

    if (key.length === 0 || variableValue.length === 0) {
      throw new VaultCliError(
        'invalid_option',
        'Preset variables must use key=value form with non-empty keys and values.',
      )
    }

    if (Object.hasOwn(variables, key)) {
      throw new VaultCliError(
        'invalid_option',
        `Preset variable "${key}" was provided more than once. Repeat --var only for different keys.`,
      )
    }

    variables[key] = variableValue
  }

  return variables
}

function assertAssistantSelfDeliveryTargetInput(input: {
  channel: string
  deliveryTarget?: string
  identity?: string
  participant?: string
  sourceThread?: string
}) {
  if (!input.deliveryTarget && !input.participant && !input.sourceThread) {
    throw new VaultCliError(
      'invalid_option',
      'Saved self delivery targets require at least --participant, --sourceThread, or --deliveryTarget.',
    )
  }

  if (input.channel === 'email' && !input.identity) {
    throw new VaultCliError(
      'invalid_option',
      'Saved email self delivery targets require --identity with the configured AgentMail inbox id.',
    )
  }
}

const assistantChatArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe('Optional first prompt to send before the chat loop starts.'),
})

const assistantChatOptionsSchema = withBaseOptions({
  ...assistantSessionOptionFields,
  ...assistantProviderOptionFields,
})

type AssistantChatArgs = z.infer<typeof assistantChatArgsSchema>
type AssistantChatOptions = z.infer<typeof assistantChatOptionsSchema>

type AssistantConversationCliOptions = {
  alias?: string
  channel?: string
  identity?: string
  participant?: string
  session?: string
  sourceThread?: string
}

type AssistantProviderCliOptions = {
  apiKeyEnv?: string
  approvalPolicy?: AssistantChatOptions['approvalPolicy']
  baseUrl?: string
  codexCommand?: string
  headersJson?: string
  model?: string
  oss?: boolean
  profile?: string
  provider?: AssistantChatOptions['provider']
  providerName?: string
  sandbox?: AssistantChatOptions['sandbox']
}

type AssistantDeliveryCliOptions = {
  deliverResponse?: boolean
  deliveryTarget?: string
}

function createAssistantStatusCommandDefinition(input?: {
  description?: string
  hint?: string
}) {
  return {
    args: emptyArgsSchema,
    description:
      input?.description ??
      'Show a compact assistant-state snapshot including recent turn receipts and the outbound outbox backlog.',
    hint:
      input?.hint ??
      'Use this when the assistant feels stuck, duplicated a send, or you want the latest receipt timeline without opening files under assistant-state/.',
    options: withBaseOptions({
      session: z
        .string()
        .min(1)
        .optional()
        .describe('Optional assistant session id to scope the recent turn receipts.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(5)
        .describe('Maximum number of recent sessions, turns, and pending outbox intents to return.'),
    }),
    output: assistantStatusResultSchema,
    async run(context: {
      options: {
        limit: number
        session?: string
        vault: string
      }
    }) {
      return getAssistantStatus({
        vault: context.options.vault,
        sessionId: context.options.session,
        limit: context.options.limit,
      })
    },
  }
}

function createAssistantDoctorCommandDefinition(input?: {
  description?: string
  hint?: string
}) {
  return {
    args: emptyArgsSchema,
    description:
      input?.description ??
      'Run lightweight assistant-state diagnostics for session files, receipts, transcripts, automation state, and the outbound outbox.',
    hint:
      input?.hint ??
      'Use --repair to migrate legacy inline secret headers into private sidecars and to tighten assistant-state permissions in place.',
    options: withBaseOptions({
      repair: z
        .boolean()
        .default(false)
        .describe(
          'Repair assistant-state secrecy issues in place by moving legacy inline secret headers into private sidecars and fixing private file permissions.',
        ),
    }),
    output: assistantDoctorResultSchema,
    async run(context: {
      options: {
        repair: boolean
        vault: string
      }
    }) {
      return runAssistantDoctor(context.options.vault, {
        repair: context.options.repair,
      })
    },
  }
}

function createAssistantStopCommandDefinition(input?: {
  description?: string
  hint?: string
}) {
  return {
    args: emptyArgsSchema,
    description:
      input?.description ??
      'Stop the assistant automation loop for this vault and clear stale run-lock state when the recorded process is already gone.',
    hint:
      input?.hint ??
      'Use this to recover from a stuck `assistant run` / `murph run`. Murph sends SIGTERM first, waits briefly, and only force-kills the recorded PID if it refuses to exit.',
    options: withBaseOptions(),
    output: assistantStopResultSchema,
    async run(context: {
      options: {
        vault: string
      }
    }) {
      return stopAssistantAutomation({
        vault: context.options.vault,
      })
    },
  }
}

function buildAssistantVaultResultPath(vault: string) {
  return {
    vault: redactAssistantDisplayPath(vault),
  }
}

function buildAssistantStateRootResultPaths(vault: string, stateRoot: string) {
  return {
    ...buildAssistantVaultResultPath(vault),
    stateRoot: redactAssistantDisplayPath(stateRoot),
  }
}

function buildAssistantStateResultPaths(vault: string) {
  const statePaths = resolveAssistantStatePaths(vault)
  return buildAssistantStateRootResultPaths(vault, statePaths.assistantStateRoot)
}

function buildAssistantStateDocumentResultPaths(vault: string) {
  const statePaths = resolveAssistantStatePaths(vault)
  return {
    ...buildAssistantStateRootResultPaths(vault, statePaths.assistantStateRoot),
    documentsRoot: redactAssistantDisplayPath(statePaths.stateDirectory),
  }
}

function buildAssistantMemoryResultPaths(vault: string) {
  const statePaths = resolveAssistantMemoryStoragePaths(vault)
  return buildAssistantStateRootResultPaths(vault, statePaths.assistantStateRoot)
}

function buildAssistantCronResultPaths(vault: string) {
  const statePaths = resolveAssistantStatePaths(vault)
  return {
    ...buildAssistantStateRootResultPaths(vault, statePaths.assistantStateRoot),
    jobsPath: redactAssistantDisplayPath(statePaths.cronJobsPath),
    runsRoot: redactAssistantDisplayPath(statePaths.cronRunsDirectory),
  }
}

function buildAssistantOperatorConfigResult() {
  return {
    configPath: redactAssistantDisplayPath(resolveOperatorConfigPath()),
  }
}

function assistantConversationOptionsFromCli<T extends AssistantConversationCliOptions>(
  options: T,
) {
  return {
    sessionId: options.session,
    alias: options.alias,
    channel: options.channel,
    identityId: options.identity,
    participantId: options.participant,
    sourceThreadId: options.sourceThread,
  }
}

function assistantProviderOverridesFromCli<T extends AssistantProviderCliOptions>(
  options: T,
) {
  const headers = parseHeadersJsonOption(options.headersJson)
  return {
    provider: options.provider,
    codexCommand: options.codexCommand,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    providerName: options.providerName,
    sandbox: options.sandbox,
    approvalPolicy: options.approvalPolicy,
    profile: options.profile,
    oss: options.oss,
    ...(headers ? { headers } : {}),
  }
}

function assistantDeliveryOverridesFromCli<T extends AssistantDeliveryCliOptions>(
  options: T,
) {
  return {
    deliverResponse: options.deliverResponse,
    deliveryTarget: options.deliveryTarget,
  }
}

async function resolveAssistantDeliveryRouteFromCli(input: {
  allowSingleSavedTargetFallback?: boolean
  channel?: string
  deliveryTarget?: string
  identity?: string
  participant?: string
  sourceThread?: string
}) {
  return applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: input.channel,
      identityId: input.identity,
      participantId: input.participant,
      sourceThreadId: input.sourceThread,
      deliveryTarget: input.deliveryTarget,
    },
    {
      allowSingleSavedTargetFallback: input.allowSingleSavedTargetFallback,
    },
  )
}

function assistantCronStateOptionsFromCli<T extends {
  state?: boolean
  stateDoc?: string
}>(options: T) {
  return {
    bindState: options.state,
    stateDocId: options.stateDoc,
  }
}

async function resolveAssistantCronTargetFromCli(input: {
  copyFrom?: string
  deliveryTarget?: string
  identity?: string
  participant?: string
  sourceThread?: string
  toSelf?: string
  channel?: string
  vault: string
}) {
  const hasExplicitRoute =
    Boolean(input.channel) ||
    Boolean(input.identity) ||
    Boolean(input.participant) ||
    Boolean(input.sourceThread) ||
    Boolean(input.deliveryTarget)
  const selectedSources = [
    input.toSelf ? 'to-self' : null,
    input.copyFrom ? 'copy-from' : null,
    hasExplicitRoute ? 'explicit-route' : null,
  ].filter((value): value is string => value !== null)

  if (selectedSources.length !== 1) {
    throw new VaultCliError(
      'invalid_option',
      'Provide exactly one cron target source: --toSelf <channel>, --copyFrom <job>, or an explicit route via --channel/--identity/--participant/--sourceThread/--deliveryTarget.',
    )
  }

  if (input.toSelf) {
    const savedTarget = await resolveAssistantSelfDeliveryTarget(input.toSelf)
    if (!savedTarget) {
      throw new VaultCliError(
        'ASSISTANT_SELF_TARGET_NOT_FOUND',
        `No saved self-delivery target exists for channel "${input.toSelf}". Save one first with \`assistant self-target set ${input.toSelf} ...\`.`,
      )
    }

    return {
      channel: savedTarget.channel,
      identityId: savedTarget.identityId ?? undefined,
      participantId: savedTarget.participantId ?? undefined,
      sourceThreadId: savedTarget.sourceThreadId ?? undefined,
      deliveryTarget: savedTarget.deliveryTarget ?? undefined,
    }
  }

  if (input.copyFrom) {
    const sourceJobTarget = await getAssistantCronJobTarget(input.vault, input.copyFrom)
    return {
      channel: sourceJobTarget.target.channel ?? undefined,
      identityId: sourceJobTarget.target.identityId ?? undefined,
      participantId: sourceJobTarget.target.participantId ?? undefined,
      sourceThreadId: sourceJobTarget.target.sourceThreadId ?? undefined,
      deliveryTarget: sourceJobTarget.target.deliveryTarget ?? undefined,
    }
  }

  const resolvedRoute = await resolveAssistantDeliveryRouteFromCli({
    allowSingleSavedTargetFallback: false,
    channel: input.channel,
    identity: input.identity,
    participant: input.participant,
    sourceThread: input.sourceThread,
    deliveryTarget: input.deliveryTarget,
  })

  return {
    channel: resolvedRoute.channel ?? undefined,
    identityId: resolvedRoute.identityId ?? undefined,
    participantId: resolvedRoute.participantId ?? undefined,
    sourceThreadId: resolvedRoute.sourceThreadId ?? undefined,
    deliveryTarget: resolvedRoute.deliveryTarget ?? undefined,
  }
}

async function runAssistantChatCommand(context: {
  args: AssistantChatArgs
  options: AssistantChatOptions
  agent: boolean
  formatExplicit: boolean
}) {
  const result = await runAssistantChat({
    vault: context.options.vault,
    includeFirstTurnCheckIn: true,
    initialPrompt: context.args.prompt,
    ...assistantConversationOptionsFromCli(context.options),
    ...assistantProviderOverridesFromCli(context.options),
  })

  if (!context.agent && !context.formatExplicit) {
    process.stderr.write(
      `Resume chat by typing: ${formatAssistantChatResumeCommand(result.session.sessionId)}\n`,
    )
  }

  return result
}

function formatAssistantChatResumeCommand(sessionId: string): string {
  return `murph chat --session "${sessionId}"`
}

function createAssistantChatCommandDefinition(input?: {
  description?: string
  hint?: string
}) {
  return {
    args: assistantChatArgsSchema,
    description:
      input?.description ??
      'Open an Ink terminal chat UI backed by the chosen provider while Murph stores session metadata plus a local transcript outside the canonical vault.',
    hint:
      input?.hint ??
      'Type /exit to close the chat loop or /session to print the current Murph session id.',
    options: assistantChatOptionsSchema,
    output: assistantChatResultSchema,
    outputPolicy: 'agent-only' as const,
    run: runAssistantChatCommand,
  }
}

const assistantRunOptionsSchema = withBaseOptions({
  model: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional model id for canonical inbox triage routing, such as gpt-oss:20b or an AI Gateway model string. Omit it when you only want channel auto-reply.',
    ),
  baseUrl: z
    .string()
    .min(1)
    .optional()
    .describe('Optional OpenAI-compatible base URL for the inbox routing model.'),
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe('Optional explicit API key for the OpenAI-compatible routing endpoint.'),
  apiKeyEnv: z
    .string()
    .min(1)
    .optional()
    .describe('Optional environment variable name that stores the routing API key.'),
  providerName: z
    .string()
    .min(1)
    .optional()
    .describe('Optional stable provider label for the routing endpoint.'),
  headersJson: z
    .string()
    .min(1)
    .optional()
    .describe('Optional JSON object of extra HTTP headers for the routing endpoint.'),
  scanIntervalMs: z
    .number()
    .int()
    .positive()
    .max(60000)
    .default(5000)
    .describe('Polling interval between inbox scans when running continuously.'),
  maxPerScan: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe('Maximum inbox captures to inspect during each assistant scan.'),
  allowSelfAuthored: z
    .boolean()
    .optional()
    .describe(
      'Allow self-authored captures to trigger channel auto-reply. Useful for texting your own Mac, but only safe when you dedicate a self-chat thread to Murph.',
    ),
  sessionRolloverHours: z
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .optional()
    .describe(
      'Optional maximum age for a reused assistant session in hours before Murph starts a new one for the same channel thread.',
    ),
  once: z
    .boolean()
    .optional()
    .describe('Run one assistant scan and then exit.'),
  skipDaemon: z
    .boolean()
    .optional()
    .describe('Do not start the inbox foreground daemon; only run the assistant scan loop.'),
})

function createAssistantRunCommandDefinition(
  inboxServices: InboxServices,
  vaultServices?: VaultServices,
  input?: {
    description?: string
    hint?: string
  },
) {
  return {
    args: emptyArgsSchema,
    description:
      input?.description ??
      'Start the local assistant automation loop that watches the inbox runtime, runs due assistant cron jobs, auto-replies over configured channels such as iMessage or Telegram, and optionally applies model-routed canonical promotions.',
    hint:
      input?.hint ??
      'Use --baseUrl with a local OpenAI-compatible model endpoint such as Ollama when you also want canonical inbox triage. Channel auto-reply can run without a routing model, and assistant cron schedules fire while this loop is active.',
    examples: [
      {
        options: {
          vault: './vault',
          model: 'gpt-oss:20b',
          baseUrl: 'http://127.0.0.1:11434/v1',
        },
        description: 'Run the always-on inbox assistant against a local Ollama model.',
      },
      {
        options: {
          vault: './vault',
          model: 'gpt-oss:20b',
          baseUrl: 'http://127.0.0.1:11434/v1',
          once: true,
          skipDaemon: true,
        },
        description: 'Run a single inbox scan without starting the foreground daemon.',
      },
      {
        options: {
          vault: './vault',
          allowSelfAuthored: true,
          sessionRolloverHours: 48,
        },
        description: 'Run dedicated iMessage self-chat mode with two-day session rollover.',
      },
    ],
    options: assistantRunOptionsSchema,
    output: assistantRunResultSchema,
    async run(context: { options: z.infer<typeof assistantRunOptionsSchema> }) {
      const terminalLogOptions = resolveForegroundTerminalLogOptions(process.env)

      return runAssistantAutomation({
        inboxServices,
        vaultServices,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        modelSpec: context.options.model
          ? {
              model: context.options.model,
              baseUrl: context.options.baseUrl,
              apiKey: context.options.apiKey,
              apiKeyEnv: context.options.apiKeyEnv,
              providerName: context.options.providerName,
              headers: parseHeadersJsonOption(context.options.headersJson),
            }
          : undefined,
        scanIntervalMs: context.options.scanIntervalMs,
        maxPerScan: context.options.maxPerScan,
        allowSelfAuthored: context.options.allowSelfAuthored,
        sessionMaxAgeMs:
          typeof context.options.sessionRolloverHours === 'number'
            ? context.options.sessionRolloverHours * 60 * 60 * 1000
            : null,
        once: context.options.once,
        startDaemon: context.options.skipDaemon ? false : true,
        onEvent(event) {
          const message = formatAssistantRunEventForTerminal(
            event,
            terminalLogOptions,
          )
          if (message) {
            console.error(formatForegroundLogLine('assistant', message))
          }
        },
        onInboxEvent(event) {
          const message = formatInboxRunEventForTerminal(
            event,
            terminalLogOptions,
          )
          if (message) {
            console.error(formatForegroundLogLine('assistant', message))
          }
        },
      })
    },
  }
}

export function registerAssistantCommands(
  cli: Cli.Cli,
  inboxServices: InboxServices,
  vaultServices?: VaultServices,
) {
  const assistant = Cli.create('assistant', {
    description:
      'Murph-native assistant runtime with provider-backed local chat sessions, Ink terminal chat, outbound delivery, and auto-routing inbox automation.',
  })

  const registerConversationCommands = () => {
    assistant.command('ask', {
      args: z.object({
        prompt: z.string().min(1).describe('Prompt to send to the local assistant session.'),
      }),
      description:
        'Send one message through the local provider-backed assistant and persist session metadata plus a local transcript outside the canonical vault.',
      hint:
        'Murph persists a local transcript plus per-session metadata under assistant-state/, and still reuses provider-side history when available. Use --deliverResponse to send the assistant reply back out over a mapped channel such as iMessage, Telegram, or email.',
      examples: [
        {
          args: {
            prompt: 'Summarize the latest documents in this vault.',
          },
          options: {
            vault: './vault',
          },
          description: 'Start a new local assistant session rooted at the vault directory.',
        },
        {
          args: {
            prompt: 'Send a quick check-in about lunch.',
          },
          options: {
            vault: './vault',
            channel: 'imessage',
            participant: '+15551234567',
            deliverResponse: true,
          },
          description: 'Generate a reply locally and deliver it over iMessage.',
        },
        {
          args: {
            prompt: 'Reply that I can review the latest labs tonight.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            participant: '123456789',
            sourceThread: '123456789',
            deliverResponse: true,
          },
          description: 'Generate a reply locally and deliver it back into a Telegram bot chat.',
        },
        {
          args: {
            prompt: "Send today's summary by email.",
          },
          options: {
            vault: './vault',
            channel: 'email',
            identity: 'inbox_123',
            participant: 'you@example.com',
            deliverResponse: true,
          },
          description: 'Generate a reply locally and deliver it over AgentMail email.',
        },
      ],
      options: withBaseOptions({
        ...assistantSessionOptionFields,
        ...assistantProviderOptionFields,
        ...assistantDeliveryOptionFields,
      }),
      output: assistantAskResultSchema,
      async run(context) {
        const deliveryOverrides = assistantDeliveryOverridesFromCli(context.options)
        const savedRoute =
          deliveryOverrides.deliverResponse && !context.options.session
            ? await resolveAssistantDeliveryRouteFromCli({
                allowSingleSavedTargetFallback: true,
                channel: context.options.channel,
                identity: context.options.identity,
                participant: context.options.participant,
                sourceThread: context.options.sourceThread,
                deliveryTarget: deliveryOverrides.deliveryTarget,
              })
            : null

        return sendAssistantMessage({
          vault: context.options.vault,
          prompt: context.args.prompt,
          ...assistantConversationOptionsFromCli({
            ...context.options,
            channel: savedRoute?.channel ?? context.options.channel,
            identity: savedRoute?.identityId ?? context.options.identity,
            participant: savedRoute?.participantId ?? context.options.participant,
            sourceThread: savedRoute?.sourceThreadId ?? context.options.sourceThread,
          }),
          ...assistantProviderOverridesFromCli(context.options),
          ...deliveryOverrides,
          deliveryTarget: savedRoute?.deliveryTarget ?? deliveryOverrides.deliveryTarget,
        })
      },
    })

    assistant.command('chat', createAssistantChatCommandDefinition())

    assistant.command('deliver', {
      args: z.object({
        message: z
          .string()
          .min(1)
          .describe('Outbound message body to deliver over the mapped assistant channel.'),
      }),
      description:
        'Deliver one outbound assistant message without invoking the chat provider. iMessage, Telegram, Linq, and email all use the same stored assistant channel binding surface.',
      hint:
        'Use --deliveryTarget to override the stored delivery target for one send only. For iMessage that target can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for Linq it can be a chat id; for email it can be a recipient address while thread-bound sessions reply in place.',
      examples: [
        {
          args: {
            message: 'Here is your nutrition recap for lunch.',
          },
          options: {
            vault: './vault',
            channel: 'imessage',
            participant: '+15551234567',
          },
          description: 'Send a direct iMessage to one participant.',
        },
        {
          args: {
            message: 'I saw the message and queued your follow-up.',
          },
          options: {
            vault: './vault',
            channel: 'linq',
            sourceThread: 'chat_123',
            deliveryTarget: 'chat_123',
          },
          description: 'Send a Linq reply back into the same direct chat.',
        },
        {
          args: {
            message: 'I imported that lab report and queued the parser.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            sourceThread: '-1001234567890:topic:42',
            deliveryTarget: '-1001234567890:topic:42',
          },
          description: 'Send a Telegram reply into a specific chat topic.',
        },
        {
          args: {
            message: 'Your weekly summary is ready.',
          },
          options: {
            vault: './vault',
            channel: 'email',
            identity: 'inbox_123',
            deliveryTarget: 'you@example.com',
          },
          description: 'Send a one-off outbound summary email through an AgentMail inbox.',
        },
        {
          args: {
            message: 'I imported that lab report and queued the parser.',
          },
          options: {
            vault: './vault',
            session: 'asst_123',
            deliveryTarget: 'chat45e2b868',
          },
          description: 'Reuse an existing session and override the outbound target for one message.',
        },
      ],
      options: withBaseOptions({
        ...assistantSessionOptionFields,
        deliveryTarget: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for Linq it can be a chat id; for email it can be a recipient address while thread-bound sessions reply in place.',
          ),
      }),
      output: assistantDeliverResultSchema,
      async run(context) {
        const deliveryOverrides = assistantDeliveryOverridesFromCli(context.options)
        const savedRoute = context.options.session
          ? null
          : await resolveAssistantDeliveryRouteFromCli({
              allowSingleSavedTargetFallback: true,
              channel: context.options.channel,
              identity: context.options.identity,
              participant: context.options.participant,
              sourceThread: context.options.sourceThread,
              deliveryTarget: deliveryOverrides.deliveryTarget,
            })
        return deliverAssistantMessage({
          vault: context.options.vault,
          message: context.args.message,
          ...assistantConversationOptionsFromCli({
            ...context.options,
            channel: savedRoute?.channel ?? context.options.channel,
            identity: savedRoute?.identityId ?? context.options.identity,
            participant: savedRoute?.participantId ?? context.options.participant,
            sourceThread: savedRoute?.sourceThreadId ?? context.options.sourceThread,
          }),
          target: savedRoute?.deliveryTarget ?? deliveryOverrides.deliveryTarget,
        })
      },
    })

    assistant.command(
      'run',
      createAssistantRunCommandDefinition(inboxServices, vaultServices),
    )
  }

  const registerStateCommands = () => {
    const state = Cli.create('state', {
      description:
        'Inspect and update small non-canonical assistant state documents stored outside the vault under assistant-state/state.',
    })

    state.command('list', {
      args: emptyArgsSchema,
      description: 'List assistant state documents, optionally filtered by a prefix namespace.',
      hint:
        'Use prefixes such as `cron` or `cron/<jobId>` to narrow the scratchpad documents that belong to one workflow.',
      options: withBaseOptions({
        prefix: z
          .string()
          .min(1)
          .optional()
          .describe('Optional slash-delimited document prefix such as cron or cron/job_123.'),
      }),
      output: assistantStateListResultSchema,
      async run(context) {
        const documents = await listAssistantStateDocuments({
          vault: context.options.vault,
          prefix: context.options.prefix,
        })

        return {
          ...buildAssistantStateDocumentResultPaths(context.options.vault),
          prefix: context.options.prefix ?? null,
          documents: documents.map(redactAssistantStateDocumentListEntry),
        }
      },
    })

    state.command('show', {
      args: z.object({
        doc: z.string().min(1).describe('Assistant state document id such as cron/job_123.'),
      }),
      description: 'Show one assistant state document by id.',
      options: withBaseOptions(),
      output: assistantStateShowResultSchema,
      async run(context) {
        const document = await getAssistantStateDocument({
          vault: context.options.vault,
          docId: context.args.doc,
        })

        return {
          ...buildAssistantStateDocumentResultPaths(context.options.vault),
          document: redactAssistantStateDocumentSnapshot(document),
        }
      },
    })

    state.command('put', {
      args: z.object({
        doc: z.string().min(1).describe('Assistant state document id such as cron/job_123.'),
      }),
      description: 'Replace one assistant state document with a JSON object payload.',
      hint:
        'Use this for full replacement. For incremental updates that preserve existing keys, use `assistant state patch`.',
      options: withBaseOptions({
        input: inputFileOptionSchema.describe(
          'JSON object payload in @file.json form or - for stdin.',
        ),
      }),
      output: assistantStatePutResultSchema,
      async run(context) {
        const value = await loadJsonInputObject(context.options.input, 'assistant state document')
        const document = await putAssistantStateDocument({
          vault: context.options.vault,
          docId: context.args.doc,
          value,
        })

        return {
          ...buildAssistantStateDocumentResultPaths(context.options.vault),
          document: redactAssistantStateDocumentSnapshot(document),
        }
      },
    })

    state.command('patch', {
      args: z.object({
        doc: z.string().min(1).describe('Assistant state document id such as cron/job_123.'),
      }),
      description: 'Merge-patch one assistant state document with a JSON object payload.',
      hint:
        'This uses JSON Merge Patch semantics: object keys merge recursively, `null` deletes a key, and arrays replace the previous value.',
      options: withBaseOptions({
        input: inputFileOptionSchema.describe(
          'JSON object merge-patch payload in @file.json form or - for stdin.',
        ),
      }),
      output: assistantStatePatchResultSchema,
      async run(context) {
        const patch = await loadJsonInputObject(context.options.input, 'assistant state patch')
        const document = await patchAssistantStateDocument({
          vault: context.options.vault,
          docId: context.args.doc,
          patch,
        })

        return {
          ...buildAssistantStateDocumentResultPaths(context.options.vault),
          document: redactAssistantStateDocumentSnapshot(document),
        }
      },
    })

    state.command('delete', {
      args: z.object({
        doc: z.string().min(1).describe('Assistant state document id such as cron/job_123.'),
      }),
      description: 'Delete one assistant state document by id.',
      options: withBaseOptions(),
      output: assistantStateDeleteResultSchema,
      async run(context) {
        const result = await deleteAssistantStateDocument({
          vault: context.options.vault,
          docId: context.args.doc,
        })

        return {
          ...buildAssistantStateDocumentResultPaths(context.options.vault),
          docId: result.docId,
          documentPath: redactAssistantDisplayPath(result.documentPath),
          existed: result.existed,
        }
      },
    })

    assistant.command(state)
  }

  const registerMemoryCommands = () => {
    const memory = Cli.create('memory', {
      description:
        'Inspect and update non-canonical assistant memory stored outside the vault under assistant-state/.',
    })

    memory.command('search', {
      args: emptyArgsSchema,
      description:
        'Search assistant memory across durable long-term notes and short-lived daily notes.',
      hint:
        'Use --scope long-term for durable identity/preferences/instructions and --scope daily for recent project context.',
      examples: [
        {
          options: {
            vault: './vault',
            scope: 'long-term',
            text: 'concise answers',
          },
          description: 'Search durable assistant response preferences.',
        },
        {
          options: {
            vault: './vault',
            scope: 'daily',
            limit: 5,
          },
          description: 'List the latest recent-context notes.',
        },
      ],
      options: withBaseOptions({
        text: z
          .string()
          .min(1)
          .optional()
          .describe('Optional lexical query for assistant memory search.'),
        scope: z
          .enum(assistantMemoryQueryScopeValues)
          .default('all')
          .describe('Choose long-term memory, daily notes, or both.'),
        section: z
          .enum(assistantMemoryVisibleSectionValues)
          .optional()
          .describe('Optional section filter such as Identity or Notes.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .default(8)
          .describe('Maximum number of assistant memory hits to return.'),
      }),
      output: assistantMemorySearchResultSchema,
      async run(context) {
        const turnContext = resolveAssistantMemoryTurnContext()
        if (turnContext) {
          assertAssistantMemoryTurnContextVault(turnContext, context.options.vault)
        }

        const result = await searchAssistantMemory({
          vault: context.options.vault,
          text: context.options.text,
          scope: context.options.scope,
          section: context.options.section,
          limit: context.options.limit,
          includeSensitiveHealthContext:
            turnContext?.allowSensitiveHealthContext ?? true,
        })

        return {
          ...buildAssistantMemoryResultPaths(context.options.vault),
          query: result.query,
          scope: result.scope,
          section: result.section,
          results: result.results.map(redactAssistantMemorySearchHit),
        }
      },
    })

    memory.command('get', {
      args: z.object({
        memoryId: z.string().min(1).describe('Assistant memory id returned by search.'),
      }),
      description: 'Fetch one assistant memory record by id.',
      options: withBaseOptions(),
      output: assistantMemoryGetResultSchema,
      async run(context) {
        const turnContext = resolveAssistantMemoryTurnContext()
        if (turnContext) {
          assertAssistantMemoryTurnContextVault(turnContext, context.options.vault)
        }

        const memoryRecord = await getAssistantMemory({
          vault: context.options.vault,
          id: context.args.memoryId,
          includeSensitiveHealthContext:
            turnContext?.allowSensitiveHealthContext ?? true,
        })

        return {
          ...buildAssistantMemoryResultPaths(context.options.vault),
          memory: redactAssistantMemoryRecord(memoryRecord),
        }
      },
    })

    memory.command('upsert', {
      args: z.object({
        text: z
          .string()
          .min(1)
          .describe('Assistant memory text to persist. Outside live turns, use the exact sentence you want stored.'),
      }),
      description:
        'Create or update assistant memory through the typed memory commit layer.',
      hint:
        'Use --scope both to mirror durable long-term memory into today\'s daily note. Outside live assistant turns, phrase durable memory as the final stored sentence, such as "Call the user Alex.", "User prefers the default assistant tone.", or "Keep responses brief.". In live assistant turns, the host binds writes to the real user message and ignores any client-supplied --sourcePrompt.',
      examples: [
        {
          args: {
            text: 'Call the user Alex.',
          },
          options: {
            vault: './vault',
            scope: 'long-term',
            section: 'Identity',
          },
          description: 'Persist a durable naming preference when you already know the canonical stored wording.',
        },
        {
          args: {
            text: 'Call me Alex.',
          },
          options: {
            vault: './vault',
            scope: 'both',
            section: 'Identity',
            sourcePrompt: 'Call me Alex from now on.',
          },
          description: 'Persist a durable naming preference from natural user wording and mirror it into the daily note.',
        },
        {
          args: {
            text: 'We are working on assistant memory tools.',
          },
          options: {
            vault: './vault',
            scope: 'daily',
          },
          description: 'Store short-lived project context only in the daily memory log.',
        },
      ],
      options: withBaseOptions({
        scope: z
          .enum(assistantMemoryWriteScopeValues)
          .default('long-term')
          .describe('Persist long-term memory, a daily note, or both.'),
        section: z
          .enum(assistantMemoryLongTermSectionValues)
          .optional()
          .describe('Required for long-term memory writes; ignored for daily-only notes.'),
        sourcePrompt: z
          .string()
          .min(1)
          .optional()
          .describe('Optional source user wording used for assistant-memory validation.'),
      }),
      output: assistantMemoryUpsertResultSchema,
      async run(context) {
        const turnContext = resolveAssistantMemoryTurnContext()
        if (turnContext) {
          assertAssistantMemoryTurnContextVault(turnContext, context.options.vault)
        }

        const result = await upsertAssistantMemory({
          vault: context.options.vault,
          text: context.args.text,
          scope: context.options.scope,
          section: context.options.section,
          sourcePrompt: context.options.sourcePrompt,
          turnContext,
        })

        return {
          ...buildAssistantMemoryResultPaths(context.options.vault),
          scope: result.scope,
          longTermAdded: result.longTermAdded,
          dailyAdded: result.dailyAdded,
          memories: result.memories.map(redactAssistantMemoryRecord),
        }
      },
    })

    memory.command('forget', {
      args: z.object({
        memoryId: z.string().min(1).describe('Assistant memory id returned by search.'),
      }),
      description: 'Remove one assistant memory record by id.',
      hint:
        'Use this when a memory item is mistaken or obsolete; prefer forgetting it over appending a contradiction.',
      options: withBaseOptions(),
      output: assistantMemoryForgetResultSchema,
      async run(context) {
        const turnContext = resolveAssistantMemoryTurnContext()
        if (turnContext) {
          assertAssistantMemoryTurnContextVault(turnContext, context.options.vault)
        }

        const result = await forgetAssistantMemory({
          vault: context.options.vault,
          id: context.args.memoryId,
        })

        return {
          ...buildAssistantMemoryResultPaths(context.options.vault),
          removed: redactAssistantMemoryRecord(result.removed),
        }
      },
    })

    assistant.command(memory)
  }

  const registerSelfTargetCommands = () => {
    const selfTarget = Cli.create('self-target', {
      description:
        'Manage local saved self-delivery targets for outbound assistant actions without storing them in the canonical vault.',
    })

    selfTarget.command('list', {
      args: emptyArgsSchema,
      description: 'List saved self-delivery targets from local operator config.',
      options: z.object({
        requestId: requestIdSchema,
      }),
      output: assistantSelfDeliveryTargetListResultSchema,
      async run() {
        return {
          ...buildAssistantOperatorConfigResult(),
          targets: await listAssistantSelfDeliveryTargets(),
        }
      },
    })

    selfTarget.command('show', {
      args: z.object({
        channel: z.string().min(1).describe('Saved outbound channel to inspect.'),
      }),
      description: 'Show one saved self-delivery target for a specific outbound channel.',
      options: z.object({
        requestId: requestIdSchema,
      }),
      output: assistantSelfDeliveryTargetShowResultSchema,
      async run(context) {
        const targets = await listAssistantSelfDeliveryTargets()
        return {
          ...buildAssistantOperatorConfigResult(),
          target:
            targets.find((target) => target.channel === context.args.channel.trim().toLowerCase()) ??
            null,
        }
      },
    })

    selfTarget.command('set', {
      args: z.object({
        channel: z
          .string()
          .min(1)
          .describe('Outbound channel to save, such as telegram, imessage, linq, or email.'),
      }),
      description: 'Save or replace the local default outbound target for one channel.',
      hint:
        'Use this after the user gives you a phone number, Telegram chat, or email target so later actions can reuse it without asking again.',
      options: z.object({
        requestId: requestIdSchema,
        ...assistantSelfDeliveryTargetOptionFields,
      }),
      output: assistantSelfDeliveryTargetSetResultSchema,
      async run(context) {
        const channel = context.args.channel.trim().toLowerCase()
        assertAssistantSelfDeliveryTargetInput({
          channel,
          identity: context.options.identity,
          participant: context.options.participant,
          sourceThread: context.options.sourceThread,
          deliveryTarget: context.options.deliveryTarget,
        })

        const target = await saveAssistantSelfDeliveryTarget({
          channel,
          identityId: context.options.identity ?? null,
          participantId: context.options.participant ?? null,
          sourceThreadId: context.options.sourceThread ?? null,
          deliveryTarget: context.options.deliveryTarget ?? null,
        })

        return {
          ...buildAssistantOperatorConfigResult(),
          target,
        }
      },
    })

    selfTarget.command('clear', {
      args: z.object({
        channel: z
          .string()
          .min(1)
          .optional()
          .describe('Optional saved outbound channel to clear. Omit to clear all saved self-targets.'),
      }),
      description: 'Clear one saved self-delivery target or remove all of them.',
      options: z.object({
        requestId: requestIdSchema,
      }),
      output: assistantSelfDeliveryTargetClearResultSchema,
      async run(context) {
        return {
          ...buildAssistantOperatorConfigResult(),
          clearedChannels: await clearAssistantSelfDeliveryTargets(context.args.channel),
        }
      },
    })

    assistant.command(selfTarget)
  }

  const registerCronCommands = () => {
    const cron = Cli.create('cron', {
      description:
        'Manage scheduled assistant prompts stored outside the canonical vault under assistant-state/cron.',
    })

    const preset = Cli.create('preset', {
      description:
        'Browse and materialize built-in assistant cron templates without editing scheduler state files directly.',
    })

    preset.command('list', {
      args: emptyArgsSchema,
      description: 'List the built-in assistant cron presets that can be installed later.',
      hint:
        'Presets are templates, not active jobs. Use `assistant cron preset install` to turn one into a real cron job.',
      options: withBaseOptions(),
      output: assistantCronPresetListResultSchema,
      async run(context) {
        return {
          ...buildAssistantVaultResultPath(context.options.vault),
          presets: listAssistantCronPresets(),
        }
      },
    })

    preset.command('show', {
      args: z.object({
        preset: z.string().min(1).describe('Assistant cron preset id to inspect.'),
      }),
      description: 'Show one built-in assistant cron preset, including its prompt template.',
      options: withBaseOptions(),
      output: assistantCronPresetShowResultSchema,
      async run(context) {
        const presetDefinition = getAssistantCronPreset(context.args.preset)
        return {
          ...buildAssistantVaultResultPath(context.options.vault),
          preset: {
            id: presetDefinition.id,
            category: presetDefinition.category,
            title: presetDefinition.title,
            description: presetDefinition.description,
            suggestedName: presetDefinition.suggestedName,
            suggestedSchedule: presetDefinition.suggestedSchedule,
            suggestedScheduleLabel: presetDefinition.suggestedScheduleLabel,
            variables: presetDefinition.variables,
          },
          promptTemplate: presetDefinition.promptTemplate,
        }
      },
    })

    preset.command('install', {
      args: z.object({
        preset: z.string().min(1).describe('Assistant cron preset id to install.'),
      }),
      description: 'Create one assistant cron job from a built-in preset template.',
      hint:
        'Repeat --var key=value to fill preset slots. If you omit --at, --every, and --cron, Murph uses the preset’s suggested schedule. Cron jobs require an explicit outbound channel route and always deliver their response. Add --state only when the job needs run-to-run scratch state such as cooldowns, dedupe, unresolved follow-ups, or delivery policy; leave it off for stateless digest/report jobs.',
      examples: [
        {
          args: {
            preset: 'condition-research-roundup',
          },
          options: {
            vault: './vault',
            name: 'cholesterol-research-roundup',
            var: ['condition_or_goal=lowering cholesterol'],
          },
          description: 'Install the condition research preset with a cholesterol-focused variable override.',
        },
        {
          args: {
            preset: 'environment-health-watch',
          },
          options: {
            vault: './vault',
            var: ['location_context=Brisbane, Queensland, Australia'],
            channel: 'telegram',
            participant: '123456789',
            sourceThread: '123456789',
          },
          description: 'Install the environment-health preset and deliver the weekly report back into a Telegram chat.',
        },
      ],
      options: withBaseOptions({
        name: z
          .string()
          .min(1)
          .optional()
          .describe('Optional cron job name override. Defaults to the preset’s suggested name.'),
        var: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional preset variable assignment in key=value form. Repeat --var for multiple values.',
          ),
        instructions: z
          .string()
          .min(1)
          .optional()
          .describe('Optional extra instructions appended to the preset prompt before the job is created.'),
        at: z
          .string()
          .min(1)
          .optional()
          .describe('Optional one-shot ISO 8601 timestamp with an explicit offset.'),
        every: z
          .string()
          .min(1)
          .optional()
          .describe('Optional recurring interval such as 30m, 2h, or 1d.'),
        cron: z
          .string()
          .min(1)
          .optional()
          .describe('Optional five-field cron expression override.'),
        disabled: z
          .boolean()
          .optional()
          .describe('Create the preset-backed cron job in a disabled state without scheduling it yet.'),
        ...assistantSessionOptionFields,
        ...assistantCronDeliveryOptionFields,
        ...assistantCronStateOptionFields,
      }),
      output: assistantCronPresetInstallResultSchema,
      async run(context) {
        const schedule =
          context.options.at || context.options.every || context.options.cron
            ? buildAssistantCronSchedule({
                at: context.options.at,
                every: context.options.every,
                cron: context.options.cron,
              })
            : undefined
        const savedRoute = await resolveAssistantDeliveryRouteFromCli({
          allowSingleSavedTargetFallback: true,
          channel: context.options.channel,
          identity: context.options.identity,
          participant: context.options.participant,
          sourceThread: context.options.sourceThread,
          deliveryTarget: context.options.deliveryTarget,
        })
        const result = await installAssistantCronPreset({
          vault: context.options.vault,
          presetId: context.args.preset,
          name: context.options.name,
          variables: parseAssistantCronPresetVariables(context.options.var),
          additionalInstructions: context.options.instructions,
          schedule,
          enabled: context.options.disabled ? false : true,
          ...assistantCronStateOptionsFromCli(context.options),
          ...assistantConversationOptionsFromCli({
            ...context.options,
            channel: savedRoute.channel ?? context.options.channel,
            identity: savedRoute.identityId ?? context.options.identity,
            participant: savedRoute.participantId ?? context.options.participant,
            sourceThread: savedRoute.sourceThreadId ?? context.options.sourceThread,
          }),
          deliveryTarget: savedRoute.deliveryTarget ?? context.options.deliveryTarget,
        })

        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          preset: result.preset,
          job: result.job,
          resolvedPrompt: result.resolvedPrompt,
          resolvedVariables: result.resolvedVariables,
        }
      },
    })

    cron.command(preset)

    cron.command('status', {
      args: emptyArgsSchema,
      description: 'Show scheduler counts and the next upcoming assistant cron run.',
      hint: 'Assistant cron jobs execute while `assistant run` is active for the vault.',
      options: withBaseOptions(),
      output: assistantCronStatusResultSchema,
      async run(context) {
        const status = await getAssistantCronStatus(context.options.vault)
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          ...status,
        }
      },
    })

    cron.command('list', {
      args: emptyArgsSchema,
      description: 'List assistant cron jobs for one vault.',
      options: withBaseOptions(),
      output: assistantCronListResultSchema,
      async run(context) {
        const jobs = await listAssistantCronJobs(context.options.vault)
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          jobs,
        }
      },
    })

    cron.command('show', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to inspect.'),
      }),
      description: 'Show one assistant cron job record.',
      options: withBaseOptions(),
      output: assistantCronShowResultSchema,
      async run(context) {
        const job = await getAssistantCronJob(context.options.vault, context.args.job)
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job,
        }
      },
    })

    const target = Cli.create('target', {
      description:
        'Inspect or replace the outbound delivery target for an existing assistant cron job.',
    })

    target.command('show', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to inspect.'),
      }),
      description: 'Show the current outbound delivery target for one assistant cron job.',
      hint:
        'Use this before retargeting a cron job so you can see the current channel, explicit destination, and inferred binding delivery.',
      options: withBaseOptions(),
      output: assistantCronTargetShowResultSchema,
      async run(context) {
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          cronTarget: await getAssistantCronJobTarget(
            context.options.vault,
            context.args.job,
          ),
        }
      },
    })

    target.command('set', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to retarget.'),
      }),
      description:
        'Replace the outbound delivery target for one assistant cron job in place.',
      hint:
        'Provide exactly one target source: `--toSelf <channel>`, `--copyFrom <job>`, or an explicit route via `--channel` plus the usual delivery flags. When the audience changes, Murph clears stored cron session continuity so the next run does not reuse the old routed conversation.',
      examples: [
        {
          args: {
            job: 'weekly-health-snapshot',
          },
          options: {
            vault: './vault',
            toSelf: 'email',
          },
          description: 'Retarget an existing cron job to the saved email self-target.',
        },
        {
          args: {
            job: 'condition-research-roundup',
          },
          options: {
            vault: './vault',
            copyFrom: 'weekly-health-snapshot',
          },
          description: 'Copy the current delivery target from another cron job.',
        },
      ],
      options: withBaseOptions({
        ...assistantCronTargetSourceOptionFields,
        ...assistantCronDeliveryOptionFields,
        channel: assistantSessionOptionFields.channel,
        identity: assistantSessionOptionFields.identity,
        participant: assistantSessionOptionFields.participant,
        sourceThread: assistantSessionOptionFields.sourceThread,
      }),
      output: assistantCronTargetSetResultSchema,
      async run(context) {
        const resolvedTarget = await resolveAssistantCronTargetFromCli({
          vault: context.options.vault,
          channel: context.options.channel,
          copyFrom: context.options.copyFrom,
          deliveryTarget: context.options.deliveryTarget,
          identity: context.options.identity,
          participant: context.options.participant,
          sourceThread: context.options.sourceThread,
          toSelf: context.options.toSelf,
        })
        const result = await setAssistantCronJobTarget({
          vault: context.options.vault,
          job: context.args.job,
          dryRun: context.options.dryRun,
          resetContinuity: context.options.resetContinuity,
          ...resolvedTarget,
        })

        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job: result.job,
          beforeTarget: result.beforeTarget,
          afterTarget: result.afterTarget,
          changed: result.changed,
          continuityReset: result.continuityReset,
          dryRun: result.dryRun,
        }
      },
    })

    cron.command(target)

    cron.command('add', {
      args: z.object({
        prompt: z.string().min(1).describe('Prompt to send when the assistant cron job fires.'),
      }),
      description: 'Create one assistant cron job backed by the local assistant runtime.',
      hint:
        'Provide exactly one of --at, --every, or --cron. One-shot jobs are deleted after they succeed unless you pass --keepAfterRun. Cron jobs require an explicit outbound channel route and always deliver their response. Add --state or --stateDoc only when the job needs run-to-run scratch state such as cooldowns, dedupe, unresolved follow-ups, or delivery policy; leave it off for stateless jobs that can recompute everything each run.',
      examples: [
        {
          args: {
            prompt: 'Check whether I have been sitting too long and remind me to stretch.',
          },
          options: {
            vault: './vault',
            name: 'stretch-reminder',
            every: '2h',
          },
          description: 'Create a recurring interval job.',
        },
        {
          args: {
            prompt: 'Remind me to review my lab results after dinner.',
          },
          options: {
            vault: './vault',
            name: 'lab-review-tonight',
            at: '2026-03-22T18:30:00+10:00',
          },
          description: 'Create a one-shot reminder at a specific timestamp.',
        },
        {
          args: {
            prompt: 'Every weekday morning, ask me for a quick symptom check-in.',
          },
          options: {
            vault: './vault',
            name: 'weekday-symptom-check',
            cron: '0 8 * * 1-5',
            channel: 'telegram',
            participant: '-1001234567890',
          },
          description: 'Create a cron expression job that also delivers the reply back out.',
        },
      ],
      options: withBaseOptions({
        name: z
          .string()
          .min(1)
          .describe('Unique assistant cron job name.'),
        at: z
          .string()
          .min(1)
          .optional()
          .describe('One-shot ISO 8601 timestamp with an explicit offset.'),
        every: z
          .string()
          .min(1)
          .optional()
          .describe('Recurring interval such as 30m, 2h, or 1d.'),
        cron: z
          .string()
          .min(1)
          .optional()
          .describe('Five-field cron expression: minute hour day-of-month month day-of-week.'),
        keepAfterRun: z
          .boolean()
          .optional()
          .describe('Keep a completed one-shot job in the scheduler instead of deleting it.'),
        disabled: z
          .boolean()
          .optional()
          .describe('Create the job in a disabled state without scheduling it yet.'),
        ...assistantSessionOptionFields,
        ...assistantCronDeliveryOptionFields,
        ...assistantCronStateOptionFields,
      }),
      output: assistantCronAddResultSchema,
      async run(context) {
        const savedRoute = await resolveAssistantDeliveryRouteFromCli({
          allowSingleSavedTargetFallback: true,
          channel: context.options.channel,
          identity: context.options.identity,
          participant: context.options.participant,
          sourceThread: context.options.sourceThread,
          deliveryTarget: context.options.deliveryTarget,
        })
        const job = await addAssistantCronJob({
          vault: context.options.vault,
          name: context.options.name,
          prompt: context.args.prompt,
          schedule: buildAssistantCronSchedule({
            at: context.options.at,
            every: context.options.every,
            cron: context.options.cron,
          }),
          enabled: context.options.disabled ? false : true,
          keepAfterRun: context.options.keepAfterRun,
          ...assistantCronStateOptionsFromCli(context.options),
          ...assistantConversationOptionsFromCli({
            ...context.options,
            channel: savedRoute.channel ?? context.options.channel,
            identity: savedRoute.identityId ?? context.options.identity,
            participant: savedRoute.participantId ?? context.options.participant,
            sourceThread: savedRoute.sourceThreadId ?? context.options.sourceThread,
          }),
          deliveryTarget: savedRoute.deliveryTarget ?? context.options.deliveryTarget,
        })

        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job,
        }
      },
    })

    cron.command('remove', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to remove.'),
      }),
      description: 'Remove one assistant cron job from the scheduler.',
      options: withBaseOptions(),
      output: assistantCronRemoveResultSchema,
      async run(context) {
        const removed = await removeAssistantCronJob(
          context.options.vault,
          context.args.job,
        )
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          removed,
        }
      },
    })

    cron.command('enable', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to enable.'),
      }),
      description: 'Enable one assistant cron job.',
      options: withBaseOptions(),
      output: assistantCronShowResultSchema,
      async run(context) {
        const job = await setAssistantCronJobEnabled(
          context.options.vault,
          context.args.job,
          true,
        )
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job,
        }
      },
    })

    cron.command('disable', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to disable.'),
      }),
      description: 'Disable one assistant cron job without deleting it.',
      options: withBaseOptions(),
      output: assistantCronShowResultSchema,
      async run(context) {
        const job = await setAssistantCronJobEnabled(
          context.options.vault,
          context.args.job,
          false,
        )
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job,
        }
      },
    })

    cron.command('run', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to run immediately.'),
      }),
      description: 'Run one assistant cron job immediately, regardless of its next scheduled time.',
      options: withBaseOptions(),
      output: assistantCronRunResultSchema,
      async run(context) {
        const result = await runAssistantCronJobNow({
          vault: context.options.vault,
          job: context.args.job,
        })
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          job: result.job,
          removedAfterRun: result.removedAfterRun,
          run: result.run,
        }
      },
    })

    cron.command('runs', {
      args: z.object({
        job: z.string().min(1).describe('Assistant cron job id or name to inspect run history for.'),
      }),
      description: 'List recent run history for one assistant cron job.',
      options: withBaseOptions({
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe('Maximum number of recent runs to return.'),
      }),
      output: assistantCronRunsResultSchema,
      async run(context) {
        const result = await listAssistantCronRuns({
          vault: context.options.vault,
          job: context.args.job,
          limit: context.options.limit,
        })
        return {
          ...buildAssistantCronResultPaths(context.options.vault),
          jobId: result.jobId,
          runs: result.runs,
        }
      },
    })

    assistant.command(cron)
  }

  const registerObservabilityCommands = () => {
    assistant.command('status', createAssistantStatusCommandDefinition())
    assistant.command('doctor', createAssistantDoctorCommandDefinition())
    assistant.command('stop', createAssistantStopCommandDefinition())
  }

  const registerSessionCommands = () => {
    const session = Cli.create('session', {
      description:
        'Inspect Murph assistant session metadata stored outside the canonical vault.',
    })

    session.command('list', {
      args: emptyArgsSchema,
      description: 'List known assistant sessions for one vault.',
      options: withBaseOptions(),
      output: assistantSessionListResultSchema,
      async run(context) {
        const sessions = await listAssistantSessions(context.options.vault)
        return assistantSessionListResultSchema.parse({
          ...buildAssistantStateResultPaths(context.options.vault),
          sessions: redactAssistantSessionsForDisplay(sessions),
        })
      },
    })

    session.command('show', {
      args: z.object({
        sessionId: z.string().min(1).describe('Murph assistant session id to inspect.'),
      }),
      description: 'Show one assistant session metadata record.',
      options: withBaseOptions(),
      output: assistantSessionShowResultSchema,
      async run(context) {
        const session = await getAssistantSession(
          context.options.vault,
          context.args.sessionId,
        )
        return assistantSessionShowResultSchema.parse({
          ...buildAssistantStateResultPaths(context.options.vault),
          session: redactAssistantSessionForDisplay(session),
        })
      },
    })

    assistant.command(session)
  }

  const registerRootAliases = () => {
    cli.command(
      'chat',
      createAssistantChatCommandDefinition({
        description:
          'Open the same assistant chat UI as `assistant chat` directly from the CLI root.',
        hint:
          'Shorthand for `assistant chat`. Type /exit to close the chat loop or /session to print the current Murph session id.',
      }),
    )
    cli.command(
      'run',
      createAssistantRunCommandDefinition(inboxServices, vaultServices, {
        description:
          'Start the same assistant automation loop as `assistant run` directly from the CLI root.',
        hint:
          'Shorthand for `assistant run`. This starts the always-on automation loop, so it may watch inbox state, auto-reply over configured channels, and keep the terminal attached until you stop it.',
      }),
    )
    cli.command(
      'status',
      createAssistantStatusCommandDefinition({
        description:
          'Show the same assistant-state snapshot as `assistant status` directly from the CLI root.',
        hint:
          'Shorthand for `assistant status`. Use this to inspect recent turn receipts, session freshness, and pending outbox work.',
      }),
    )
    cli.command(
      'doctor',
      createAssistantDoctorCommandDefinition({
        description:
          'Run the same assistant-state diagnostics as `assistant doctor` directly from the CLI root.',
        hint:
          'Shorthand for `assistant doctor`. Use this when debugging transcript corruption, missing receipts, or stale outbox intents.',
      }),
    )
    cli.command(
      'stop',
      createAssistantStopCommandDefinition({
        description:
          'Stop the same assistant automation loop as `assistant stop` directly from the CLI root.',
        hint:
          'Shorthand for `assistant stop`. Use this when `murph run` is already active for the same vault and you need a recovery command instead of manual lock cleanup.',
      }),
    )
  }

  registerConversationCommands()
  registerStateCommands()
  registerMemoryCommands()
  registerSelfTargetCommands()
  registerCronCommands()
  registerObservabilityCommands()
  registerSessionCommands()

  cli.command(assistant)
  registerRootAliases()
}
