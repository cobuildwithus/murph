import { Cli, z } from 'incur'
import {
  assistantApprovalPolicyValues,
  assistantAskResultSchema,
  assistantChatProviderValues,
  assistantChatResultSchema,
  assistantDeliverResultSchema,
  assistantRunResultSchema,
  assistantSandboxValues,
  assistantSessionListResultSchema,
  assistantSessionShowResultSchema,
} from '../assistant-cli-contracts.js'
import { deliverAssistantMessage } from '../assistant-channel.js'
import {
  runAssistantAutomation,
  runAssistantChat,
  sendAssistantMessage,
} from '../assistant-runtime.js'
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
    .describe('Optional channel label such as imessage or telegram.'),
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
    .default('codex-cli')
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
  sandbox: z
    .enum(assistantSandboxValues)
    .default('read-only')
    .describe(
      'Codex sandbox mode for local assistant chat. Defaults to read-only.',
    ),
  approvalPolicy: z
    .enum(assistantApprovalPolicyValues)
    .default('never')
    .describe(
      'Codex approval policy for local assistant chat. Defaults to never in read-only mode.',
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
      'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id.',
    ),
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
      'Healthy Bob persists a local transcript plus per-session metadata under assistant-state/, and still reuses provider-side history when available. Use --deliverResponse to send the assistant reply back out over a mapped channel such as iMessage.',
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
      'Deliver one outbound assistant message without invoking the chat provider. iMessage is supported first and future channels can plug into the same surface.',
    hint:
      'Use --deliveryTarget to override the stored delivery target for one send only. For iMessage that target can be a phone number, email handle, or chat id.',
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
          'Optional one-send outbound target override. For iMessage this can be a phone number, email handle, or chat id.',
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

  assistant.command('run', {
    args: emptyArgsSchema,
    description:
      'Start the local assistant automation loop that watches the inbox runtime and auto-applies model-routed canonical promotions.',
    hint:
      'Use --baseUrl with a local OpenAI-compatible model endpoint such as Ollama; the chat surface can still use a different provider adapter.',
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
    ],
    options: withBaseOptions({
      model: z
        .string()
        .min(1)
        .describe(
          'Model id for inbox triage routing, such as gpt-oss:20b or an AI Gateway model string.',
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
      once: z
        .boolean()
        .optional()
        .describe('Run one assistant scan and then exit.'),
      skipDaemon: z
        .boolean()
        .optional()
        .describe('Do not start the inbox foreground daemon; only run the assistant scan loop.'),
    }),
    output: assistantRunResultSchema,
    async run(context) {
      return runAssistantAutomation({
        inboxServices,
        vaultServices,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        modelSpec: {
          model: context.options.model,
          baseUrl: context.options.baseUrl,
          apiKey: context.options.apiKey,
          apiKeyEnv: context.options.apiKeyEnv,
          providerName: context.options.providerName,
          headers: parseHeadersJsonOption(context.options.headersJson),
        },
        scanIntervalMs: context.options.scanIntervalMs,
        maxPerScan: context.options.maxPerScan,
        once: context.options.once,
        startDaemon: context.options.skipDaemon ? false : true,
        onEvent(event) {
          if (event.type === 'scan.started') {
            console.error(`[assistant] scanning inbox: ${event.details ?? ''}`)
            return
          }

          if (event.type === 'capture.routed') {
            console.error(
              `[assistant] routed ${event.captureId}: ${(event.tools ?? []).join(', ')}`,
            )
            return
          }

          console.error(
            `[assistant] ${event.type.replace(/^capture\./u, '')} ${event.captureId}: ${event.details ?? ''}`,
          )
        },
      })
    },
  })

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
}
