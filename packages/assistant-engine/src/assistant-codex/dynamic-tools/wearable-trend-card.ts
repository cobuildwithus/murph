import {
  savedHealthViewIdSchema,
  wearableTrendResponseCardV1Schema,
  type WearableTrendCardRequestV1,
  type WearableTrendResponseCardV1,
} from '@murphai/contracts'
import { isVaultError, readSavedHealthView } from '@murphai/core'
import { summarizeWearableSevenDaySnapshotRuntime } from '@murphai/query'

export type TrustedWearableTrendCardResolution =
  | {
      card: WearableTrendResponseCardV1
      ok: true
    }
  | {
      ok: false
      reason: 'saved_view_not_found' | 'unavailable'
    }

export async function resolveTrustedWearableTrendCard(input: {
  request: WearableTrendCardRequestV1
  vaultRoot: string | null
}): Promise<TrustedWearableTrendCardResolution> {
  if (!input.vaultRoot) {
    return { ok: false, reason: 'unavailable' }
  }

  let metricKeys = 'metricKeys' in input.request
    ? input.request.metricKeys
    : null

  if ('savedViewId' in input.request) {
    const savedViewId = savedHealthViewIdSchema.safeParse(
      input.request.savedViewId,
    )
    if (!savedViewId.success) {
      return { ok: false, reason: 'saved_view_not_found' }
    }
    try {
      const savedView = await readSavedHealthView({
        lookup: savedViewId.data,
        vaultRoot: input.vaultRoot,
      })
      if (savedView.savedViewId !== savedViewId.data) {
        return { ok: false, reason: 'saved_view_not_found' }
      }
      metricKeys = savedView.metricKeys
    } catch (error) {
      if (
        isVaultError(error)
        && error.code === 'SAVED_HEALTH_VIEW_NOT_FOUND'
      ) {
        return { ok: false, reason: 'saved_view_not_found' }
      }
      return { ok: false, reason: 'unavailable' }
    }
  }

  if (!metricKeys) {
    return { ok: false, reason: 'unavailable' }
  }

  try {
    const snapshot = await summarizeWearableSevenDaySnapshotRuntime(
      input.vaultRoot,
      { metricKeys },
    )
    const parsed = wearableTrendResponseCardV1Schema.safeParse({
      kind: 'wearable_trend',
      localDates: snapshot.days,
      metrics: snapshot.metrics.map((metric) => ({
        metricKey: metric.metricKey,
        trend: metric.trend.direction,
        values: metric.values,
      })),
      version: 1,
    })
    return parsed.success
      ? { card: parsed.data, ok: true }
      : { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
