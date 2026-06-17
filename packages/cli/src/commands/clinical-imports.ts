import { Cli, z } from 'incur'
import {
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
  TEST_RESULT_STATUSES,
  eventSourceSchema,
} from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  occurredAtOptionSchema,
  pathSchema,
  timeZoneSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  assertionImportPayloadSchema,
  assertionSavePayloadSchema,
  clinicalNoteImportPayloadSchema,
  diagnosticTestImportPayloadSchema,
  diagnosticTestSavePayloadSchema,
  importAssertionRecord,
  importClinicalNoteRecord,
  importDiagnosticTestRecord,
  importSocialHistoryRecord,
  importVitalsRecord,
  inputFileOptionSchema,
  normalizeInputFileOption,
  saveAssertionPayload,
  saveDiagnosticTestPayload,
  saveVitalsPayload,
  scaffoldAssertionImportPayload,
  scaffoldClinicalNoteImportPayload,
  scaffoldDiagnosticTestImportPayload,
  scaffoldSocialHistoryImportPayload,
  scaffoldVitalsImportPayload,
  socialHistoryImportPayloadSchema,
  vitalsImportPayloadSchema,
  vitalsSavePayloadSchema,
} from '@murphai/vault-usecases'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeOccurredAtOption } from './occurred-at-option.js'
import {
  registerPayloadSchemaCommand,
} from './payload-schema-command.js'

export const clinicalImportResultSchema = z.object({
  vault: pathSchema,
  eventIds: z.array(z.string().min(1)),
  lookupId: z.string().min(1).optional(),
  ledgerFiles: z.array(pathSchema),
  created: z.boolean().optional(),
  auditPaths: z.array(pathSchema),
})

export const assertionScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('assertion'),
  payload: assertionImportPayloadSchema,
})

export const vitalsScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('vitals'),
  payload: vitalsImportPayloadSchema,
})

export const diagnosticTestScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('diagnostic-test'),
  payload: diagnosticTestImportPayloadSchema,
})

export const clinicalNoteScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('clinical-note'),
  payload: clinicalNoteImportPayloadSchema,
})

export const socialHistoryScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('social-history'),
  payload: socialHistoryImportPayloadSchema,
})

const commonImportOptions = {
  input: inputFileOptionSchema.describe('Structured JSON payload in @file.json form or - for stdin.'),
}

const commonSaveOptions = {
  occurredAt: occurredAtOptionSchema
    .optional()
    .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form. Defaults to now.'),
  source: eventSourceSchema
    .optional()
    .describe('Optional event source.'),
  title: z.string().min(1).max(160).optional(),
  note: z.string().min(1).max(4000).optional(),
  timeZone: timeZoneSchema.optional(),
}

function dateFromTimestamp(value: string): string {
  return value.slice(0, 10)
}

async function normalizeSaveOccurredAtOption(input: {
  vault: string
  occurredAt?: string
  timeZone?: string
}): Promise<string> {
  return (await normalizeOccurredAtOption(input)) ?? new Date().toISOString()
}

function metricEntry(metric: string, value: number | undefined, unit: string) {
  return value === undefined ? [] : [{ metric, value, unit }]
}

function requireAtLeastOneMeasurement(measurements: Array<{ metric: string; value: number; unit: string }>) {
  if (measurements.length === 0) {
    throw new VaultCliError(
      'invalid_option',
      'vitals save requires at least one vital sign option.',
    )
  }

  return measurements
}

export function registerAssertionCommands(cli: Cli.Cli) {
  const assertion = Cli.create('assertion', {
    description: 'Clinical assertion commands for explicit negative, denied, or normal statements.',
  })

  assertion.command('scaffold', {
    description: 'Emit a representative assertion import payload.',
    args: z.object({}),
    options: withBaseOptions(),
    output: assertionScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'assertion' as const,
        payload: scaffoldAssertionImportPayload(),
      }
    },
  })

  assertion.command('save', {
    description: 'Save one explicit negative, denied, or normal clinical assertion.',
    args: z.object({}),
    options: withBaseOptions({
      ...commonSaveOptions,
      assertion: z.enum(CLINICAL_ASSERTION_TYPES),
      domain: z.enum(CLINICAL_ASSERTION_DOMAINS).optional(),
      polarity: z.enum(CLINICAL_ASSERTION_POLARITIES).optional(),
      subject: z.string().min(1).max(240).optional(),
      assertionText: z.string().min(1).max(1000).optional(),
      assertedOn: z.string().min(1).optional(),
      sourceLabel: z.string().min(1).max(240).optional(),
    }),
    output: clinicalImportResultSchema,
    async run({ options }) {
      const occurredAt = await normalizeSaveOccurredAtOption({
        vault: options.vault,
        occurredAt: typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        timeZone: options.timeZone,
      })
      return saveAssertionPayload({
        vault: options.vault,
        payload: assertionSavePayloadSchema.parse({
          occurredAt,
          timeZone: options.timeZone,
          source: options.source ?? 'manual',
          title: options.title ?? 'Clinical assertion',
          note: options.note,
          assertion: options.assertion,
          domain: options.domain,
          polarity: options.polarity,
          subject: options.subject,
          assertionText: options.assertionText,
          assertedOn: options.assertedOn ?? dateFromTimestamp(occurredAt),
          sourceLabel: options.sourceLabel,
        }),
      })
    },
  })

  assertion.command('import-json', {
    description: 'Import one clinical assertion from a JSON payload file or stdin.',
    args: z.object({}),
    hint: 'Run assertion payload-schema for the writable contract and assertion scaffold for a representative example.',
    options: withBaseOptions(commonImportOptions),
    output: clinicalImportResultSchema,
    run({ options }) {
      return importAssertionRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  registerPayloadSchemaCommand(assertion, {
    command: 'assertion import-json',
    schemaName: 'assertion-import-payload',
    schema: assertionImportPayloadSchema,
    examples: [scaffoldAssertionImportPayload()],
  })

  cli.command(assertion)
}

export function registerVitalsCommands(cli: Cli.Cli) {
  const vitals = Cli.create('vitals', {
    description: 'Vitals facade over canonical measurement events.',
  })

  vitals.command('scaffold', {
    description: 'Emit a representative vitals import payload.',
    args: z.object({}),
    options: withBaseOptions(),
    output: vitalsScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'vitals' as const,
        payload: scaffoldVitalsImportPayload(),
      }
    },
  })

  vitals.command('save', {
    description: 'Save one grouped vitals measurement event from typed options.',
    args: z.object({}),
    options: withBaseOptions({
      ...commonSaveOptions,
      systolic: z.coerce.number().optional(),
      diastolic: z.coerce.number().optional(),
      heartRate: z.coerce.number().optional(),
      respiratoryRate: z.coerce.number().optional(),
      temperatureF: z.coerce.number().optional(),
      temperatureC: z.coerce.number().optional(),
      spo2: z.coerce.number().optional(),
      weightLb: z.coerce.number().optional(),
      heightIn: z.coerce.number().optional(),
    }),
    output: clinicalImportResultSchema,
    async run({ options }) {
      const occurredAt = await normalizeSaveOccurredAtOption({
        vault: options.vault,
        occurredAt: typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        timeZone: options.timeZone,
      })
      const measurements = requireAtLeastOneMeasurement([
        ...metricEntry('systolic-blood-pressure', options.systolic, 'mmHg'),
        ...metricEntry('diastolic-blood-pressure', options.diastolic, 'mmHg'),
        ...metricEntry('heart-rate', options.heartRate, 'bpm'),
        ...metricEntry('respiratory-rate', options.respiratoryRate, 'breaths/min'),
        ...metricEntry('body-temperature', options.temperatureF, 'degF'),
        ...metricEntry('body-temperature', options.temperatureC, 'degC'),
        ...metricEntry('spo2', options.spo2, 'percent'),
        ...metricEntry('weight', options.weightLb, 'lb'),
        ...metricEntry('height', options.heightIn, 'in'),
      ])
      return saveVitalsPayload({
        vault: options.vault,
        payload: vitalsSavePayloadSchema.parse({
          occurredAt,
          timeZone: options.timeZone,
          source: options.source ?? 'manual',
          title: options.title ?? 'Vitals',
          note: options.note,
          measurements,
        }),
      })
    },
  })

  vitals.command('import-json', {
    description: 'Import one grouped vitals measurement event from a JSON payload file or stdin.',
    args: z.object({}),
    hint: 'Run vitals payload-schema for the writable contract and vitals scaffold for a representative example.',
    options: withBaseOptions(commonImportOptions),
    output: clinicalImportResultSchema,
    run({ options }) {
      return importVitalsRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  registerPayloadSchemaCommand(vitals, {
    command: 'vitals import-json',
    schemaName: 'vitals-import-payload',
    schema: vitalsImportPayloadSchema,
    examples: [scaffoldVitalsImportPayload()],
  })

  cli.command(vitals)
}

export function registerDiagnosticTestCommands(cli: Cli.Cli) {
  const diagnosticTest = Cli.create('diagnostic-test', {
    description: 'Generic diagnostic test facade over canonical test events.',
  })

  diagnosticTest.command('scaffold', {
    description: 'Emit a representative diagnostic-test import payload.',
    args: z.object({}),
    options: withBaseOptions(),
    output: diagnosticTestScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'diagnostic-test' as const,
        payload: scaffoldDiagnosticTestImportPayload(),
      }
    },
  })

  diagnosticTest.command('save', {
    description: 'Save one generic diagnostic test event from typed options.',
    args: z.object({
      testName: z.string().min(1).max(160),
    }),
    options: withBaseOptions({
      ...commonSaveOptions,
      resultStatus: z.enum(TEST_RESULT_STATUSES).optional(),
      summary: z.string().min(1).max(1000).optional(),
      testCategory: z.string().min(1).max(64).optional(),
      specimenType: z.string().min(1).max(64).optional(),
      labName: z.string().min(1).max(160).optional(),
      reportedAt: z.string().min(1).optional(),
    }),
    output: clinicalImportResultSchema,
    async run({ args, options }) {
      const occurredAt = await normalizeSaveOccurredAtOption({
        vault: options.vault,
        occurredAt: typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        timeZone: options.timeZone,
      })
      return saveDiagnosticTestPayload({
        vault: options.vault,
        payload: diagnosticTestSavePayloadSchema.parse({
          occurredAt,
          timeZone: options.timeZone,
          source: options.source ?? 'manual',
          title: options.title,
          note: options.note,
          testName: args.testName,
          resultStatus: options.resultStatus,
          summary: options.summary,
          testCategory: options.testCategory,
          specimenType: options.specimenType,
          labName: options.labName,
          reportedAt: options.reportedAt,
        }),
      })
    },
  })

  diagnosticTest.command('import-json', {
    description: 'Import one generic diagnostic test event from a JSON payload file or stdin.',
    args: z.object({}),
    hint: 'Run diagnostic-test payload-schema for the writable contract and diagnostic-test scaffold for a representative example.',
    options: withBaseOptions(commonImportOptions),
    output: clinicalImportResultSchema,
    run({ options }) {
      return importDiagnosticTestRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  registerPayloadSchemaCommand(diagnosticTest, {
    command: 'diagnostic-test import-json',
    schemaName: 'diagnostic-test-import-payload',
    schema: diagnosticTestImportPayloadSchema,
    examples: [scaffoldDiagnosticTestImportPayload()],
  })

  cli.command(diagnosticTest)
}

export function registerClinicalNoteCommands(cli: Cli.Cli) {
  const clinicalNote = Cli.create('clinical-note', {
    description: 'Structured clinical note facade over canonical note events.',
  })

  clinicalNote.command('scaffold', {
    description: 'Emit a representative clinical-note import payload.',
    args: z.object({}),
    options: withBaseOptions(),
    output: clinicalNoteScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'clinical-note' as const,
        payload: scaffoldClinicalNoteImportPayload(),
      }
    },
  })

  clinicalNote.command('import-json', {
    description: 'Import one structured clinical note from a JSON payload file or stdin.',
    args: z.object({}),
    hint: 'Run clinical-note payload-schema for the writable contract and clinical-note scaffold for a representative example.',
    options: withBaseOptions(commonImportOptions),
    output: clinicalImportResultSchema,
    run({ options }) {
      return importClinicalNoteRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  registerPayloadSchemaCommand(clinicalNote, {
    command: 'clinical-note import-json',
    schemaName: 'clinical-note-import-payload',
    schema: clinicalNoteImportPayloadSchema,
    examples: [scaffoldClinicalNoteImportPayload()],
  })

  cli.command(clinicalNote)
}

export function registerSocialHistoryCommands(cli: Cli.Cli) {
  const socialHistory = Cli.create('social-history', {
    description: 'Social history import facade that writes canonical exposure, assertion, or note events.',
  })

  socialHistory.command('scaffold', {
    description: 'Emit a representative social-history import payload.',
    args: z.object({}),
    options: withBaseOptions(),
    output: socialHistoryScaffoldResultSchema,
    run({ options }) {
      return {
        vault: options.vault,
        noun: 'social-history' as const,
        payload: scaffoldSocialHistoryImportPayload(),
      }
    },
  })

  socialHistory.command('import-json', {
    description: 'Import social-history entries from a JSON payload file or stdin.',
    args: z.object({}),
    hint: 'Run social-history payload-schema for the writable contract and social-history scaffold for a representative example.',
    options: withBaseOptions(commonImportOptions),
    output: clinicalImportResultSchema,
    run({ options }) {
      return importSocialHistoryRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  registerPayloadSchemaCommand(socialHistory, {
    command: 'social-history import-json',
    schemaName: 'social-history-import-payload',
    schema: socialHistoryImportPayloadSchema,
    examples: [scaffoldSocialHistoryImportPayload()],
  })

  cli.command(socialHistory)
}
