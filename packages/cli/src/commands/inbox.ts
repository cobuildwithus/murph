import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  parseHeadersJsonOption,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  inboxAttachmentListResultSchema,
  inboxAttachmentParseResultSchema,
  inboxAttachmentReparseResultSchema,
  inboxAttachmentShowResultSchema,
  inboxAttachmentStatusResultSchema,
  inboxBackfillResultSchema,
  inboxBootstrapResultSchema,
  inboxDaemonStateSchema,
  inboxDoctorResultSchema,
  inboxInitResultSchema,
  inboxListResultSchema,
  inboxParseResultSchema,
  inboxPromoteExperimentNoteResultSchema,
  inboxPromoteMealResultSchema,
  inboxPromoteDocumentResultSchema,
  inboxPromoteJournalResultSchema,
  inboxRequeueResultSchema,
  inboxRunResultSchema,
  inboxSearchResultSchema,
  inboxSetupResultSchema,
  inboxShowResultSchema,
  inboxSourceAddResultSchema,
  inboxSourceListResultSchema,
  inboxSourceRemoveResultSchema,
  inboxSourceValues,
} from '../inbox-cli-contracts.js'
import {
  inboxModelBundleResultSchema,
  inboxModelRouteResultSchema,
} from '../inbox-model-contracts.js'
import {
  materializeInboxModelBundle,
  routeInboxCaptureWithModel,
} from '../inbox-model-harness.js'
import type { InboxServices } from '../inbox-services.js'
import {
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
} from '../run-terminal-logging.js'
import type { VaultServices } from '../vault-services.js'

const inboxInitOptionFields = {
  rebuild: z
    .boolean()
    .optional()
    .describe('Rebuild the runtime index from raw inbox envelope files after initialization.'),
}

const inboxSetupOptionFields = {
  ffmpegCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional explicit ffmpeg command or path to persist.'),
  pdftotextCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional explicit pdftotext command or path to persist.'),
  whisperCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional explicit whisper.cpp command or path to persist.'),
  whisperModelPath: z
    .string()
    .min(1)
    .optional()
    .describe('Optional explicit whisper model path to persist.'),
}

export function registerInboxCommands(
  cli: Cli.Cli,
  services: InboxServices,
  vaultServices?: VaultServices,
) {
  const inbox = Cli.create('inbox', {
    description:
      'Inbox runtime setup, diagnostics, capture review, and daemon operations.',
  })

  const inboxPostInitCta = {
    cta: {
      description: 'Next:',
      commands: [
        {
          command: 'vault-cli inbox source add imessage',
          description: 'Add an iMessage connector.',
          options: {
            id: 'imessage:self',
            account: 'self',
            includeOwn: true,
            vault: true,
          },
        },
        {
          command: 'vault-cli inbox source add telegram',
          description: 'Add a Telegram long-poll connector.',
          options: {
            id: 'telegram:bot',
            account: 'bot',
            vault: true,
          },
        },
        {
          command: 'vault-cli inbox source add linq',
          description: 'Add a Linq webhook connector.',
          options: {
            id: 'linq:default',
            account: 'default',
            vault: true,
          },
        },
        {
          command: 'vault-cli inbox doctor',
          description: 'Verify runtime setup before backfill.',
          args: { sourceId: 'imessage:self' },
          options: { vault: true },
        },
        {
          command: 'vault-cli inbox backfill',
          description: 'Import recent messages into the inbox runtime.',
          options: { source: 'imessage:self', vault: true },
        },
        {
          command: 'vault-cli inbox run',
          description: 'Start the foreground inbox daemon.',
          options: { vault: true },
        },
      ],
    },
  }

  inbox.command('init', {
    args: emptyArgsSchema,
    description:
      'Initialize local inbox runtime state under .runtime without mutating canonical vault records.',
    examples: [
      {
        options: { vault: './vault' },
        description: 'Create the inbox runtime config and SQLite database.',
      },
      {
        options: { vault: './vault', rebuild: true },
        description: 'Rebuild the runtime index from existing raw inbox envelopes.',
      },
    ],
    hint:
      'Run this after `vault-cli init`; it creates only machine-local inbox runtime state.',
    options: withBaseOptions(inboxInitOptionFields),
    output: inboxInitResultSchema,
    async run(context) {
      const result = await services.init({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        rebuild: context.options.rebuild,
      })

      return context.ok(result, inboxPostInitCta)
    },
  })

  inbox.command('bootstrap', {
    args: emptyArgsSchema,
    description:
      'Initialize local inbox runtime state and write parser toolchain config in one step.',
    examples: [
      {
        options: { vault: './vault' },
        description: 'Create local inbox runtime state and parser toolchain config together.',
      },
      {
        options: {
          vault: './vault',
          rebuild: true,
          whisperCommand: '/usr/local/bin/whisper-cli',
          whisperModelPath: './models/ggml-base.en.bin',
        },
        description:
          'Rebuild runtime indexes while persisting explicit whisper.cpp command and model-path overrides.',
      },
    ],
    hint:
      'Use this for local-first inbox/parser bootstrap; it composes `inbox init` and `inbox setup` without mixing their flag sets.',
    options: withBaseOptions({
      ...inboxInitOptionFields,
      ...inboxSetupOptionFields,
      strict: z
        .boolean()
        .optional()
        .describe(
          'Fail if bootstrap doctor finds blocking runtime issues or unavailable explicitly configured parser tools.',
        ),
    }),
    output: inboxBootstrapResultSchema,
    async run(context) {
      const result = await services.bootstrap({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        rebuild: context.options.rebuild,
        ffmpegCommand: context.options.ffmpegCommand,
        pdftotextCommand: context.options.pdftotextCommand,
        whisperCommand: context.options.whisperCommand,
        whisperModelPath: context.options.whisperModelPath,
        strict: context.options.strict,
      })

      return context.ok(result, inboxPostInitCta)
    },
  })

  inbox.command('setup', {
    args: emptyArgsSchema,
    description:
      'Write parser toolchain config under .runtime/parsers and report discovered local tool availability.',
    examples: [
      {
        options: { vault: './vault' },
        description: 'Create or refresh the local parser toolchain config.',
      },
      {
        options: {
          vault: './vault',
          whisperCommand: '/usr/local/bin/whisper-cli',
          whisperModelPath: './models/ggml-base.en.bin',
        },
        description: 'Persist explicit whisper.cpp command and model-path overrides.',
      },
    ],
    hint:
      'This config is local runtime state only; it does not write canonical health records.',
    options: withBaseOptions(inboxSetupOptionFields),
    output: inboxSetupResultSchema,
    async run(context) {
      return services.setup({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        ffmpegCommand: context.options.ffmpegCommand,
        pdftotextCommand: context.options.pdftotextCommand,
        whisperCommand: context.options.whisperCommand,
        whisperModelPath: context.options.whisperModelPath,
      })
    },
  })

  const source = Cli.create('source', {
    description: 'Manage machine-local inbox connector configuration.',
  })

  source.command('add', {
    args: z.object({
      source: z
        .enum(inboxSourceValues)
        .describe('Connector family to add.'),
    }),
    description: 'Add a connector configuration to the local inbox runtime config.',
    examples: [
      {
        args: { source: 'imessage' },
        options: {
          id: 'imessage:self',
          account: 'self',
          includeOwn: true,
          vault: './vault',
        },
        description: 'Configure an iMessage source for the local account.',
      },
      {
        args: { source: 'telegram' },
        options: {
          id: 'telegram:bot',
          account: 'bot',
          vault: './vault',
        },
        description: 'Configure a Telegram bot source for local long polling.',
      },
      {
        args: { source: 'linq' },
        options: {
          id: 'linq:default',
          account: 'default',
          linqWebhookPort: 8789,
          linqWebhookPath: '/linq-webhook',
          enableAutoReply: true,
          vault: './vault',
        },
        description:
          'Configure a Linq webhook connector so the local inbox daemon can receive inbound Linq messages and assistant replies can send back into the same direct chat.',
      },
      {
        args: { source: 'email' },
        options: {
          id: 'email:agentmail',
          provision: true,
          emailDisplayName: 'Murph',
          enableAutoReply: true,
          vault: './vault',
        },
        description:
          'Provision an AgentMail inbox or recover a single existing inbox when create permission is unavailable, then configure email polling and assistant auto-reply.',
      },
    ],
    hint:
      'Use a stable runtime id such as `imessage:self`, `telegram:bot`, `linq:default`, or `email:agentmail`; each connector id must map to a unique source/account runtime namespace, while cursor state stays in SQLite.',
    options: withBaseOptions({
      id: z.string().min(1).describe('Runtime connector id.'),
      account: z
        .string()
        .min(1)
        .optional()
        .describe('Optional account identity for the connector. Defaults to `self` for iMessage, `bot` for Telegram, and should be an AgentMail inbox id for email unless `--provision` is used; for AgentMail this is often the inbox id or inbox email address.'),
      address: z
        .string()
        .min(1)
        .optional()
        .describe('Optional email address to associate with an existing AgentMail inbox connector.'),
      includeOwn: z
        .boolean()
        .optional()
        .describe('Include messages sent by the local account when supported.'),
      backfillLimit: z
        .number()
        .int()
        .positive()
        .max(5000)
        .default(500)
        .describe('Default backfill limit for this connector.'),
      provision: z
        .boolean()
        .optional()
        .describe('Attempt to provision a new AgentMail inbox when adding an email connector. If create permission is unavailable but the API key can access exactly one existing inbox, Murph reuses that inbox automatically.'),
      emailDisplayName: z
        .string()
        .min(1)
        .optional()
        .describe('Optional display name to use when provisioning a new AgentMail inbox.'),
      emailUsername: z
        .string()
        .min(1)
        .optional()
        .describe('Optional mailbox username when provisioning a new AgentMail inbox.'),
      emailDomain: z
        .string()
        .min(1)
        .optional()
        .describe('Optional AgentMail domain when provisioning a new AgentMail inbox.'),
      emailClientId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional AgentMail client id to associate when provisioning a new inbox.'),
      linqWebhookHost: z
        .string()
        .min(1)
        .optional()
        .describe('Optional local bind host for the Linq webhook listener. Defaults to 0.0.0.0.'),
      linqWebhookPath: z
        .string()
        .min(1)
        .optional()
        .describe('Optional local path for the Linq webhook listener. Defaults to /linq-webhook.'),
      linqWebhookPort: z
        .number()
        .int()
        .positive()
        .max(65535)
        .optional()
        .describe('Optional local port for the Linq webhook listener. Defaults to 8789.'),
      enableAutoReply: z
        .boolean()
        .optional()
        .describe('Enable assistant auto-reply for this connector channel after the source is added.'),
    }),
    output: inboxSourceAddResultSchema,
    async run(context) {
      const result = await services.sourceAdd({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        source: context.args.source,
        id: context.options.id,
        account: context.options.account,
        address: context.options.address,
        includeOwn: context.options.includeOwn,
        backfillLimit: context.options.backfillLimit,
        provision: context.options.provision,
        emailDisplayName: context.options.emailDisplayName,
        emailUsername: context.options.emailUsername,
        emailDomain: context.options.emailDomain,
        emailClientId: context.options.emailClientId,
        linqWebhookHost: context.options.linqWebhookHost,
        linqWebhookPath: context.options.linqWebhookPath,
        linqWebhookPort: context.options.linqWebhookPort,
        enableAutoReply: context.options.enableAutoReply,
      })

      const sourceAddCta = {
        cta: {
          description: 'Suggested commands:',
          commands: [
            {
              command: 'vault-cli inbox doctor',
              args: { sourceId: result.connector.id },
              options: { vault: true },
              description: 'Check connector readiness and local dependencies.',
            },
            {
              command: 'vault-cli inbox backfill',
              options: { source: result.connector.id, vault: true },
              description: 'Backfill recent captures for this connector.',
            },
          ],
        },
      }

      return context.ok(result, sourceAddCta)
    },
  })

  source.command('list', {
    args: emptyArgsSchema,
    description: 'List configured inbox connectors from the local runtime config.',
    options: withBaseOptions(),
    output: inboxSourceListResultSchema,
    async run(context) {
      return services.sourceList({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  source.command('remove', {
    args: z.object({
      id: z.string().min(1).describe('Runtime connector id to remove.'),
    }),
    description: 'Remove a connector from the local inbox runtime config.',
    options: withBaseOptions(),
    output: inboxSourceRemoveResultSchema,
    async run(context) {
      return services.sourceRemove({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        connectorId: context.args.id,
      })
    },
  })

  inbox.command(source)

  inbox.command('doctor', {
    args: z.object({
      sourceId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional runtime connector id to inspect deeply.'),
    }),
    description:
      'Verify inbox runtime configuration, local dependencies, and connector readiness.',
    examples: [
      {
        options: { vault: './vault' },
        description: 'Check runtime config and SQLite availability.',
      },
      {
        args: { sourceId: 'imessage:self' },
        options: { vault: './vault' },
        description: 'Run deep iMessage-specific checks for one connector.',
      },
    ],
    options: withBaseOptions(),
    output: inboxDoctorResultSchema,
    async run(context) {
      return services.doctor({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        sourceId: context.args.sourceId,
      })
    },
  })

  inbox.command('parse', {
    args: emptyArgsSchema,
    description:
      'Drain queued attachment parse jobs with the local parser toolchain.',
    options: withBaseOptions({
      captureId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional inbox capture id to scope the drain to one capture.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Optional maximum number of parse jobs to run in this drain.'),
    }),
    output: inboxParseResultSchema,
    async run(context) {
      return services.parse({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.options.captureId,
        limit: context.options.limit,
      })
    },
  })

  inbox.command('requeue', {
    args: emptyArgsSchema,
    description:
      'Reset failed or interrupted attachment parse jobs back to pending.',
    options: withBaseOptions({
      captureId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional inbox capture id to scope the requeue.'),
      attachmentId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional inbox attachment id to scope the requeue.'),
      state: z
        .enum(['failed', 'running'])
        .default('failed')
        .describe('Runtime parse-job state to reset. Defaults to `failed`.'),
    }),
    output: inboxRequeueResultSchema,
    async run(context) {
      return services.requeue({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.options.captureId,
        attachmentId: context.options.attachmentId,
        state: context.options.state,
      })
    },
  })

  inbox.command('backfill', {
    args: emptyArgsSchema,
    description: 'Backfill one configured inbox connector into the runtime and canonical raw inbox store.',
    options: withBaseOptions({
      source: z.string().min(1).describe('Runtime connector id to backfill.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(5000)
        .optional()
        .describe('Optional override backfill limit for this run.'),
      parse: z
        .boolean()
        .optional()
        .describe('Also drain parser jobs for each imported capture during this backfill run.'),
    }),
    output: inboxBackfillResultSchema,
    async run(context) {
      return services.backfill({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        sourceId: context.options.source,
        limit: context.options.limit,
        parse: context.options.parse,
      })
    },
  })

  inbox.command('run', {
    args: emptyArgsSchema,
    description:
      'Run all enabled inbox connectors in the foreground until stopped, auto-draining parser jobs for new captures.',
    hint:
      'Use `vault-cli inbox status` in another shell to inspect daemon state and `vault-cli inbox stop` to send SIGTERM.',
    options: withBaseOptions(),
    output: inboxRunResultSchema,
    async run(context) {
      const terminalLogOptions = resolveForegroundTerminalLogOptions(process.env)

      return services.run(
        {
          vault: context.options.vault,
          requestId: requestIdFromOptions(context.options),
        },
        {
          onEvent(event) {
            const message = formatInboxRunEventForTerminal(
              event,
              terminalLogOptions,
            )
            if (message) {
              console.error(formatForegroundLogLine('inbox', message))
            }
          },
        },
      )
    },
  })

  inbox.command('status', {
    args: emptyArgsSchema,
    description: 'Show the current local inbox daemon state.',
    options: withBaseOptions(),
    output: inboxDaemonStateSchema,
    async run(context) {
      return services.status({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  inbox.command('stop', {
    args: emptyArgsSchema,
    description: 'Stop the currently running inbox daemon by signaling its recorded PID.',
    options: withBaseOptions(),
    output: inboxDaemonStateSchema,
    async run(context) {
      return services.stop({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  inbox.command('list', {
    args: emptyArgsSchema,
    description: 'List captured inbox items from the local runtime index.',
    options: withBaseOptions({
      source: z
        .string()
        .min(1)
        .optional()
        .describe('Optional runtime connector id to filter by.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe('Maximum number of captures to return.'),
    }),
    output: inboxListResultSchema,
    async run(context) {
      return services.list({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        sourceId: context.options.source,
        limit: context.options.limit,
      })
    },
  })

  inbox.command('show', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to show.'),
    }),
    description: 'Show one captured inbox item with normalized metadata and stored attachment references.',
    options: withBaseOptions(),
    output: inboxShowResultSchema,
    async run(context) {
      return services.show({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  inbox.command('search', {
    args: emptyArgsSchema,
    description: 'Search captured inbox items using the local runtime FTS index.',
    options: withBaseOptions({
      text: z.string().min(1).describe('Search text to match.'),
      source: z
        .string()
        .min(1)
        .optional()
        .describe('Optional runtime connector id to filter by.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(20)
        .describe('Maximum number of hits to return.'),
    }),
    output: inboxSearchResultSchema,
    async run(context) {
      return services.search({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        text: context.options.text,
        sourceId: context.options.source,
        limit: context.options.limit,
      })
    },
  })

  const attachment = Cli.create('attachment', {
    description: 'Inspect stored inbox attachments and their runtime parse state.',
  })

  attachment.command('list', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to inspect.'),
    }),
    description: 'List stored attachments for one inbox capture.',
    options: withBaseOptions(),
    output: inboxAttachmentListResultSchema,
    async run(context) {
      return services.listAttachments({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  attachment.command('show', {
    args: z.object({
      attachmentId: z.string().min(1).describe('Inbox attachment id to inspect.'),
    }),
    description: 'Show one stored inbox attachment by its runtime attachment id.',
    options: withBaseOptions(),
    output: inboxAttachmentShowResultSchema,
    async run(context) {
      return services.showAttachment({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        attachmentId: context.args.attachmentId,
      })
    },
  })

  attachment.command('show-status', {
    args: z.object({
      attachmentId: z.string().min(1).describe('Inbox attachment id to inspect.'),
    }),
    description: 'Show the current runtime parse status for one inbox attachment.',
    options: withBaseOptions(),
    output: inboxAttachmentStatusResultSchema,
    async run(context) {
      return services.showAttachmentStatus({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        attachmentId: context.args.attachmentId,
      })
    },
  })

  attachment.command('parse', {
    args: z.object({
      attachmentId: z.string().min(1).describe('Inbox attachment id to parse now.'),
    }),
    description: 'Drain the current parse queue entry for one parseable inbox attachment.',
    options: withBaseOptions(),
    output: inboxAttachmentParseResultSchema,
    async run(context) {
      return services.parseAttachment({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        attachmentId: context.args.attachmentId,
      })
    },
  })

  attachment.command('reparse', {
    args: z.object({
      attachmentId: z.string().min(1).describe('Inbox attachment id to requeue.'),
    }),
    description: 'Requeue the current runtime parse job for one parseable inbox attachment.',
    options: withBaseOptions(),
    output: inboxAttachmentReparseResultSchema,
    async run(context) {
      return services.reparseAttachment({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        attachmentId: context.args.attachmentId,
      })
    },
  })

  inbox.command(attachment)

  const promote = Cli.create('promote', {
    description: 'Promote captured inbox items into canonical Murph records.',
  })

  promote.command('meal', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to promote.'),
    }),
    description:
      'Promote one inbox capture with an image attachment into a canonical meal event.',
    hint:
      'The first stored image attachment becomes the meal photo; the first stored audio attachment becomes the optional audio note.',
    options: withBaseOptions(),
    output: inboxPromoteMealResultSchema,
    async run(context) {
      return services.promoteMeal({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  promote.command('document', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to promote.'),
    }),
    description:
      'Promote one inbox capture with a stored document attachment into a canonical document import.',
    options: withBaseOptions(),
    output: inboxPromoteDocumentResultSchema,
    async run(context) {
      return services.promoteDocument({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  promote.command('journal', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to promote.'),
    }),
    description:
      'Promote one inbox capture into the journal day for its occurred-at date using a stable, idempotent note block.',
    options: withBaseOptions(),
    output: inboxPromoteJournalResultSchema,
    async run(context) {
      return services.promoteJournal({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  promote.command('experiment-note', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to promote.'),
    }),
    description:
      'Promote one inbox capture into a single unambiguous experiment page using an idempotent markdown note block.',
    options: withBaseOptions(),
    output: inboxPromoteExperimentNoteResultSchema,
    async run(context) {
      return services.promoteExperimentNote({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  inbox.command(promote)

  const model = Cli.create('model', {
    description:
      'Build a normalized inbox bundle, attach supported routing images when available, and ask a Vercel AI SDK-backed model to choose canonical CLI actions.',
  })

  model.command('bundle', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to bundle.'),
    }),
    description:
      'Materialize the normalized routing bundle for one inbox capture, including multimodal image-routing eligibility metadata.',
    options: withBaseOptions(),
    output: inboxModelBundleResultSchema,
    async run(context) {
      return materializeInboxModelBundle({
        inboxServices: services,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
        vault: context.options.vault,
        vaultServices,
      })
    },
  })

  model.command('route', {
    args: z.object({
      captureId: z.string().min(1).describe('Inbox capture id to route.'),
    }),
    description:
      'Use the shared assistant model harness to generate a CLI action plan for one inbox capture.',
    hint:
      'Pass --baseUrl to target a local or other OpenAI-compatible endpoint; omit it to use the AI Gateway model string.',
    options: withBaseOptions({
      model: z
        .string()
        .min(1)
        .describe('Model id to use, such as anthropic/claude-sonnet-4.5 or a local model id.'),
      baseUrl: z
        .string()
        .min(1)
        .optional()
        .describe('Optional OpenAI-compatible base URL for local or custom model endpoints.'),
      apiKey: z
        .string()
        .min(1)
        .optional()
        .describe('Optional explicit API key for OpenAI-compatible model endpoints.'),
      apiKeyEnv: z
        .string()
        .min(1)
        .optional()
        .describe('Optional environment variable name that stores the API key.'),
      providerName: z
        .string()
        .min(1)
        .optional()
        .describe('Optional stable provider label for OpenAI-compatible endpoints.'),
      headersJson: z
        .string()
        .min(1)
        .optional()
        .describe('Optional JSON object of extra HTTP headers for OpenAI-compatible endpoints.'),
      apply: z
        .boolean()
        .optional()
        .describe('Execute the planned tool calls instead of previewing them.'),
    }),
    output: inboxModelRouteResultSchema,
    async run(context) {
      return routeInboxCaptureWithModel({
        inboxServices: services,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
        vault: context.options.vault,
        vaultServices,
        apply: context.options.apply,
        modelSpec: {
          model: context.options.model,
          baseUrl: context.options.baseUrl,
          apiKey: context.options.apiKey,
          apiKeyEnv: context.options.apiKeyEnv,
          providerName: context.options.providerName,
          headers: parseHeadersJsonOption(context.options.headersJson),
        },
      })
    },
  })

  inbox.command(model)

  cli.command(inbox)
}
