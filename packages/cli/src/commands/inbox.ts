import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  inboxAttachmentListResultSchema,
  inboxAttachmentReparseResultSchema,
  inboxAttachmentShowResultSchema,
  inboxAttachmentStatusResultSchema,
  inboxBackfillResultSchema,
  inboxDaemonStateSchema,
  inboxDoctorResultSchema,
  inboxInitResultSchema,
  inboxListResultSchema,
  inboxParseResultSchema,
  inboxPromoteMealResultSchema,
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
import type { InboxCliServices } from '../inbox-services.js'

export function registerInboxCommands(
  cli: Cli.Cli,
  services: InboxCliServices,
) {
  const inbox = Cli.create('inbox', {
    description:
      'Inbox runtime setup, diagnostics, capture review, and daemon operations.',
  })

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
    options: withBaseOptions({
      rebuild: z
        .boolean()
        .optional()
        .describe('Rebuild the runtime index from raw inbox envelope files after initialization.'),
    }),
    output: inboxInitResultSchema,
    async run(context) {
      const result = await services.init({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        rebuild: context.options.rebuild,
      })

      return context.ok(result, {
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
      })
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
    options: withBaseOptions({
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
      paddleocrCommand: z
        .string()
        .min(1)
        .optional()
        .describe('Optional explicit PaddleOCR command or path to persist.'),
    }),
    output: inboxSetupResultSchema,
    async run(context) {
      return services.setup({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        ffmpegCommand: context.options.ffmpegCommand,
        pdftotextCommand: context.options.pdftotextCommand,
        whisperCommand: context.options.whisperCommand,
        whisperModelPath: context.options.whisperModelPath,
        paddleocrCommand: context.options.paddleocrCommand,
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
    ],
    hint:
      'Use a stable runtime id such as `imessage:self`; each connector id must map to a unique source/account runtime namespace, while cursor state stays in SQLite.',
    options: withBaseOptions({
      id: z.string().min(1).describe('Runtime connector id.'),
      account: z
        .string()
        .min(1)
        .optional()
        .describe('Optional account identity for the connector. Defaults to `self` for iMessage.'),
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
    }),
    output: inboxSourceAddResultSchema,
    async run(context) {
      const result = await services.sourceAdd({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        source: context.args.source,
        id: context.options.id,
        account: context.options.account,
        includeOwn: context.options.includeOwn,
        backfillLimit: context.options.backfillLimit,
      })

      return context.ok(result, {
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
      })
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
    }),
    output: inboxBackfillResultSchema,
    async run(context) {
      return services.backfill({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        sourceId: context.options.source,
        limit: context.options.limit,
      })
    },
  })

  inbox.command('run', {
    args: emptyArgsSchema,
    description: 'Run all enabled inbox connectors in the foreground until stopped.',
    hint:
      'Use `vault-cli inbox status` in another shell to inspect daemon state and `vault-cli inbox stop` to send SIGTERM.',
    options: withBaseOptions(),
    output: inboxRunResultSchema,
    async run(context) {
      return services.run({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
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
    description: 'Show one captured inbox item with raw metadata and stored attachment references.',
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
    description: 'Promote captured inbox items into canonical Healthy Bob records.',
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
      'Reserved placeholder for future experiment-note promotion. The current runtime does not expose a deterministic experiment target-selection rule.',
    options: withBaseOptions(),
    async run(context) {
      return services.promoteExperimentNote({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        captureId: context.args.captureId,
      })
    },
  })

  inbox.command(promote)

  cli.command(inbox)
}
