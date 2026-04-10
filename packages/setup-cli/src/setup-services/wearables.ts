import {
  setWearablePreferences,
} from '@murphai/vault-usecases'
import {
  type SetupStepResult,
  type SetupWearable,
  setupWearableValues,
} from '@murphai/operator-config/setup-cli-contracts'
import { createStep } from './steps.js'

export interface ConfigureSetupWearablesInput {
  dryRun: boolean
  steps: SetupStepResult[]
  vault: string
  wearables: readonly SetupWearable[]
}

export function normalizeSetupWearables(
  wearables: readonly SetupWearable[] | null | undefined,
): SetupWearable[] {
  const order = new Map<SetupWearable, number>(
    setupWearableValues.map((wearable, index) => [wearable, index] as const),
  )

  return [...new Set(wearables ?? [])].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )
}

export async function configureSetupWearables(
  input: ConfigureSetupWearablesInput,
): Promise<SetupWearable[]> {
  const wearables = normalizeSetupWearables(input.wearables)

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: formatWearablePreferencesDetail(wearables, 'would-save'),
        id: 'wearable-preferences',
        kind: 'configure',
        status: 'skipped',
        title: 'Wearable preferences',
      }),
    )
    return wearables
  }

  const result = await setWearablePreferences({
    vault: input.vault,
    desiredProviders: wearables,
  })

  input.steps.push(
    createStep({
      detail: formatWearablePreferencesDetail(
        wearables,
        result.updated ? 'saved' : 'unchanged',
      ),
      id: 'wearable-preferences',
      kind: 'configure',
      status: result.updated ? 'completed' : 'reused',
      title: 'Wearable preferences',
    }),
  )

  return wearables
}

function formatWearablePreferencesDetail(
  wearables: readonly SetupWearable[],
  mode: 'saved' | 'unchanged' | 'would-save',
): string {
  const selection =
    wearables.length === 0
      ? 'no wearable providers selected'
      : wearables.map(formatSetupWearable).join(', ')
  const prefix =
    mode === 'saved'
      ? 'Saved canonical wearable preferences'
      : mode === 'unchanged'
        ? 'Canonical wearable preferences already matched'
        : 'Would save canonical wearable preferences'

  return `${prefix} in bank/preferences.json with ${selection}.`
}

function formatSetupWearable(wearable: SetupWearable): string {
  switch (wearable) {
    case 'garmin':
      return 'Garmin'
    case 'oura':
      return 'Oura'
    case 'whoop':
      return 'WHOOP'
  }
}
