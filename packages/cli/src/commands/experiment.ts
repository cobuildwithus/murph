import {
  EXPERIMENT_STATUSES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
  experimentOutcomeSchema,
  experimentProgressSnapshotSchema,
} from '@murphai/contracts'
import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import {
  experimentCreateResultSchema,
  isoTimestampSchema,
  listEntitySchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import { normalizeRepeatableFlagOption } from '@murphai/vault-usecases'
import { commonListLimitOptionSchema } from './command-factory-primitives.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
const experimentSignalDirectionSchema = z.enum(['increase', 'decrease', 'stabilize'])
const experimentCheckInCadenceSchema = z.enum(['none', 'daily', 'every_3_days', 'weekly'])
const experimentNotificationStyleSchema = z.enum([
  'skip_by_default',
  'send_scheduled_summary',
])
const experimentSafetyCautionLevelSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
)
const experimentSafetyDispositionSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
)
const experimentMissedLogFollowupSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
)
const sha256RevisionOptionSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/u,
    'Expected sha256: followed by 64 lowercase hexadecimal characters.',
  )
  .describe('Content revision id in sha256:<64 lowercase hex> form.')
const experimentLookupArgSchema = z.object({
  id: z.string().min(1).describe('Experiment id or slug to resolve.'),
})

const repeatableTextOptionSchema = (description: string) =>
  z.array(z.string().min(1)).optional().describe(description)

function normalizeSetupAnswerOptions(value: readonly string[] | undefined) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  return entries.length > 0 ? entries : undefined
}

const experimentListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: experimentStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listEntitySchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

const experimentUpdateResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  experimentPath: pathSchema,
  status: experimentStatusSchema,
  updated: z.boolean(),
})

const experimentLifecycleResultSchema = experimentUpdateResultSchema.extend({
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
})

const experimentSessionLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.literal('intervention_session'),
})

const experimentContextLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.enum(['note', 'supplement_intake', 'experiment_context']),
})

const experimentProgressResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  progress: experimentProgressSnapshotSchema,
})

const experimentOutcomeResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  outcome: experimentOutcomeSchema,
  outcomePath: pathSchema.nullable().optional(),
  updatedExperiment: z.boolean().optional(),
})

export function registerExperimentCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const experiment = Cli.create('experiment', {
    description: 'Experiment bank commands routed through the core write and query APIs.',
  })

  experiment.command('create', {
    description: 'Create a baseline experiment document.',
    args: z.object({
      slug: slugSchema,
    }),
    options: withBaseOptions({
      title: z.string().min(1).optional().describe('Optional human-readable title.'),
      hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
      startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
      status: experimentStatusSchema.optional().describe('Optional experiment status.'),
    }),
    output: experimentCreateResultSchema,
    async run({ args, options }) {
      return services.core.createExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        slug: String(args.slug ?? ''),
        title: typeof options.title === 'string' ? options.title : undefined,
        hypothesis: typeof options.hypothesis === 'string' ? options.hypothesis : undefined,
        startedOn: typeof options.startedOn === 'string' ? options.startedOn : undefined,
        status: typeof options.status === 'string' ? options.status : undefined,
      })
    },
  })

  experiment.command('show', {
    description: 'Show one experiment by canonical id or slug.',
    args: experimentLookupArgSchema,
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return services.query.showExperiment({
        lookup: args.id,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  experiment.command('list', {
    description: 'List experiments through the query read model.',
    args: z.object({}),
    options: withBaseOptions({
      limit: commonListLimitOptionSchema,
      status: experimentStatusSchema.optional().describe('Optional experiment status filter.'),
    }),
    output: experimentListResultSchema,
    async run({ options }) {
      return services.query.listExperiments({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        limit: options.limit,
      })
    },
  })

  experiment.command('update', {
    description: 'Update simple scalar experiment fields by id or slug.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      title: z.string().min(1).optional().describe('Optional human-readable title.'),
      hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
      startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
      status: experimentStatusSchema.optional().describe('Optional experiment status.'),
      body: z.string().min(1).optional().describe('Optional replacement markdown body.'),
      tag: z
        .array(slugSchema)
        .optional()
        .describe('Optional tags to store on the experiment. Repeat --tag for multiple values.'),
    }),
    output: experimentUpdateResultSchema,
    async run({ args, options }) {
      return services.core.updateExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        title: options.title,
        hypothesis: options.hypothesis,
        startedOn: options.startedOn,
        status: options.status,
        body: options.body,
        tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
      })
    },
  })

  experiment.command('apply-onboarding', {
    description:
      'Apply schema-discoverable protocol onboarding fields to an existing experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      status: experimentStatusSchema
        .optional()
        .describe('Optional lifecycle status to set on the experiment.'),
      protocolKey: z
        .string()
        .min(1)
        .optional()
        .describe('Health Commons protocol variant key to store under protocolRef.key.'),
      pageRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Protocol page content revision id in sha256:<64 lowercase hex> form.'),
      runSpecRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Protocol run spec revision id in sha256:<64 lowercase hex> form.'),
      testPlanId: z
        .string()
        .min(1)
        .optional()
        .describe('Chosen Health Commons test plan id for this run.'),
      baselineStart: localDateSchema
        .optional()
        .describe('Canonical baseline window start date.'),
      baselineEnd: localDateSchema.optional().describe('Canonical baseline window end date.'),
      baselineDays: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Baseline length in days; requires baseline-start, baseline-end, or intervention-start.',
        ),
      interventionStart: localDateSchema
        .optional()
        .describe('Canonical intervention window start date.'),
      interventionEnd: localDateSchema
        .optional()
        .describe('Canonical intervention window end date.'),
      interventionDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Intervention length in days; requires intervention-start, intervention-end, or a baseline window.',
        ),
      modality: z.string().min(1).optional().describe('Intervention modality label.'),
      schedule: z
        .string()
        .min(1)
        .optional()
        .describe('Plain-language schedule string for the run plan.'),
      dose: z
        .string()
        .min(1)
        .optional()
        .describe('Plain-language dose string for the run plan.'),
      sessionsPerWeek: z
        .number()
        .nonnegative()
        .optional()
        .describe('Planned sessions per week for adherence calculations.'),
      targetSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Target session count across the intervention window.'),
      minimumUsefulSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Minimum useful session count for interpreting the run.'),
      sessionField: repeatableTextOptionSchema(
        'Logging session field ids. Repeat --session-field for multiple values.',
      ),
      confounderField: repeatableTextOptionSchema(
        'Logging confounder field ids. Repeat --confounder-field for multiple values.',
      ),
      stopCondition: repeatableTextOptionSchema(
        'Stop condition text. Repeat --stop-condition for multiple values.',
      ),
      primaryBiomarkerKey: z
        .string()
        .min(1)
        .optional()
        .describe('Primary Health Commons biomarker key for the analysis plan.'),
      secondaryBiomarkerKey: repeatableTextOptionSchema(
        'Secondary Health Commons biomarker keys. Repeat --secondary-biomarker-key for multiple values.',
      ),
      desiredDirection: experimentSignalDirectionSchema
        .optional()
        .describe('Expected direction for the primary biomarker.'),
      analysisNote: repeatableTextOptionSchema(
        'Analysis plan note. Repeat --analysis-note for multiple values.',
      ),
      onboardingCompletedAt: isoTimestampSchema
        .optional()
        .describe('Timestamp when the protocol onboarding capture completed.'),
      setupAnswer: repeatableTextOptionSchema(
        'Setup answer as key=value. Repeat --setup-answer for multiple setup slots.',
      ),
      safetyCautionLevel: experimentSafetyCautionLevelSchema
        .optional()
        .describe('Onboarding safety caution level.'),
      safetyDisposition: experimentSafetyDispositionSchema
        .optional()
        .describe('Onboarding safety disposition.'),
      positiveQuestionId: repeatableTextOptionSchema(
        'Positive safety question ids. Repeat --positive-question-id for multiple values.',
      ),
      safetyNote: repeatableTextOptionSchema(
        'Safety note. Repeat --safety-note for multiple values.',
      ),
      contextNote: repeatableTextOptionSchema(
        'Context note from onboarding. Repeat --context-note for multiple values.',
      ),
      reminderPolicy: z
        .string()
        .min(1)
        .optional()
        .describe('Reminder policy id selected during onboarding.'),
      reminderOptionId: z
        .string()
        .min(1)
        .optional()
        .describe('Reminder option id selected during onboarding.'),
      remindersEnabled: z
        .boolean()
        .optional()
        .describe('Whether assistant reminders are enabled for the run.'),
      checkInCadence: experimentCheckInCadenceSchema
        .optional()
        .describe('Assistant check-in cadence for the run.'),
      notificationStyle: experimentNotificationStyleSchema
        .optional()
        .describe('Assistant notification style for the run.'),
      missedLogFollowup: experimentMissedLogFollowupSchema
        .optional()
        .describe('Assistant follow-up policy for missed logs.'),
      weeklyDigestEnabled: z
        .boolean()
        .optional()
        .describe('Whether weekly assistant digests are enabled for the run.'),
    }),
    output: experimentUpdateResultSchema,
    async run({ args, options }) {
      return services.core.applyExperimentOnboarding({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        status: options.status,
        protocolKey: options.protocolKey,
        pageRevisionId: options.pageRevisionId,
        runSpecRevisionId: options.runSpecRevisionId,
        testPlanId: options.testPlanId,
        baselineStart: options.baselineStart,
        baselineEnd: options.baselineEnd,
        baselineDays: options.baselineDays,
        interventionStart: options.interventionStart,
        interventionEnd: options.interventionEnd,
        interventionDays: options.interventionDays,
        modality: options.modality,
        schedule: options.schedule,
        dose: options.dose,
        sessionsPerWeek: options.sessionsPerWeek,
        targetSessions: options.targetSessions,
        minimumUsefulSessions: options.minimumUsefulSessions,
        sessionField: normalizeRepeatableFlagOption(
          options.sessionField,
          'session-field',
        ),
        confounderField: normalizeRepeatableFlagOption(
          options.confounderField,
          'confounder-field',
        ),
        stopCondition: normalizeRepeatableFlagOption(
          options.stopCondition,
          'stop-condition',
        ),
        primaryBiomarkerKey: options.primaryBiomarkerKey,
        secondaryBiomarkerKey: normalizeRepeatableFlagOption(
          options.secondaryBiomarkerKey,
          'secondary-biomarker-key',
        ),
        desiredDirection: options.desiredDirection,
        analysisNote: normalizeRepeatableFlagOption(
          options.analysisNote,
          'analysis-note',
        ),
        onboardingCompletedAt: options.onboardingCompletedAt,
        setupAnswer: normalizeSetupAnswerOptions(options.setupAnswer),
        safetyCautionLevel: options.safetyCautionLevel,
        safetyDisposition: options.safetyDisposition,
        positiveQuestionId: normalizeRepeatableFlagOption(
          options.positiveQuestionId,
          'positive-question-id',
        ),
        safetyNote: normalizeRepeatableFlagOption(options.safetyNote, 'safety-note'),
        contextNote: normalizeRepeatableFlagOption(options.contextNote, 'context-note'),
        reminderPolicy: options.reminderPolicy,
        reminderOptionId: options.reminderOptionId,
        remindersEnabled: options.remindersEnabled,
        checkInCadence: options.checkInCadence,
        notificationStyle: options.notificationStyle,
        missedLogFollowup: options.missedLogFollowup,
        weeklyDigestEnabled: options.weeklyDigestEnabled,
      })
    },
  })

  experiment.command('checkpoint', {
    description: 'Append one experiment checkpoint event from a JSON payload file or stdin.',
    args: z.object({}),
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentLifecycleResultSchema,
    async run({ options }) {
      return services.core.checkpointExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  experiment.command('stop', {
    description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional stop timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      note: z.string().min(1).optional().describe('Optional stop note.'),
    }),
    output: experimentLifecycleResultSchema,
    async run({ args, options }) {
      return services.core.stopExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        note: typeof options.note === 'string' ? options.note : undefined,
      })
    },
  })

  experiment.command('progress', {
    description: 'Read the deterministic progress summary for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentProgressResultSchema,
    async run({ args, options }) {
      return services.query.showExperimentProgress({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  const session = Cli.create('session', {
    description: 'Experiment session logging commands.',
  })

  session.command('log', {
    description: 'Log one structured intervention session for an experiment from a JSON payload file or stdin.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentSessionLogResultSchema,
    async run({ args, options }) {
      return services.core.logExperimentSession({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  const context = Cli.create('context', {
    description: 'Experiment context and confounder logging commands.',
  })

  context.command('log', {
    description: 'Log one experiment-linked context record from a JSON payload file or stdin.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentContextLogResultSchema,
    async run({ args, options }) {
      return services.core.logExperimentContext({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  const outcome = Cli.create('outcome', {
    description: 'Experiment outcome analysis commands.',
  })

  outcome.command('analyze', {
    description: 'Run the deterministic final analysis for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.query.analyzeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  outcome.command('write', {
    description: 'Run the deterministic final analysis for one experiment and persist the outcome record.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.core.writeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  experiment.command(session)
  experiment.command(context)
  experiment.command(outcome)

  cli.command(experiment)
}
