import type {
  SetupChannel,
  SetupWearable,
} from '@murphai/operator-config/setup-cli-contracts'
import type { SetupWizardRuntimeStatus } from '@murphai/operator-config/setup-runtime-env'
import {
  formatSetupWizardRuntimeDetail,
  resolveSetupWizardRuntimeTone,
} from './setup-wizard-flow.js'
import type { SetupWizardInlineBadge } from './setup-wizard-ui.js'

const defaultSetupWizardRuntimeStatus: SetupWizardRuntimeStatus = {
  badge: 'optional',
  detail: '',
  missingEnv: [],
  ready: true,
}

export function normalizeSetupWizardRuntimeStatus(
  status: SetupWizardRuntimeStatus | undefined,
): SetupWizardRuntimeStatus {
  return status ?? defaultSetupWizardRuntimeStatus
}

export function resolveSetupWizardChannelStatus(
  statuses: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>> | undefined,
  channel: SetupChannel,
): SetupWizardRuntimeStatus {
  return normalizeSetupWizardRuntimeStatus(statuses?.[channel])
}

export function resolveSetupWizardWearableStatus(
  statuses: Partial<Record<SetupWearable, SetupWizardRuntimeStatus>> | undefined,
  wearable: SetupWearable,
): SetupWizardRuntimeStatus {
  return normalizeSetupWizardRuntimeStatus(statuses?.[wearable])
}

export function buildSetupWizardRuntimeBadges(
  status: SetupWizardRuntimeStatus,
): SetupWizardInlineBadge[] {
  return [
    {
      label: status.badge,
      tone: resolveSetupWizardRuntimeTone(status),
    },
  ]
}

export function describeSetupWizardRuntimeStatus(
  status: SetupWizardRuntimeStatus,
): string {
  return formatSetupWizardRuntimeDetail(status)
}
