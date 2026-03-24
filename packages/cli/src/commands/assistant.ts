import { Cli, z } from 'incur'
import {
  assistantApprovalPolicyValues,
  assistantAskResultSchema,
  assistantChatProviderValues,
  assistantChatResultSchema,
  assistantCronAddResultSchema,
  assistantCronListResultSchema,
  assistantCronRemoveResultSchema,
  assistantCronRunResultSchema,
  assistantCronRunsResultSchema,
  assistantCronShowResultSchema,
  assistantCronStatusResultSchema,
  assistantDeliverResultSchema,
  assistantMemoryForgetResultSchema,
  assistantMemoryGetResultSchema,
  assistantMemoryLongTermSectionValues,
  assistantMemoryQueryScopeValues,
  assistantMemorySearchResultSchema,
  assistantMemoryUpsertResultSchema,
  assistantMemoryVisibleSectionValues,
  assistantMemoryWriteScopeValues,
  assistantRunResultSchema,
  assistantSandboxValues,
  assistantSessionListResultSchema,
  assistantSessionShowResultSchema,
} from '../assistant-cli-contracts.js'
import { deliverAssistantMessage } from '../assistant-channel.js'
import type { ConversationRef } from '../assistant/conversation-ref.js'
import {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronJob,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  removeAssistantCronJob,
  runAssistantAutomation,
  runAssistantChat,
  runAssistantCronJobNow,
  sendAssistantMessage,
  setAssistantCronJobEnabled,
} from '../assistant-runtime.js'
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
} from '../assistant/memory.js'
import {
  redactAssistantDisplayPath,
  getAssistantSession,
  listAssistantSessions,
  resolveAssistantStatePaths,
} from '../assistant-state.js'
import {
  emptyArgsSchema,
  parseHeadersJsonOption,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import type { InboxCliServices } from '../inbox-services.js'
import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
} from '../run-terminal-logging.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const assistantSessionOptionFields = {
  session: z
    .string()
    .min(1)
    .optional()
    .describe('Existing Healthy Bob assistant session id to resume.'),
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
    .describe('Optional channel label such as imessage, telegram, or email.'),
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
  sandbox: z
    .enum(assistantSandboxValues)
    .optional()
    .describe(
      'Codex sandbox mode for local assistant chat. Defaults to workspace-write for low-friction local tool use.',
    ),
  approvalPolicy: z
    .enum(assistantApprovalPolicyValues)
    .optional()
    .describe(
      'Codex approval policy for local assistant chat. Defaults to on-request with workspace-write sandboxing.',
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
      'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for email it can be a recipient address while thread-bound sessions reply in place.',
    ),
}

function buildAssistantCronResultPaths(vault: string) {
  const statePaths = resolveAssistantStatePaths(vault)
  return {
    vault: redactAssistantDisplayPath(vault),
    stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
    jobsPath: redactAssistantDisplayPath(statePaths.cronJobsPath),
    runsRoot: redactAssistantDisplayPath(statePaths.cronRunsDirectory),
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

async function runAssistantChatCommand(context: {
  args: AssistantChatArgs
  options: AssistantChatOptions
  agent: boolean
  formatExplicit: boolean
}) {
  const result = await runAssistantChat({
    vault: context.options.vault,
    enableFirstTurnOnboarding: true,
    initialPrompt: context.args.prompt,
    sessionId: context.options.session,
    alias: context.options.alias,
    channel: context.options.channel,
    identityId: context.options.identity,
    participantId: context.options.participant,
    sourceThreadId: context.options.sourceThread,
    provider: context.options.provider,
    codexCommand: context.options.codexCommand,
    model: context.options.model,
    baseUrl: context.options.baseUrl,
    apiKeyEnv: context.options.apiKeyEnv,
    providerName: context.options.providerName,
    sandbox: context.options.sandbox,
    approvalPolicy: context.options.approvalPolicy,
    profile: context.options.profile,
    oss: context.options.oss,
  })

  if (!context.agent && !context.formatExplicit) {
    process.stderr.write(
      `Resume chat by typing: ${formatAssistantChatResumeCommand(result.session.sessionId)}\n`,
    )
  }

  return result
}

function formatAssistantChatResumeCommand(sessionId: string): string {
  return `healthybob chat --session "${sessionId}"`
}

function createAssistantChatCommandDefinition(input?: {
  description?: string
  hint?: string
}) {
  return {
    args: assistantChatArgsSchema,
    description:
      input?.description ??
      'Open an Ink terminal chat UI backed by the chosen provider while Healthy Bob stores session metadata plus a local transcript outside the canonical vault.',
    hint:
      input?.hint ??
      'Type /exit to close the chat loop or /session to print the current Healthy Bob session id.',
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
      'Allow self-authored captures to trigger channel auto-reply. Useful for texting your own Mac, but only safe when you dedicate a self-chat thread to Healthy Bob.',
    ),
  sessionRolloverHours: z
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .optional()
    .describe(
      'Optional maximum age for a reused assistant session in hours before Healthy Bob starts a new one for the same channel thread.',
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
  inboxServices: InboxCliServices,
  vaultServices?: VaultCliServices,
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
          const message = formatAssistantRunEventForTerminal(event)
          if (message) {
            console.error(formatForegroundLogLine('assistant', message))
          }
        },
        onInboxEvent(event) {
          const message = formatInboxRunEventForTerminal(event)
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
  inboxServices: InboxCliServices,
  vaultServices?: VaultCliServices,
) {
  const assistant = Cli.create('assistant', {
    description:
      'Healthy Bob-native assistant runtime with provider-backed local chat sessions, Ink terminal chat, outbound delivery, and auto-routing inbox automation.',
  })

  assistant.command('ask', {
    args: z.object({
      prompt: z.string().min(1).describe('Prompt to send to the local assistant session.'),
    }),
    description:
      'Send one message through the local provider-backed assistant and persist session metadata plus a local transcript outside the canonical vault.',
    hint:
      'Healthy Bob persists a local transcript plus per-session metadata under assistant-state/, and still reuses provider-side history when available. Use --deliverResponse to send the assistant reply back out over a mapped channel such as iMessage, Telegram, or email.',
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
      return sendAssistantMessage({
        vault: context.options.vault,
        prompt: context.args.prompt,
        sessionId: context.options.session,
        alias: context.options.alias,
        channel: context.options.channel,
        identityId: context.options.identity,
        participantId: context.options.participant,
        sourceThreadId: context.options.sourceThread,
        provider: context.options.provider,
        codexCommand: context.options.codexCommand,
        model: context.options.model,
        baseUrl: context.options.baseUrl,
        apiKeyEnv: context.options.apiKeyEnv,
        providerName: context.options.providerName,
        sandbox: context.options.sandbox,
        approvalPolicy: context.options.approvalPolicy,
        profile: context.options.profile,
        oss: context.options.oss,
        deliverResponse: context.options.deliverResponse,
        deliveryTarget: context.options.deliveryTarget,
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
      'Deliver one outbound assistant message without invoking the chat provider. iMessage, Telegram, and email all use the same stored assistant channel binding surface.',
    hint:
      'Use --deliveryTarget to override the stored delivery target for one send only. For iMessage that target can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for email it can be a recipient address while thread-bound sessions reply in place.',
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
          'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id; for Telegram it can be a chat id or <chatId>:topic:<messageThreadId>; for email it can be a recipient address while thread-bound sessions reply in place.',
        ),
    }),
    output: assistantDeliverResultSchema,
    async run(context) {
      return deliverAssistantMessage({
        vault: context.options.vault,
        message: context.args.message,
        sessionId: context.options.session,
        alias: context.options.alias,
        channel: context.options.channel,
        identityId: context.options.identity,
        participantId: context.options.participant,
        sourceThreadId: context.options.sourceThread,
        target: context.options.deliveryTarget,
      })
    },
  })

  assistant.command(
    'run',
    createAssistantRunCommandDefinition(inboxServices, vaultServices),
  )

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
      const statePaths = resolveAssistantMemoryStoragePaths(context.options.vault)

      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
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
      const statePaths = resolveAssistantMemoryStoragePaths(context.options.vault)

      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
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
      const statePaths = resolveAssistantMemoryStoragePaths(context.options.vault)

      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
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
      const statePaths = resolveAssistantMemoryStoragePaths(context.options.vault)

      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
        removed: redactAssistantMemoryRecord(result.removed),
      }
    },
  })

  assistant.command(memory)

  const cron = Cli.create('cron', {
    description:
      'Manage scheduled assistant prompts stored outside the canonical vault under assistant-state/cron.',
  })

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

  cron.command('add', {
    args: z.object({
      prompt: z.string().min(1).describe('Prompt to send when the assistant cron job fires.'),
    }),
    description: 'Create one assistant cron job backed by the local assistant runtime.',
    hint:
      'Provide exactly one of --at, --every, or --cron. One-shot jobs are deleted after they succeed unless you pass --keepAfterRun.',
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
          deliverResponse: true,
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
      ...assistantDeliveryOptionFields,
    }),
    output: assistantCronAddResultSchema,
    async run(context) {
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
        sessionId: context.options.session,
        alias: context.options.alias,
        channel: context.options.channel,
        identityId: context.options.identity,
        participantId: context.options.participant,
        sourceThreadId: context.options.sourceThread,
        deliverResponse: context.options.deliverResponse,
        deliveryTarget: context.options.deliveryTarget,
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

  const session = Cli.create('session', {
    description:
      'Inspect Healthy Bob assistant session metadata stored outside the canonical vault.',
  })

  session.command('list', {
    args: emptyArgsSchema,
    description: 'List known assistant sessions for one vault.',
    options: withBaseOptions(),
    output: assistantSessionListResultSchema,
    async run(context) {
      const statePaths = resolveAssistantStatePaths(context.options.vault)
      const sessions = await listAssistantSessions(context.options.vault)
      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
        sessions,
      }
    },
  })

  session.command('show', {
    args: z.object({
      sessionId: z.string().min(1).describe('Healthy Bob assistant session id to inspect.'),
    }),
    description: 'Show one assistant session metadata record.',
    options: withBaseOptions(),
    output: assistantSessionShowResultSchema,
    async run(context) {
      const statePaths = resolveAssistantStatePaths(context.options.vault)
      const session = await getAssistantSession(
        context.options.vault,
        context.args.sessionId,
      )
      return {
        vault: redactAssistantDisplayPath(context.options.vault),
        stateRoot: redactAssistantDisplayPath(statePaths.assistantStateRoot),
        session,
      }
    },
  })

  assistant.command(session)
  cli.command(assistant)
  cli.command(
    'chat',
    createAssistantChatCommandDefinition({
      description:
        'Open the same assistant chat UI as `assistant chat` directly from the CLI root.',
      hint:
        'Shorthand for `assistant chat`. Type /exit to close the chat loop or /session to print the current Healthy Bob session id.',
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
}
