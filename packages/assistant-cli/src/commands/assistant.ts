import path from 'node:path'
import { access } from 'node:fs/promises'
import { Cli, z } from 'incur'
import {
  assistantAskResultSchema,
  assistantChannelNameSchema,
  assistantChatResultSchema,
  assistantDeliverResultSchema,
  assistantDoctorResultSchema,
  assistantOnboardingCompletionReasonValues,
  assistantOnboardingResultSchema,
  assistantOnboardingResumeContextResultSchema,
  assistantRunResultSchema,
  assistantSelfDeliveryTargetClearResultSchema,
  assistantSelfDeliveryTargetListResultSchema,
  assistantSelfDeliveryTargetSetResultSchema,
  assistantSelfDeliveryTargetShowResultSchema,
  assistantSandboxValues,
  assistantReasoningEffortValues,
  assistantSessionListResultSchema,
  assistantSessionShowResultSchema,
  assistantStopResultSchema,
  assistantStatusResultSchema,
  type AssistantOnboardingResumeContextResult,
  type AssistantSession,
  type AssistantSessionSummary,
} from '@murphai/operator-config/assistant-cli-contracts'
import { deliverAssistantMessage } from '@murphai/assistant-engine/outbound-channel'
import type { ConversationRef } from '@murphai/assistant-engine/assistant-runtime'
import {
  runAssistantAutomation,
  runAssistantChat,
  sendAssistantMessage,
  stopAssistantAutomation,
} from '../assistant-runtime.js'
import { runAssistantDoctor } from '../assistant/doctor.js'
import { getAssistantStatus } from '../assistant/status.js'
import {
  redactAssistantSessionForDisplay,
} from '@murphai/assistant-engine/assistant-runtime'
import {
  completeAssistantOnboarding,
  redactAssistantDisplayPath,
  getAssistantSession,
  readAssistantOnboardingState,
  reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
  listAssistantSessions,
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import type { InboxServices } from '@murphai/inbox-services'
import {
  applyAssistantSelfDeliveryTargetDefaults,
  clearAssistantSelfDeliveryTargets,
  listAssistantSelfDeliveryTargets,
  resolveAssistantSelfDeliveryTarget,
  resolveOperatorConfigPath,
  saveAssistantSelfDeliveryTarget,
} from '@murphai/operator-config/operator-config'
import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
} from '../run-terminal-logging.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { VaultServices } from '@murphai/vault-usecases'
import { requestIdSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  assertLocalAssistantLinqIMessageChannelSupported,
  normalizeAssistantLocalChannel,
} from '../assistant/local-channel-guard.js'

const assistantIdentityRoutingDescription =
  'Optional local assistant identity id for multi-user routing. Email routes should use the configured AgentMail inbox id.'

const assistantParticipantRoutingDescription =
  'Optional remote participant identifier when the transport addresses a person directly. Use the transport-native participant value, such as an email correspondent; thread-addressed transports may rely on --thread instead.'

const assistantThreadRoutingDescription =
  'Optional upstream thread identifier when the transport routes by thread/chat. Use the transport-native thread value, such as a Telegram chat id or `<chatId>:topic:<messageThreadId>` topic route; direct-recipient routes can often leave this unset.'

const assistantOneSendDeliveryTargetRoutingDescription =
  'Optional one-send outbound destination in the transport-native send format. For Telegram use a chat id or `<chatId>:topic:<messageThreadId>`; for email use a recipient address. Reply-in-place sessions can often omit this and reuse the saved thread.'

const assistantSavedDeliveryTargetRoutingDescription =
  'Optional saved outbound destination in the transport-native send format. For Telegram use a chat id or `<chatId>:topic:<messageThreadId>`; for email use a recipient address.'
const assistantEmailDeliveryTargetPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u

const assistantKnownChannelOptionSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const normalized = normalizeAssistantChannelOption(value)
      return normalized
        ? assistantChannelNameSchema.safeParse(normalized).success
        : false
    },
    'Known assistant channel names: telegram, linq/iMessage, email.',
  )
const assistantLocalChannelOptionSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const normalized = normalizeAssistantChannelOption(value)
      return normalized === 'telegram' || normalized === 'email'
    },
    'Supported local assistant channels: telegram, email.',
  )

const VAULT_METADATA_FILE = 'vault.json'

function normalizeAssistantChannelOption(
  value?: string,
): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = normalizeAssistantLocalChannel(value)
  if (!normalized) {
    return undefined
  }

  const parsed = assistantChannelNameSchema.safeParse(normalized)

  return parsed.success ? parsed.data : normalized
}

function optionalNonEmptyStringOption(description: string) {
  return z
    .string()
    .min(1)
    .optional()
    .describe(description)
}

const assistantSessionOptionFields = {
  session: optionalNonEmptyStringOption('Existing Murph assistant session id to resume.'),
  alias: optionalNonEmptyStringOption(
    'Optional stable alias used to map an external conversation onto one assistant session.',
  ),
  channel: assistantLocalChannelOptionSchema
    .optional()
    .describe('Optional channel label such as telegram or email.'),
  identity: optionalNonEmptyStringOption(assistantIdentityRoutingDescription),
  participant: optionalNonEmptyStringOption(assistantParticipantRoutingDescription),
  thread: optionalNonEmptyStringOption(assistantThreadRoutingDescription),
}

const assistantProviderOptionFields = {
  codexCommand: optionalNonEmptyStringOption(
    'Optional Codex executable path used to launch `codex app-server`. Defaults to `codex`.',
  ),
  codexHome: optionalNonEmptyStringOption(
    'Optional Codex home directory used by local assistant chat.',
  ),
  model: optionalNonEmptyStringOption(
    'Optional Codex model override for local chat turns.',
  ),
  modelProvider: optionalNonEmptyStringOption(
    'Optional Codex model provider id for local chat turns.',
  ),
  reasoningEffort: z
    .enum(assistantReasoningEffortValues)
    .optional()
    .describe(
      'Optional Codex reasoning effort for local assistant chat turns.',
    ),
  sandbox: z
    .enum(assistantSandboxValues)
    .optional()
    .describe(
      'Codex sandbox mode for local assistant chat. Codex runs as a privileged local adapter by default, so leaving this unset keeps its normal unsandboxed behavior.',
    ),
  approvalPolicy: z.literal('never').optional().describe(
    'Codex approval policy for local assistant chat. Murph noninteractive assistant turns accept only never; interactive approval modes are rejected before provider launch.',
  ),
  profile: optionalNonEmptyStringOption('Optional Codex config profile name.'),
}

const assistantDeliveryOptionFields = {
  deliverResponse: z
    .boolean()
    .optional()
    .describe(
      'After generating a response, deliver it over the mapped outbound channel session when available.',
    ),
  deliveryTarget: optionalNonEmptyStringOption(
    assistantOneSendDeliveryTargetRoutingDescription,
  ),
}

const assistantSelfDeliveryTargetOptionFields = {
  identity: optionalNonEmptyStringOption(
    'Optional local assistant identity id to reuse for this saved channel target. Email targets require the configured AgentMail inbox id here.',
  ),
  participant: optionalNonEmptyStringOption(assistantParticipantRoutingDescription),
  thread: optionalNonEmptyStringOption(assistantThreadRoutingDescription),
  deliveryTarget: optionalNonEmptyStringOption(
    assistantSavedDeliveryTargetRoutingDescription,
  ),
}

function assertAssistantSelfDeliveryTargetInput(input: {
  channel: string
  deliveryTarget?: string
  identity?: string
  participant?: string
  thread?: string
}) {
  assertLocalAssistantLinqIMessageChannelSupported(input.channel)

  if (!input.deliveryTarget && !input.participant && !input.thread) {
    throw new VaultCliError(
      'invalid_option',
      'Saved self delivery targets require at least --participant, --thread, or --deliveryTarget.',
    )
  }

  if (input.channel === 'email' && !input.identity) {
    throw new VaultCliError(
      'invalid_option',
      'Saved email self delivery targets require --identity with the configured AgentMail inbox id.',
    )
  }

  assertAssistantDeliveryTargetForChannel(input)
}

function assertAssistantDeliveryTargetForChannel(input: {
  channel?: string
  deliveryTarget?: string
}): void {
  assertLocalAssistantLinqIMessageChannelSupported(input.channel)
  assertAssistantDeliveryTargetLooksIntentional(input.deliveryTarget)

  if (
    input.channel !== 'email' ||
    !input.deliveryTarget ||
    assistantEmailDeliveryTargetPattern.test(input.deliveryTarget.trim())
  ) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    'Email delivery targets must be a single recipient email address.',
  )
}

function assertAssistantDeliveryTargetLooksIntentional(
  deliveryTarget?: string,
): void {
  const normalized = deliveryTarget?.trim()
  if (!normalized) {
    return
  }

  if (
    normalized === '[object Object]' ||
    normalized.startsWith('{') ||
    normalized.startsWith('[')
  ) {
    throw new VaultCliError(
      'invalid_option',
      'Assistant delivery targets must be a transport-native string, not a serialized object.',
    )
  }
}

async function assertAssistantInitializedVaultRoot(vault: string): Promise<void> {
  try {
    await access(path.join(vault, VAULT_METADATA_FILE))
    return
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }

  throw new VaultCliError(
    'invalid_vault',
    'The selected vault is not initialized. Run `vault-cli init --vault <path>` first.',
  )
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
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
  thread?: string
}

type AssistantProviderCliOptions = {
  approvalPolicy?: AssistantChatOptions['approvalPolicy']
  codexCommand?: string
  codexHome?: string
  model?: string
  modelProvider?: string
  profile?: string
  reasoningEffort?: AssistantChatOptions['reasoningEffort']
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
      'Show a compact assistant runtime snapshot including recent turn receipts and the outbound outbox backlog. Use this to inspect the provider and model actually used by recent or active assistant turns.',
    hint:
      input?.hint ??
      'Use this when the assistant feels stuck, duplicated a send, or you want the latest receipt timeline without opening the local runtime files under `.runtime/operations/assistant/`.',
    options: withBaseOptions({
      session: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional assistant session id to scope the runtime snapshot to one session and inspect the provider/model used there.',
        ),
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
      await assertAssistantInitializedVaultRoot(context.options.vault)
      if (context.options.session) {
        await getAssistantSession(context.options.vault, context.options.session)
      }

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
      'Run lightweight assistant runtime diagnostics for session files, receipts, transcripts, automation state, and the outbound outbox.',
    hint:
      input?.hint ??
      'Use --repair to tighten local assistant runtime permissions in place.',
    options: withBaseOptions({
      repair: z
        .boolean()
        .default(false)
        .describe(
          'Repair local assistant runtime file and directory permissions in place.',
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

function buildAssistantOnboardingResult(vault: string, onboarding: unknown) {
  return assistantOnboardingResultSchema.parse({
    ...buildAssistantStateResultPaths(vault),
    statePath: redactAssistantDisplayPath(resolveAssistantOnboardingStatePath(vault)),
    onboarding,
  })
}

const assistantSessionListDefaultLimit = 5

function normalizeAssistantSessionListLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return assistantSessionListDefaultLimit
  }

  return Math.min(Math.max(limit, 1), 50)
}

function toAssistantSessionSummary(session: AssistantSession): AssistantSessionSummary {
  const redacted = redactAssistantSessionForDisplay(session)
  return {
    schema: redacted.schema,
    conversationId: redacted.conversationId,
    sessionId: redacted.sessionId,
    alias: redacted.alias,
    binding: redacted.binding,
    createdAt: redacted.createdAt,
    updatedAt: redacted.updatedAt,
    lastTurnAt: redacted.lastTurnAt,
    turnCount: redacted.turnCount,
    provider: redacted.provider,
    model: redacted.providerOptions.model,
    modelProvider: redacted.providerOptions.modelProvider ?? null,
    reasoningEffort: redacted.providerOptions.reasoningEffort,
    sandbox: redacted.providerOptions.sandbox,
    approvalPolicy: redacted.providerOptions.approvalPolicy,
    profile: redacted.providerOptions.profile,
    oss: redacted.providerOptions.oss,
    executionDriver: redacted.providerOptions.executionDriver,
    resumeKind: redacted.providerOptions.resumeKind,
    resumeThreadId: redacted.resumeState?.threadId ?? null,
  }
}

type AssistantOnboardingResumeContextSurface =
  AssistantOnboardingResumeContextResult[
    | 'goals'
    | 'regimens'
    | 'supplements'
    | 'conditions'
    | 'allergies'
    | 'experiments'
    | 'deviceAccounts'
  ]

type AssistantOnboardingDeviceAccountServices = {
  devices?: {
    listAccounts(input: {
      baseUrl?: string
      provider?: string
      sourceProvider?: string
      vault?: string
    }): Promise<{
      accounts: unknown[]
    }>
  }
}

type AssistantVaultServices = VaultServices &
  AssistantOnboardingDeviceAccountServices

const assistantOnboardingResumeContextDefaultLimit = 3

function normalizeAssistantOnboardingResumeContextLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), 50)
}

function requireAssistantVaultServices(
  services: AssistantVaultServices | undefined,
): AssistantVaultServices {
  if (!services) {
    throw new VaultCliError(
      'unavailable',
      'Assistant onboarding resume context requires vault services.',
    )
  }

  return services
}

function buildAssistantOnboardingResumeContextErrorSurface():
  AssistantOnboardingResumeContextSurface {
  return {
    status: 'error',
    message: 'Read failed.',
  }
}

function buildAssistantOnboardingResumeContextListSurface(input: {
  count?: number
  items: readonly unknown[]
  limit: number
}): AssistantOnboardingResumeContextSurface {
  const count = input.count ?? input.items.length
  const items = input.items.slice(0, input.limit)

  return {
    status: 'ok',
    count,
    truncated: count > items.length,
    items,
  }
}

async function readAssistantOnboardingResumeContextListSurface(input: {
  limit: number
  read: () => Promise<{
    count?: number
    items?: readonly unknown[]
  }>
}): Promise<AssistantOnboardingResumeContextSurface> {
  try {
    const result = await input.read()

    return buildAssistantOnboardingResumeContextListSurface({
      count: result.count,
      items: result.items ?? [],
      limit: input.limit,
    })
  } catch {
    return buildAssistantOnboardingResumeContextErrorSurface()
  }
}

async function readAssistantOnboardingResumeContextMemory(input: {
  commandContext: {
    requestId: string | null
    vault: string
  }
  limit: number
  services: AssistantVaultServices
}): Promise<AssistantOnboardingResumeContextResult['memory']> {
  try {
    const result = await input.services.query.readMemoryDocument(
      input.commandContext,
    )
    const records = result.document.records.slice(0, input.limit)

    return {
      status: 'ok',
      exists: result.document.exists,
      recordCount: result.document.records.length,
      records,
      truncated: result.document.records.length > records.length,
      updatedAt: result.document.updatedAt,
    }
  } catch {
    return {
      status: 'error',
      message: 'Read failed.',
    }
  }
}

function resolveAssistantOnboardingDeviceAccountServices(
  services?: AssistantVaultServices,
): AssistantOnboardingDeviceAccountServices['devices'] | null {
  return services?.devices ?? null
}

async function readAssistantOnboardingResumeContextDeviceAccounts(input: {
  limit: number
  services?: AssistantVaultServices
  vault: string
}): Promise<AssistantOnboardingResumeContextSurface> {
  const deviceServices = resolveAssistantOnboardingDeviceAccountServices(
    input.services,
  )
  if (!deviceServices) {
    return buildAssistantOnboardingResumeContextErrorSurface()
  }

  return readAssistantOnboardingResumeContextListSurface({
    limit: input.limit,
    async read() {
      const result = await deviceServices.listAccounts({
        vault: input.vault,
      })

      return {
        count: result.accounts.length,
        items: result.accounts,
      }
    },
  })
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
    channel: normalizeAssistantChannelOption(options.channel),
    identityId: options.identity,
    participantId: options.participant,
    threadId: options.thread,
  }
}

function assistantProviderOverridesFromCli<T extends AssistantProviderCliOptions>(
  options: T,
) {
  return {
    codexCommand: options.codexCommand,
    codexHome: options.codexHome,
    model: options.model,
    modelProvider: options.modelProvider,
    reasoningEffort: options.reasoningEffort,
    sandbox: options.sandbox,
    approvalPolicy: options.approvalPolicy,
    profile: options.profile,
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
  thread?: string
}) {
  return applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: normalizeAssistantChannelOption(input.channel),
      identityId: input.identity,
      participantId: input.participant,
      threadId: input.thread,
      deliveryTarget: input.deliveryTarget,
    },
    {
      allowSingleSavedTargetFallback: input.allowSingleSavedTargetFallback,
    },
  )
}

async function resolveAssistantDeliveryInvocationFromCli(
  options: AssistantConversationCliOptions & AssistantDeliveryCliOptions,
  input: {
    resolveSavedRoute: boolean
    session?: Awaited<ReturnType<typeof getAssistantSession>> | null
  },
) {
  const deliveryOverrides = assistantDeliveryOverridesFromCli(options)
  const savedRoute = input.resolveSavedRoute
    ? await resolveAssistantDeliveryRouteFromCli({
        allowSingleSavedTargetFallback: true,
        channel: options.channel,
        identity: options.identity,
        participant: options.participant,
        thread: options.thread,
        deliveryTarget: deliveryOverrides.deliveryTarget,
      })
    : null
  const resolvedChannel =
    savedRoute?.channel ??
    input.session?.binding.channel ??
    normalizeAssistantChannelOption(options.channel)
  const resolvedDeliveryTarget =
    savedRoute?.deliveryTarget ?? deliveryOverrides.deliveryTarget

  assertAssistantDeliveryTargetForChannel({
    channel: resolvedChannel,
    deliveryTarget: resolvedDeliveryTarget,
  })

  return {
    conversationOptions: assistantConversationOptionsFromCli({
      ...options,
      channel: resolvedChannel,
      identity: savedRoute?.identityId ?? options.identity,
      participant: savedRoute?.participantId ?? options.participant,
      thread: savedRoute?.threadId ?? options.thread,
    }),
    deliveryOverrides,
    resolvedDeliveryTarget,
  }
}

async function runAssistantChatCommand(context: {
  args: AssistantChatArgs
  options: AssistantChatOptions
  agent: boolean
  formatExplicit: boolean
}) {
  // Lazy import: the ink chat surface drags ink/react/yoga-layout into the
  // module graph, which must stay off the per-invocation CLI hot path.
  const { assertAssistantInkInteractiveInputAvailable } = await import(
    '../assistant-chat-ink.js'
  )
  assertAssistantInkInteractiveInputAvailable()

  const result = await runAssistantChat({
    vault: context.options.vault,
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
      'Open an Ink terminal chat UI backed by Codex App Server while Murph stores session metadata plus a local transcript outside the canonical vault. This command requires interactive terminal input.',
    hint:
      input?.hint ??
      'Requires an interactive terminal. Type /exit to close the chat loop or /session to print the current Murph session id.',
    options: assistantChatOptionsSchema,
    output: assistantChatResultSchema,
    outputPolicy: 'agent-only' as const,
    run: runAssistantChatCommand,
  }
}

const assistantRunOptionsSchema = withBaseOptions({
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
      'Allow self-authored captures to trigger channel auto-reply. Useful for a dedicated assistant self-chat or sandbox thread, but only safe when you isolate that thread to Murph.',
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
      'Start the local assistant automation loop that watches the inbox runtime, runs due automations, and auto-replies over configured local channels such as Telegram or email.',
    hint:
      input?.hint ??
      'Channel auto-reply and due automations run through the saved Codex assistant backend while this loop is active.',
    examples: [
      {
        options: {
          vault: './vault',
          once: true,
        },
        description: 'Run a single assistant automation scan in one-shot mode.',
      },
      {
        options: {
          vault: './vault',
          allowSelfAuthored: true,
          sessionRolloverHours: 48,
        },
        description: 'Run a dedicated self-chat thread with two-day session rollover.',
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
        maxPerScan: context.options.maxPerScan,
        allowSelfAuthored: context.options.allowSelfAuthored,
        sessionMaxAgeMs:
          typeof context.options.sessionRolloverHours === 'number'
            ? context.options.sessionRolloverHours * 60 * 60 * 1000
            : null,
        once: context.options.once,
        startDaemon: context.options.once === true ? false : true,
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
  vaultServices?: AssistantVaultServices,
) {
  const assistant = Cli.create('assistant', {
    description:
      'Murph assistant commands for canonical conversation style, Codex App Server-backed local chat sessions, Ink terminal chat, outbound delivery, and auto-routing inbox automation.',
  })

  const registerConversationCommands = () => {
    assistant.command('ask', {
      args: z.object({
        prompt: z.string().min(1).describe('Prompt to send to the local assistant session.'),
      }),
      description:
        'Send one message through the local Codex App Server-backed assistant and persist session metadata plus a local transcript outside the canonical vault.',
      hint:
        'Murph persists a local transcript plus per-session metadata under `.runtime/operations/assistant/`, and still reuses Codex thread continuity when available. Use --deliverResponse to send the assistant reply back out over a mapped channel such as Telegram or email.',
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
            prompt: 'Reply that I can review the latest labs tonight.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            participant: '123456789',
            thread: '123456789',
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
        const session = context.options.session
          ? await getAssistantSession(context.options.vault, context.options.session)
          : null

        const delivery = await resolveAssistantDeliveryInvocationFromCli(
          context.options,
          {
            resolveSavedRoute: Boolean(
              context.options.deliverResponse && !context.options.session,
            ),
            session,
          },
        )

        return sendAssistantMessage({
          vault: context.options.vault,
          prompt: context.args.prompt,
          ...delivery.conversationOptions,
          ...assistantProviderOverridesFromCli(context.options),
          ...delivery.deliveryOverrides,
          deliveryTarget: delivery.resolvedDeliveryTarget,
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
        'Deliver one explicit outbound assistant message through a stored Telegram or email assistant channel binding. Use `assistant ask --deliverResponse` when Codex should compose the reply.',
      hint:
        'Use --deliveryTarget to override the stored delivery target for one send only. For Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for email it can be a recipient address while thread-bound sessions reply in place.',
      examples: [
        {
          args: {
            message: 'Here is your nutrition recap for lunch.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            thread: '123456789',
            deliveryTarget: '123456789',
          },
          description: 'Send a direct Telegram reply to one chat.',
        },
        {
          args: {
            message: 'I imported that lab report and queued the parser.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            thread: '-1001234567890:topic:42',
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
          .describe(assistantOneSendDeliveryTargetRoutingDescription),
      }),
      output: assistantDeliverResultSchema,
      async run(context) {
        const session = context.options.session
          ? await getAssistantSession(context.options.vault, context.options.session)
          : null

        const delivery = await resolveAssistantDeliveryInvocationFromCli(
          context.options,
          {
            resolveSavedRoute: !context.options.session,
            session,
          },
        )
        return deliverAssistantMessage({
          vault: context.options.vault,
          message: context.args.message,
          ...delivery.conversationOptions,
          target: delivery.resolvedDeliveryTarget,
        })
      },
    })

    assistant.command(
      'run',
      createAssistantRunCommandDefinition(inboxServices, vaultServices),
    )
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
        channel: assistantKnownChannelOptionSchema.describe('Saved outbound channel to inspect.'),
      }),
      description: 'Show one saved self-delivery target for a specific outbound channel.',
      options: z.object({
        requestId: requestIdSchema,
      }),
      output: assistantSelfDeliveryTargetShowResultSchema,
      async run(context) {
        return {
          ...buildAssistantOperatorConfigResult(),
          target: await resolveAssistantSelfDeliveryTarget(context.args.channel),
        }
      },
    })

    selfTarget.command('set', {
      args: z.object({
        channel: assistantLocalChannelOptionSchema
          .describe('Outbound channel to save, such as telegram or email.'),
      }),
      description:
        'Save or replace the local default outbound target for one channel. Provide at least one of --participant, --thread, or --deliveryTarget; saved email targets also require --identity with the configured AgentMail inbox id.',
      hint:
        'Provide at least one of --participant, --thread, or --deliveryTarget. Saved email targets also require --identity with the configured AgentMail inbox id.',
      options: z.object({
        requestId: requestIdSchema,
        ...assistantSelfDeliveryTargetOptionFields,
      }),
      output: assistantSelfDeliveryTargetSetResultSchema,
      async run(context) {
        const channel =
          normalizeAssistantChannelOption(context.args.channel) ?? context.args.channel
        assertAssistantSelfDeliveryTargetInput({
          channel,
          identity: context.options.identity,
          participant: context.options.participant,
          thread: context.options.thread,
          deliveryTarget: context.options.deliveryTarget,
        })

        const target = await saveAssistantSelfDeliveryTarget({
          channel,
          deliverySource: null,
          identityId: context.options.identity ?? null,
          participantId: context.options.participant ?? null,
          threadId: context.options.thread ?? null,
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
        channel: assistantKnownChannelOptionSchema
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
          clearedChannels: await clearAssistantSelfDeliveryTargets(
            normalizeAssistantChannelOption(context.args.channel),
          ),
        }
      },
    })

    assistant.command(selfTarget)
  }

  const registerObservabilityCommands = () => {
    assistant.command('status', createAssistantStatusCommandDefinition())
    assistant.command('doctor', createAssistantDoctorCommandDefinition())
    assistant.command('stop', createAssistantStopCommandDefinition())
  }

  const registerOnboardingCommands = () => {
    const onboarding = Cli.create('onboarding', {
      description:
        'Inspect or update the local assistant Murph onboarding lifecycle state shared across user-facing channels for this vault.',
    })

    onboarding.command('status', {
      args: emptyArgsSchema,
      description:
        'Show whether assistant Murph onboarding is still open or has already been completed for this vault.',
      options: withBaseOptions(),
      output: assistantOnboardingResultSchema,
      async run(context) {
        return buildAssistantOnboardingResult(
          context.options.vault,
          await readAssistantOnboardingState(context.options.vault),
        )
      },
    })

    onboarding.command('resume-context', {
      args: emptyArgsSchema,
      description:
        'Read the compact setup context Murph needs to resume first-run onboarding without re-asking saved facts.',
      options: withBaseOptions({
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .default(assistantOnboardingResumeContextDefaultLimit)
          .describe(
            'Maximum records to return per setup surface. Defaults to 3.',
          ),
      }),
      output: assistantOnboardingResumeContextResultSchema,
      async run(context) {
        const services = requireAssistantVaultServices(vaultServices)
        const vault = context.options.vault
        const limit = normalizeAssistantOnboardingResumeContextLimit(
          context.options.limit,
        )
        const commandContext = {
          requestId: requestIdFromOptions(context.options),
          vault,
        }
        const [
          onboardingState,
          memory,
          goals,
          regimens,
          supplements,
          conditions,
          allergies,
          experiments,
          deviceAccounts,
        ] = await Promise.all([
          readAssistantOnboardingState(vault),
          readAssistantOnboardingResumeContextMemory({
            commandContext,
            limit,
            services,
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            read: () => services.query.listGoals({ ...commandContext, limit }),
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            read: () => services.query.listRegimens({ ...commandContext, limit }),
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            read: () => services.query.listSupplements({ ...commandContext, limit }),
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            read: () => services.query.listConditions({ ...commandContext, limit }),
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            read: () => services.query.listAllergies({ ...commandContext, limit }),
          }),
          readAssistantOnboardingResumeContextListSurface({
            limit,
            async read() {
              const result = await services.query.listExperiments({
                ...commandContext,
                limit,
              })

              return {
                count: result.count,
                items: result.items,
              }
            },
          }),
          readAssistantOnboardingResumeContextDeviceAccounts({
            limit,
            services,
            vault,
          }),
        ])

        return assistantOnboardingResumeContextResultSchema.parse({
          vault: redactAssistantDisplayPath(vault),
          limit,
          onboarding: onboardingState,
          memory,
          goals,
          regimens,
          supplements,
          conditions,
          allergies,
          experiments,
          deviceAccounts,
        })
      },
    })

    onboarding.command('complete', {
      args: emptyArgsSchema,
      description:
        'Mark assistant Murph onboarding complete for this vault so the onboarding prompt policy stops being injected on future turns.',
      options: withBaseOptions({
        reason: z
          .enum(assistantOnboardingCompletionReasonValues)
          .describe(
            'Why onboarding is done: user_answered, user_declined, or manual.',
          ),
      }),
      output: assistantOnboardingResultSchema,
      async run(context) {
        return buildAssistantOnboardingResult(
          context.options.vault,
          await completeAssistantOnboarding({
            reason: context.options.reason,
            vault: context.options.vault,
          }),
        )
      },
    })

    onboarding.command('reopen', {
      args: emptyArgsSchema,
      description:
        'Reopen assistant Murph onboarding for this vault so onboarding guidance is injected again until it is completed later.',
      options: withBaseOptions(),
      output: assistantOnboardingResultSchema,
      async run(context) {
        return buildAssistantOnboardingResult(
          context.options.vault,
          await reopenAssistantOnboarding({
            vault: context.options.vault,
          }),
        )
      },
    })

    assistant.command(onboarding)
  }

  const registerSessionCommands = () => {
    const session = Cli.create('session', {
      description:
        'Inspect Murph assistant session metadata stored outside the canonical vault.',
    })

    session.command('list', {
      args: emptyArgsSchema,
      description: 'List known assistant sessions for one vault.',
      options: withBaseOptions({
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .default(assistantSessionListDefaultLimit)
          .describe('Maximum number of recent assistant sessions to return. Defaults to 5.'),
      }),
      output: assistantSessionListResultSchema,
      async run(context) {
        await assertAssistantInitializedVaultRoot(context.options.vault)
        const limit = normalizeAssistantSessionListLimit(context.options.limit)
        const sessions = await listAssistantSessions(context.options.vault, {
          limit,
        })
        return assistantSessionListResultSchema.parse({
          ...buildAssistantStateResultPaths(context.options.vault),
          filters: { limit },
          sessions: sessions.map(toAssistantSessionSummary),
          count: sessions.length,
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
        await assertAssistantInitializedVaultRoot(context.options.vault)
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
          'Open the same interactive assistant chat UI as `assistant chat` directly from the CLI root.',
        hint:
          'Shorthand for `assistant chat`. Requires an interactive terminal. Type /exit to close the chat loop or /session to print the current Murph session id.',
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
          'Show the same assistant runtime snapshot as `assistant status` directly from the CLI root, including the provider and model used by recent turns.',
        hint:
          'Shorthand for `assistant status`. Use this to inspect live or recent runtime evidence such as recent turn receipts, the provider/model used, session freshness, and pending outbox work.',
      }),
    )
    cli.command(
      'doctor',
      createAssistantDoctorCommandDefinition({
        description:
          'Run the same assistant runtime diagnostics as `assistant doctor` directly from the CLI root.',
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
  registerSelfTargetCommands()
  registerObservabilityCommands()
  registerOnboardingCommands()
  registerSessionCommands()

  cli.command(assistant)
  registerRootAliases()
}
