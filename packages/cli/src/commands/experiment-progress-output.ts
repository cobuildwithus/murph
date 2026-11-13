import {
  effectiveProtocolSnapshotSchema,
  experimentMetricPeriodSummarySchema,
  experimentMetricResultSchema,
  experimentProgressMetricSignalSchema,
  experimentProgressSnapshotSchema,
} from '@murphai/contracts'
import { z } from 'incur'
import {
  localDateSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

type ExperimentProgressServiceResult = Awaited<
  ReturnType<VaultServices['query']['showExperimentProgress']>
>
type ExperimentProgressSignal =
  ExperimentProgressServiceResult['progress']['signals'][number]

// The assistant reads `experiment progress` directly, so each id, mean, and unit
// appears once: the top level names the experiment and date (its lookup id is
// the experiment id), each signal keeps one baseline and one intervention
// period, and the early-signal copy of every signal contributes only its
// confidence.
const experimentProgressPeriodSchema = experimentMetricPeriodSummarySchema.partial({
  totalDays: true,
  unit: true,
})

const experimentProgressSignalSchema = experimentMetricResultSchema
  .omit({
    baselineDayCount: true,
    baselineMean: true,
    interventionDayCount: true,
    interventionMean: true,
  })
  .extend({
    baseline: experimentProgressPeriodSchema,
    intervention: experimentProgressPeriodSchema,
    confidence: experimentProgressMetricSignalSchema.shape.confidence.optional(),
  })

export const experimentProgressResultSchema = z.object({
  experimentId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  progress: experimentProgressSnapshotSchema
    .omit({
      asOf: true,
      earlySignals: true,
      experiment: true,
      schema: true,
      signals: true,
    })
    .extend({
      experiment: experimentProgressSnapshotSchema.shape.experiment.pick({
        status: true,
        title: true,
      }),
      effectiveProtocolSnapshot: effectiveProtocolSnapshotSchema.nullable().optional(),
      signals: z.array(experimentProgressSignalSchema),
    }),
})

export function toPublicExperimentProgress(
  result: ExperimentProgressServiceResult,
): z.infer<typeof experimentProgressResultSchema> {
  const {
    asOf,
    earlySignals,
    experiment,
    schema,
    signals,
    ...progress
  } = result.progress
  void asOf
  void schema
  const confidenceByKey = new Map(
    (earlySignals ?? []).map((signal) => [signal.biomarkerKey, signal.confidence]),
  )

  return {
    experimentId: result.experimentId,
    slug: result.slug,
    asOf: result.asOf,
    progress: {
      ...progress,
      experiment: { status: experiment.status, title: experiment.title },
      signals: signals.map((signal) =>
        toPublicSignal(signal, confidenceByKey.get(signal.biomarkerKey)),
      ),
    },
  }
}

function toPublicSignal(
  signal: ExperimentProgressSignal,
  confidence: z.infer<typeof experimentProgressMetricSignalSchema>['confidence'] | undefined,
): z.infer<typeof experimentProgressSignalSchema> {
  const {
    baseline,
    baselineDayCount,
    baselineMean,
    intervention,
    interventionDayCount,
    interventionMean,
    ...rest
  } = signal
  return {
    ...rest,
    baseline: toPublicPeriod(
      baseline ?? { daysWithData: baselineDayCount, mean: baselineMean },
      signal.unit,
    ),
    intervention: toPublicPeriod(
      intervention ?? { daysWithData: interventionDayCount, mean: interventionMean },
      signal.unit,
    ),
    ...(confidence === undefined ? {} : { confidence }),
  }
}

// A period unit differs from the signal unit only when the windows disagree.
function toPublicPeriod(
  period: z.infer<typeof experimentProgressPeriodSchema>,
  signalUnit: string | null,
): z.infer<typeof experimentProgressPeriodSchema> {
  const { unit, ...rest } = period
  return unit === undefined || unit === signalUnit ? rest : period
}
