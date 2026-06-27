import { Cli, z } from 'incur'
import { eventSourceSchema } from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  captureAddResultSchema,
  listResultSchema,
  occurredAtOptionSchema,
  pathSchema,
  showResultSchema,
  timeZoneSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
  normalizeRepeatableFlagOption,
} from '@murphai/vault-usecases'
import {
  addCaptureRecord,
  captureImportManifestResultSchema,
  captureLookupSchema,
  listCaptureRecords,
  showCaptureManifest,
  showCaptureRecord,
} from '@murphai/vault-usecases/captures'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
  createCommonListCommand,
  registerFactoryCommand,
} from './command-factory-primitives.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

export const captureCommandDescriptions = {
  root: 'Dated media-capture commands for photos, videos, and other lightweight evidence with simple tags and context.',
  add: 'Record one or more dated media captures as canonical events with immutable raw/captures/** attachments.',
  importJson:
    'Import one or more dated media captures from a structured JSON payload file or stdin.',
  addHint:
    "Use --media for one capture with one or more files. For multiple distinct captures, run capture add per observation grouped through vault-cli batch --command '[...]'.",
  importJsonHint:
    "Operator-only; no capture payload-schema. For agent batches, use repeated capture add through vault-cli batch --command '[...]'.",
  show: 'Show one capture by canonical event id or stable label.',
  list: 'List capture events with optional date, label, body-site, collection, and tag filters.',
  manifest: 'Show the immutable raw import manifest for one capture event id or stable label.',
} as const

function stringArrayOption(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    return undefined
  }

  return value
}

export function registerCaptureCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const capture = Cli.create('capture', {
    description: captureCommandDescriptions.root,
  })

  const captureAddOptionShape = {
    media: z
      .array(pathSchema)
      .optional()
      .describe('Media file paths for one capture. Repeat --media for multiple views of the same observation.'),
    label: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional stable label. Friendly text is normalized to kebab-case and used as a continuity tag.'),
    bodySite: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe('Optional freeform body/site/location context. This is saved in the note and as a site-* tag.'),
    collection: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional collection slug, such as skin-check-2026-04 or dermatology-baseline.'),
    tag: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional capture tag. Repeat --tag for multiple entries.'),
    relatedId: z
      .array(z.string().min(1).max(160))
      .optional()
      .describe('Optional related record id. Repeat --related-id to link multiple records.'),
    note: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('Optional capture note.'),
    title: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional capture title override.'),
    occurredAt: occurredAtOptionSchema
      .optional()
      .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
    source: eventSourceSchema
      .optional()
      .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
    timeZone: timeZoneSchema
      .optional()
      .describe('Optional IANA time zone for the capture timestamp, such as America/Los_Angeles.'),
  }

  async function runCaptureAdd(options: Record<string, unknown> & { vault: string }, inputFile?: string) {
    return addCaptureRecord({
      vault: options.vault,
      inputFile,
      mediaPaths: Array.isArray(options.media)
        ? options.media.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
      label: typeof options.label === 'string' ? options.label : undefined,
      bodySite: typeof options.bodySite === 'string' ? options.bodySite : undefined,
      collection: typeof options.collection === 'string' ? options.collection : undefined,
      tags: normalizeRepeatableFlagOption(stringArrayOption(options.tag), 'tag'),
      relatedIds: normalizeRepeatableFlagOption(
        stringArrayOption(options.relatedId),
        'related-id',
      ),
      note: typeof options.note === 'string' ? options.note : undefined,
      title: typeof options.title === 'string' ? options.title : undefined,
      occurredAt: await normalizeOccurredAtOption({
        vault: options.vault,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
      }),
      source: eventSourceSchema.safeParse(options.source).data,
      timeZone: typeof options.timeZone === 'string' ? options.timeZone : undefined,
    })
  }

  capture.command('add', {
    description: captureCommandDescriptions.add,
    args: z.object({}),
    examples: [
      {
        description: 'Record one labeled mole photo.',
        args: {},
        options: {
          vault: './vault',
          media: ['./left-forearm-1.jpg'],
          label: 'mole-left-forearm-1',
          bodySite: 'Left forearm, dorsal side, about 8cm below elbow',
          tag: ['mole', 'dermatology'],
        },
      },
      {
        description: 'Record one capture with local media and typed metadata.',
        args: {},
        options: {
          vault: './vault',
          media: ['./left-forearm-2.jpg'],
          label: 'mole-left-forearm-2',
        },
      },
    ],
    hint: captureCommandDescriptions.addHint,
    options: withBaseOptions(captureAddOptionShape),
    output: captureAddResultSchema,
    async run({ options }) {
      return runCaptureAdd(options)
    },
  })

  capture.command('import-json', {
    description: captureCommandDescriptions.importJson,
    args: z.object({}),
    examples: [
      {
        description: 'Record a batch of separate captures from a structured JSON file.',
        args: {},
        options: {
          vault: './vault',
          input: '@captures.json',
        },
      },
    ],
    hint: captureCommandDescriptions.importJsonHint,
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('Structured capture payload in @file.json form or - for stdin.'),
      ...captureAddOptionShape,
    }),
    output: captureAddResultSchema,
    async run({ options }) {
      return runCaptureAdd(options, normalizeInputFileOption(options.input))
    },
  })

  capture.command('show', {
    description: captureCommandDescriptions.show,
    args: z.object({
      id: captureLookupSchema,
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showCaptureRecord(options.vault, args.id)
    },
  })

  registerFactoryCommand(
    capture,
    createCommonListCommand({
      description: captureCommandDescriptions.list,
      options: {
        from: {
          description: commonDateRangeOptionDescriptions.from,
          name: 'from',
        },
        to: {
          description: commonDateRangeOptionDescriptions.to,
          name: 'to',
        },
        tag: z
          .array(z.string().min(1))
          .optional()
          .describe('Optional tag filter. Repeat --tag for multiple tags; all requested tags must match.'),
        limit: commonListLimitOptionSchema,
      },
      extraOptions: {
        label: z
          .string()
          .min(1)
          .max(160)
          .optional()
          .describe('Optional stable capture label filter.'),
        bodySite: z
          .string()
          .min(1)
          .max(400)
          .optional()
          .describe('Optional body/site filter, matched through the normalized site-* tag.'),
        collection: z
          .string()
          .min(1)
          .max(160)
          .optional()
          .describe('Optional collection filter.'),
      },
      output: listResultSchema,
      buildInput(input, options) {
        return {
          ...input,
          label: typeof options.label === 'string' ? options.label : undefined,
          bodySite:
            typeof options.bodySite === 'string'
              ? options.bodySite
              : undefined,
          collection:
            typeof options.collection === 'string'
              ? options.collection
              : undefined,
          tag: Array.isArray(options.tag)
            ? options.tag.filter((entry): entry is string => typeof entry === 'string')
            : undefined,
        }
      },
      run(input) {
        return listCaptureRecords({
          vault: input.vault,
          from: input.from,
          to: input.to,
          label: input.label,
          bodySite: input.bodySite,
          collection: input.collection,
          tags: normalizeRepeatableFlagOption(input.tag, 'tag'),
          limit: input.limit,
        })
      },
    }),
  )

  capture.command('manifest', {
    description: captureCommandDescriptions.manifest,
    args: z.object({
      id: captureLookupSchema,
    }),
    options: withBaseOptions(),
    output: captureImportManifestResultSchema,
    async run({ args, options }) {
      return showCaptureManifest(options.vault, args.id)
    },
  })

  cli.command(capture)
}
