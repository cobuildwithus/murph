import { Cli, z } from 'incur'
import {
  assistantApprovalPolicyValues,
  assistantAskResultSchema,
  assistantChatProviderValues,
  assistantChatResultSchema,
  assistantDeliverResultSchema,
  assistantDoctorResultSchema,
  assistantRunResultSchema,
  assistantSelfDeliveryTargetClearResultSchema,
  assistantSelfDeliveryTargetListResultSchema,
  assistantSelfDeliveryTargetSetResultSchema,
  assistantSelfDeliveryTargetShowResultSchema,
  assistantSandboxValues,
  assistantSessionListResultSchema,
  assistantSessionShowResultSchema,
  assistantStopResultSchema,
  assistantStatusResultSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import { deliverAssistantMessage } from '@murphai/assistant-engine/outbound-channel'
import type { ConversationRef } from '@murphai/assistant-engine/assistant-runtime'
import {
  runAssistantAutomation,
  runAssistantChat,
  sendAssistantMessage,
  stopAssistantAutomation,
} from '../assistant/runtime.js'
import { runAssistantDoctor } from '../assistant/doctor.js'
import { getAssistantStatus } from '../assistant/status.js'
import {
  redactAssistantSessionForDisplay,
  redactAssistantSessionsForDisplay,
} from '@murphai/assistant-engine/assistant-runtime'
import {
  redactAssistantDisplayPath,
  getAssistantSession,
  listAssistantSessions,
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import {
  emptyArgsSchema,
  parseHeadersJsonOption,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import type { InboxServices } from '@murphai/inbox-services'
import {
  applyAssistantSelfDeliveryTargetDefaults,
  clearAssistantSelfDeliveryTargets,
  listAssistantSelfDeliveryTargets,
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

const assistantIdentityRoutingDescription =
  'Optional local assistant identity id for multi-user routing. Email routes should use the configured AgentMail inbox id.'

const assistantParticipantRoutingDescription =
  'Optional remote participant identifier when the transport addresses a person directly. Use the transport-native participant value, such as an email correspondent; thread-addressed transports may rely on --sourceThread instead.'

const assistantSourceThreadRoutingDescription =
  'Optional upstream thread identifier when the transport routes by thread/chat. Use the transport-native thread value, such as a Telegram chat id or `<chatId>:topic:<messageThreadId>` topic route; direct-recipient routes can often leave this unset.'

const assistantOneSendDeliveryTargetRoutingDescription =
  'Optional one-send outbound destination in the transport-native send format. For Telegram use a chat id or `<chatId>:topic:<messageThreadId>`; for Linq use a chat id; for email use a recipient address. Reply-in-place sessions can often omit this and reuse the saved thread.'

const assistantSavedDeliveryTargetRoutingDescription =
  'Optional saved outbound destination in the transport-native send format. For Telegram use a chat id or `<chatId>:topic:<messageThreadId>`; for Linq use a chat id; for email use a recipient address.'

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
  channel: optionalNonEmptyStringOption(
    'Optional channel label such as telegram, linq, or email.',
  ),
  identity: optionalNonEmptyStringOption(assistantIdentityRoutingDescription),
  participant: optionalNonEmptyStringOption(assistantParticipantRoutingDescription),
  sourceThread: optionalNonEmptyStringOption(assistantSourceThreadRoutingDescription),
}

const assistantProviderOptionFields = {
  provider: z
    .enum(assistantChatProviderValues)
    .optional()
    .describe(
      'Chat provider adapter for the local assistant surface. The runtime is provider-backed even when only one adapter is installed.',
    ),
  codexCommand: optionalNonEmptyStringOption(
    'Optional Codex CLI executable path. Defaults to `codex`.',
  ),
  model: optionalNonEmptyStringOption(
    'Optional provider model override for local chat turns.',
  ),
  baseUrl: optionalNonEmptyStringOption(
    'Optional OpenAI-compatible base URL for local assistant chat, such as http://127.0.0.1:11434/v1 for Ollama.',
  ),
  apiKeyEnv: optionalNonEmptyStringOption(
    'Optional environment variable name that stores the OpenAI-compatible API key for local assistant chat.',
  ),
  providerName: optionalNonEmptyStringOption(
    'Optional stable provider label for OpenAI-compatible local assistant chat sessions.',
  ),
  headersJson: optionalNonEmptyStringOption(
    'Optional flat JSON object of extra HTTP headers with string values for OpenAI-compatible local assistant chat sessions.',
  ),
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
  profile: optionalNonEmptyStringOption('Optional Codex config profile name.'),
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
  deliveryTarget: optionalNonEmptyStringOption(
    assistantOneSendDeliveryTargetRoutingDescription,
  ),
}

const assistantSelfDeliveryTargetOptionFields = {
  identity: optionalNonEmptyStringOption(
    'Optional local assistant identity id to reuse for this saved channel target. Email targets require the configured AgentMail inbox id here.',
  ),
  participant: optionalNonEmptyStringOption(assistantParticipantRoutingDescription),
  sourceThread: optionalNonEmptyStringOption(assistantSourceThreadRoutingDescription),
  deliveryTarget: optionalNonEmptyStringOption(
    assistantSavedDeliveryTargetRoutingDescription,
  ),
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

async function resolveAssistantDeliveryInvocationFromCli(
  options: AssistantConversationCliOptions & AssistantDeliveryCliOptions,
  input: {
    resolveSavedRoute: boolean
  },
) {
  const deliveryOverrides = assistantDeliveryOverridesFromCli(options)
  const savedRoute = input.resolveSavedRoute
    ? await resolveAssistantDeliveryRouteFromCli({
        allowSingleSavedTargetFallback: true,
        channel: options.channel,
        identity: options.identity,
        participant: options.participant,
        sourceThread: options.sourceThread,
        deliveryTarget: deliveryOverrides.deliveryTarget,
      })
    : null

  return {
    conversationOptions: assistantConversationOptionsFromCli({
      ...options,
      channel: savedRoute?.channel ?? options.channel,
      identity: savedRoute?.identityId ?? options.identity,
      participant: savedRoute?.participantId ?? options.participant,
      sourceThread: savedRoute?.sourceThreadId ?? options.sourceThread,
    }),
    deliveryOverrides,
    resolvedDeliveryTarget: savedRoute?.deliveryTarget ?? deliveryOverrides.deliveryTarget,
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
      'Open an Ink terminal chat UI backed by the chosen provider while Murph stores session metadata plus a local transcript outside the canonical vault. This command requires interactive terminal input.',
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
    .describe(
      'Optional flat JSON object of extra HTTP headers with string values for the routing endpoint.',
    ),
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
      'Start the local assistant automation loop that watches the inbox runtime, runs due automations, auto-replies over configured channels such as Telegram, Linq, or email, and optionally applies model-routed canonical promotions.',
    hint:
      input?.hint ??
      'Use --baseUrl with a local OpenAI-compatible model endpoint such as Ollama when you also want canonical inbox triage. Channel auto-reply can run without a routing model, and due automations fire while this loop is active.',
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
        },
        description: 'Run a single inbox scan in one-shot mode.',
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
        'Murph persists a local transcript plus per-session metadata under `.runtime/operations/assistant/`, and still reuses provider-side history when available. Use --deliverResponse to send the assistant reply back out over a mapped channel such as Telegram, Linq, or email.',
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
            channel: 'linq',
            sourceThread: 'chat_lunch',
            deliveryTarget: 'chat_lunch',
            deliverResponse: true,
          },
          description: 'Generate a reply locally and deliver it over Linq.',
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
        const delivery = await resolveAssistantDeliveryInvocationFromCli(
          context.options,
          {
            resolveSavedRoute: Boolean(
              context.options.deliverResponse && !context.options.session,
            ),
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
        'Deliver one outbound assistant message without invoking the chat provider. Telegram, Linq, and email all use the same stored assistant channel binding surface.',
      hint:
        'Use --deliveryTarget to override the stored delivery target for one send only. For Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for Linq it can be a chat id; for email it can be a recipient address while thread-bound sessions reply in place.',
      examples: [
        {
          args: {
            message: 'Here is your nutrition recap for lunch.',
          },
          options: {
            vault: './vault',
            channel: 'telegram',
            sourceThread: '123456789',
            deliveryTarget: '123456789',
          },
          description: 'Send a direct Telegram reply to one chat.',
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
          .describe(assistantOneSendDeliveryTargetRoutingDescription),
      }),
      output: assistantDeliverResultSchema,
      async run(context) {
        const delivery = await resolveAssistantDeliveryInvocationFromCli(
          context.options,
          {
            resolveSavedRoute: !context.options.session,
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
          .describe('Outbound channel to save, such as telegram, linq, or email.'),
      }),
      description:
        'Save or replace the local default outbound target for one channel. Provide at least one of --participant, --sourceThread, or --deliveryTarget; saved email targets also require --identity with the configured AgentMail inbox id.',
      hint:
        'Provide at least one of --participant, --sourceThread, or --deliveryTarget. Saved email targets also require --identity with the configured AgentMail inbox id.',
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
  registerSessionCommands()

  cli.command(assistant)
  registerRootAliases()
}
