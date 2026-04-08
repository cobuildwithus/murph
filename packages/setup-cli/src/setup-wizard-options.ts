import { listAssistantCronPresets } from '@murphai/assistant-engine/assistant-cron'
import {
  type SetupChannel,
  type SetupWearable,
  setupChannelValues,
  setupWearableValues,
} from '@murphai/operator-config/setup-cli-contracts'

interface SetupWizardChannelOption {
  channel: SetupChannel
  description: string
  title: string
}

interface SetupWizardScheduledUpdateOption {
  description: string
  id: string
  scheduleLabel: string
  title: string
}

interface SetupWizardWearableOption {
  description: string
  title: string
  wearable: SetupWearable
}

export const setupWizardChannelOptions: readonly SetupWizardChannelOption[] = [
  {
    channel: 'imessage',
    description: 'Reply from Messages on this Mac.',
    title: 'iMessage',
  },
  {
    channel: 'telegram',
    description: 'Reply through a Telegram bot.',
    title: 'Telegram',
  },
  {
    channel: 'linq',
    description: 'Reply by SMS, iMessage, or RCS through Linq.',
    title: 'Linq',
  },
  {
    channel: 'email',
    description: 'Read and reply in email.',
    title: 'Email',
  },
]

export const setupWizardScheduledUpdateOptions: readonly SetupWizardScheduledUpdateOption[] =
  listAssistantCronPresets().map((preset) => ({
    id: preset.id,
    title: preset.title,
    description: preset.description,
    scheduleLabel: preset.suggestedScheduleLabel,
  }))

const DEFAULT_SETUP_WIZARD_SCHEDULED_UPDATE_IDS = [
  'weekly-health-snapshot',
  'environment-health-watch',
] as const

export const setupWizardWearableOptions: readonly SetupWizardWearableOption[] = [
  {
    description: 'Sync sleep, daily health metrics, and activities from Garmin Connect.',
    title: 'Garmin',
    wearable: 'garmin',
  },
  {
    description: 'Import sleep, readiness, and recovery from Oura.',
    title: 'Oura',
    wearable: 'oura',
  },
  {
    description: 'Import sleep, strain, and recovery from WHOOP.',
    title: 'WHOOP',
    wearable: 'whoop',
  },
]

export function getDefaultSetupWizardChannels(
  platform: NodeJS.Platform = process.platform,
): SetupChannel[] {
  return platform === 'darwin' ? ['imessage'] : []
}

export function getDefaultSetupWizardWearables(): SetupWearable[] {
  return []
}

export function getDefaultSetupWizardScheduledUpdates(): string[] {
  const available = new Set(
    setupWizardScheduledUpdateOptions.map((option) => option.id),
  )

  return sortSetupWizardScheduledUpdates(
    DEFAULT_SETUP_WIZARD_SCHEDULED_UPDATE_IDS.filter((id) =>
      available.has(id),
    ),
  )
}

export function resolveSetupWizardInitialScheduledUpdates(
  initialScheduledUpdates?: readonly string[],
): string[] {
  return sortSetupWizardScheduledUpdates(
    initialScheduledUpdates === undefined
      ? getDefaultSetupWizardScheduledUpdates()
      : [...initialScheduledUpdates],
  )
}

export function toggleSetupWizardChannel(
  selectedChannels: readonly SetupChannel[],
  channel: SetupChannel,
): SetupChannel[] {
  const next = new Set(selectedChannels)
  if (next.has(channel)) {
    next.delete(channel)
  } else {
    next.add(channel)
  }

  return sortSetupWizardChannels([...next])
}

export function toggleSetupWizardWearable(
  selectedWearables: readonly SetupWearable[],
  wearable: SetupWearable,
): SetupWearable[] {
  const next = new Set(selectedWearables)
  if (next.has(wearable)) {
    next.delete(wearable)
  } else {
    next.add(wearable)
  }

  return sortSetupWizardWearables([...next])
}

export function toggleSetupWizardScheduledUpdate(
  selectedPresetIds: readonly string[],
  presetId: string,
): string[] {
  const next = new Set(selectedPresetIds)
  if (next.has(presetId)) {
    next.delete(presetId)
  } else {
    next.add(presetId)
  }

  return sortSetupWizardScheduledUpdates([...next])
}

export function sortSetupWizardChannels(channels: readonly SetupChannel[]): SetupChannel[] {
  const order = new Map<SetupChannel, number>(
    setupChannelValues.map((channel, index) => [channel, index] as const),
  )
  const unique = [...new Set(channels)]

  return unique.sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )
}

export function sortSetupWizardWearables(
  wearables: readonly SetupWearable[],
): SetupWearable[] {
  const order = new Map<SetupWearable, number>(
    setupWearableValues.map((wearable, index) => [wearable, index] as const),
  )
  const unique = [...new Set(wearables)]

  return unique.sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )
}

export function sortSetupWizardScheduledUpdates(
  presetIds: readonly string[],
): string[] {
  const order = new Map<string, number>(
    setupWizardScheduledUpdateOptions.map((option, index) => [option.id, index] as const),
  )
  const unique = [...new Set(presetIds)]

  return unique.sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )
}

export function formatSetupChannel(channel: SetupChannel): string {
  switch (channel) {
    case 'imessage':
      return 'iMessage'
    case 'telegram':
      return 'Telegram'
    case 'linq':
      return 'Linq'
    case 'email':
      return 'Email'
  }
}

export function formatSetupWearable(wearable: SetupWearable): string {
  switch (wearable) {
    case 'garmin':
      return 'Garmin'
    case 'oura':
      return 'Oura'
    case 'whoop':
      return 'WHOOP'
  }
}

export function formatSetupScheduledUpdate(presetId: string): string {
  return (
    setupWizardScheduledUpdateOptions.find((option) => option.id === presetId)?.title ??
    presetId
  )
}
