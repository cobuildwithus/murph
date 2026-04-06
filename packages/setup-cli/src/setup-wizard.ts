import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import {
  listNamedOpenAICompatibleProviderPresets,
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromId,
  type OpenAICompatibleProviderPreset,
} from '@murphai/assistant-core/assistant-provider'
import { listAssistantCronPresets } from '@murphai/assistant-core/assistant-cron'
import {
  DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
  getDefaultSetupAssistantPreset as getDefaultAssistantPreset,
} from './setup-assistant.js'
import {
  type SetupAssistantPreset,
  type SetupAssistantProviderPreset,
  type SetupChannel,
  type SetupWearable,
  setupChannelValues,
  setupWearableValues,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  SETUP_RUNTIME_ENV_NOTICE,
  type SetupWizardRuntimeStatus,
} from '@murphai/operator-config/setup-runtime-env'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface SetupWizardResult {
  assistantApiKeyEnv?: string | null
  assistantBaseUrl?: string | null
  assistantOss?: boolean | null
  assistantPreset?: SetupAssistantPreset
  assistantProviderName?: string | null
  channels: SetupChannel[]
  scheduledUpdates: string[]
  wearables: SetupWearable[]
}

export interface SetupWizardInput {
  channelStatuses?: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
  commandName?: string
  deviceSyncLocalBaseUrl?: string | null
  initialAssistantApiKeyEnv?: string | null
  initialAssistantBaseUrl?: string | null
  initialAssistantOss?: boolean | null
  initialAssistantPreset?: SetupAssistantPreset
  initialAssistantProviderPreset?: SetupAssistantProviderPreset | null
  initialAssistantProviderName?: string | null
  initialChannels?: readonly SetupChannel[]
  initialScheduledUpdates?: readonly string[]
  initialWearables?: readonly SetupWearable[]
  linqLocalWebhookUrl?: string | null
  platform?: NodeJS.Platform
  publicBaseUrl?: string | null
  vault: string
  wearableStatuses?: Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
}

export interface SetupWizardCompletionController {
  completeExit(): void
  fail(error: unknown): void
  submit(result: SetupWizardResult): void
  waitForResult(): Promise<SetupWizardResult>
}

export type SetupWizardAssistantProvider = SetupAssistantProviderPreset | 'skip'

export type SetupWizardAssistantMethod =
  | 'openai-codex'
  | 'openai-api-key'
  | 'compatible-provider'
  | 'compatible-endpoint'
  | 'compatible-codex-local'
  | 'skip'

interface SetupWizardAssistantProviderOption {
  description: string
  provider: SetupWizardAssistantProvider
  title: string
}

interface SetupWizardAssistantMethodOption {
  badges?: readonly SetupWizardInlineBadge[]
  description: string
  detail?: string
  method: SetupWizardAssistantMethod
  title: string
}

export interface SetupWizardResolvedAssistantSelection {
  apiKeyEnv: string | null
  baseUrl: string | null
  detail: string
  methodLabel: string | null
  oss: boolean | null
  preset: SetupAssistantPreset
  providerLabel: string
  providerName: string | null
  summary: string
}

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

export type SetupPublicUrlStrategy = 'hosted' | 'tunnel'

export interface SetupWizardPublicUrlTarget {
  detail: string
  label: string
  url: string
}

export interface SetupWizardPublicUrlReview {
  enabled: boolean
  recommendedStrategy: SetupPublicUrlStrategy
  summary: string
  targets: SetupWizardPublicUrlTarget[]
}

type SetupWizardStep =
  | 'intro'
  | 'assistant-provider'
  | 'assistant-method'
  | 'scheduled-updates'
  | 'channels'
  | 'wearables'
  | 'public-url'
  | 'confirm'

type SetupWizardFlowStep = Exclude<SetupWizardStep, 'intro'>
type SetupWizardSelectionStep = Extract<
  SetupWizardFlowStep,
  'assistant-provider' | 'assistant-method' | 'scheduled-updates' | 'channels' | 'wearables'
>
type SetupWizardTone = 'accent' | 'success' | 'warn' | 'danger' | 'muted'

interface SetupWizardInlineBadge {
  label: string
  tone: SetupWizardTone
}

interface SetupWizardHint {
  label: string
  tone: SetupWizardTone
}

interface SetupWizardSelectionLine {
  active: boolean
  badges: readonly SetupWizardInlineBadge[]
  description: string
  detail?: string
  key: string
  selected: boolean
  title: string
}

const DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL = 'http://localhost:8788'
const DEFAULT_SETUP_LINQ_WEBHOOK_URL = 'http://127.0.0.1:8789/linq-webhook'
const DEFAULT_SETUP_OPENAI_API_BASE_URL = 'https://api.openai.com/v1'

const setupWizardAssistantProviderOptions: readonly SetupWizardAssistantProviderOption[] = [
  ...listNamedOpenAICompatibleProviderPresets().map((preset) => ({
    provider: preset.id,
    title: preset.title,
    description: buildSetupWizardAssistantProviderDescription(preset),
  })),
  {
    provider: 'custom',
    title: 'Custom endpoint',
    description: 'Use any other OpenAI-style endpoint, or keep the Codex local-model path.',
  },
  {
    provider: 'skip',
    title: 'Skip for now',
    description: 'Leave the current assistant settings alone.',
  },
]

const setupWizardOpenAIAssistantMethodOptions: readonly SetupWizardAssistantMethodOption[] = [
  {
    method: 'openai-codex',
    title: 'ChatGPT / Codex sign-in',
    description: 'Best if you already use the Codex sign-in flow.',
    detail: 'Murph will use your saved Codex / ChatGPT login and ask which default model to use next.',
    badges: [{ label: 'recommended', tone: 'success' }],
  },
  {
    method: 'openai-api-key',
    title: 'OpenAI API key',
    description: 'Use OPENAI_API_KEY and choose a model.',
    detail: 'Good if you want direct API billing instead of the Codex sign-in path.',
  },
]

const setupWizardCompatibleAssistantMethodOptions: readonly SetupWizardAssistantMethodOption[] = [
  {
    method: 'compatible-endpoint',
    title: 'Compatible endpoint',
    description: 'Use any OpenAI-style endpoint and enter the details during setup.',
    detail: 'Murph will ask for the endpoint URL and then let you choose a model.',
    badges: [{ label: 'manual', tone: 'accent' }],
  },
  {
    method: 'compatible-codex-local',
    title: 'Codex local model',
    description: 'Keep the Codex flow, but point it at a local OSS model.',
    detail: 'Good if you want the Codex tooling path with a local model by default.',
  },
]

const setupWizardChannelOptions: readonly SetupWizardChannelOption[] = [
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

const setupWizardScheduledUpdateOptions: readonly SetupWizardScheduledUpdateOption[] =
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

const setupWizardWearableOptions: readonly SetupWizardWearableOption[] = [
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

export function getDefaultSetupWizardAssistantPreset(): SetupAssistantPreset {
  return getDefaultAssistantPreset()
}

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

export function wrapSetupWizardIndex(
  currentIndex: number,
  length: number,
  delta: number,
): number {
  if (length <= 0) {
    return 0
  }

  return (currentIndex + delta + length) % length
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

export function createSetupWizardCompletionController(): SetupWizardCompletionController {
  let settled = false
  let exited = false
  let submittedResult: SetupWizardResult | null = null
  let resolvePromise!: (value: SetupWizardResult) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<SetupWizardResult>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const maybeResolve = () => {
    if (settled || !exited || submittedResult === null) {
      return
    }

    settled = true
    resolvePromise(submittedResult)
  }

  return {
    completeExit() {
      if (settled) {
        return
      }

      exited = true
      if (submittedResult === null) {
        settled = true
        rejectPromise(new Error('Murph setup wizard exited unexpectedly.'))
        return
      }

      maybeResolve()
    },

    fail(error) {
      if (settled) {
        return
      }

      settled = true
      rejectPromise(error)
    },

    submit(result) {
      if (settled || submittedResult !== null) {
        return
      }

      submittedResult = result
      maybeResolve()
    },

    async waitForResult() {
      return await promise
    },
  }
}

export async function runSetupWizard(
  input: SetupWizardInput,
): Promise<SetupWizardResult> {
  const initialAssistantPreset =
    input.initialAssistantPreset ?? getDefaultSetupWizardAssistantPreset()
  const initialChannels = sortSetupWizardChannels(
    input.initialChannels && input.initialChannels.length > 0
      ? [...input.initialChannels]
      : getDefaultSetupWizardChannels(input.platform),
  )
  const initialScheduledUpdates = resolveSetupWizardInitialScheduledUpdates(
    input.initialScheduledUpdates,
  )
  const initialWearables = sortSetupWizardWearables(
    input.initialWearables && input.initialWearables.length > 0
      ? [...input.initialWearables]
      : getDefaultSetupWizardWearables(),
  )
  const commandName = input.commandName ?? 'murph'
  const completion = createSetupWizardCompletionController()
  const defaultScheduledUpdateIds = new Set(getDefaultSetupWizardScheduledUpdates())

  let instance:
    | {
        unmount: () => void
        waitUntilExit: () => Promise<unknown>
      }
    | null = null

  const App = (): React.ReactElement => {
    const createElement = React.createElement
    const { exit } = useApp()
    const initialAssistantProvider = inferSetupWizardAssistantProvider({
      apiKeyEnv: input.initialAssistantApiKeyEnv,
      baseUrl: input.initialAssistantBaseUrl,
      oss: input.initialAssistantOss,
      preset: initialAssistantPreset,
      providerName: input.initialAssistantProviderName,
      providerPreset: input.initialAssistantProviderPreset,
    })
    const initialAssistantMethod = inferSetupWizardAssistantMethod({
      oss: input.initialAssistantOss,
      preset: initialAssistantPreset,
      provider: initialAssistantProvider,
    })
    const [step, setStep] = React.useState<SetupWizardStep>('intro')
    const [assistantProviderIndex, setAssistantProviderIndex] = React.useState(
      findSetupWizardAssistantProviderIndex(initialAssistantProvider),
    )
    const [assistantMethodIndex, setAssistantMethodIndex] = React.useState(
      findSetupWizardAssistantMethodIndex(
        initialAssistantProvider,
        initialAssistantMethod,
      ),
    )
    const [scheduledUpdateIndex, setScheduledUpdateIndex] = React.useState(0)
    const [channelIndex, setChannelIndex] = React.useState(0)
    const [wearableIndex, setWearableIndex] = React.useState(0)
    const [selectedAssistantProvider, setSelectedAssistantProvider] =
      React.useState<SetupWizardAssistantProvider>(initialAssistantProvider)
    const [selectedAssistantMethod, setSelectedAssistantMethod] = React.useState<
      SetupWizardAssistantMethod
    >(initialAssistantMethod)
    const [selectedChannels, setSelectedChannels] = React.useState<SetupChannel[]>(
      initialChannels,
    )
    const [selectedScheduledUpdates, setSelectedScheduledUpdates] =
      React.useState<string[]>(initialScheduledUpdates)
    const [selectedWearables, setSelectedWearables] = React.useState<SetupWearable[]>(
      initialWearables,
    )
    const assistantSelection = resolveSetupWizardAssistantSelection({
      initialApiKeyEnv: input.initialAssistantApiKeyEnv,
      initialBaseUrl: input.initialAssistantBaseUrl,
      initialProvider: initialAssistantProvider,
      initialProviderName: input.initialAssistantProviderName,
      method: selectedAssistantMethod,
      provider: selectedAssistantProvider,
    })
    const latestAssistantRef = React.useRef<SetupWizardResolvedAssistantSelection>(
      assistantSelection,
    )
    const latestChannelsRef = React.useRef<SetupChannel[]>(initialChannels)
    const latestScheduledUpdatesRef = React.useRef<string[]>(initialScheduledUpdates)
    const latestWearablesRef = React.useRef<SetupWearable[]>(initialWearables)
    const publicUrlReview = buildSetupWizardPublicUrlReview({
      channels: selectedChannels,
      wearables: selectedWearables,
      publicBaseUrl: input.publicBaseUrl,
      deviceSyncLocalBaseUrl: input.deviceSyncLocalBaseUrl,
      linqLocalWebhookUrl: input.linqLocalWebhookUrl,
    })
    const includePublicUrlStep = publicUrlReview.enabled
    const includeAssistantMethodStep = doesSetupWizardAssistantProviderRequireMethod(
      selectedAssistantProvider,
    )
    const publicUrlGuidance = publicUrlReview.enabled
      ? describeSetupWizardPublicUrlStrategyChoice({
          review: publicUrlReview,
          strategy: publicUrlReview.recommendedStrategy,
        })
      : null

    React.useEffect(() => {
      latestAssistantRef.current = assistantSelection
    }, [assistantSelection])

    React.useEffect(() => {
      latestChannelsRef.current = selectedChannels
    }, [selectedChannels])

    React.useEffect(() => {
      latestScheduledUpdatesRef.current = selectedScheduledUpdates
    }, [selectedScheduledUpdates])

    React.useEffect(() => {
      latestWearablesRef.current = selectedWearables
    }, [selectedWearables])

    React.useEffect(() => {
      setAssistantMethodIndex(
        findSetupWizardAssistantMethodIndex(
          selectedAssistantProvider,
          selectedAssistantMethod,
        ),
      )
    }, [selectedAssistantMethod, selectedAssistantProvider])

    type SetupWizardSelectionConfig = {
      lines: SetupWizardSelectionLine[]
      marker: 'checkbox' | 'radio'
      nextStep: SetupWizardStep
      previousStep: SetupWizardStep
      selectCurrentOnEnter: boolean
      setIndex: React.Dispatch<React.SetStateAction<number>>
      step: SetupWizardSelectionStep
      stepIntro?: string
      toggleCurrent: () => void
    }

    const assistantMethodOptions = listSetupWizardAssistantMethodOptions(
      selectedAssistantProvider,
    )
    const selectionSteps: Record<
      SetupWizardSelectionStep,
      SetupWizardSelectionConfig
    > = {
      'assistant-provider': {
        lines: setupWizardAssistantProviderOptions.map((option, index) => ({
          active: index === assistantProviderIndex,
          badges: buildSetupWizardAssistantProviderBadges({
            currentProvider: initialAssistantProvider,
            provider: option.provider,
          }),
          description: option.description,
          key: option.provider,
          selected: option.provider === selectedAssistantProvider,
          title: option.title,
        })),
        marker: 'radio',
        nextStep: includeAssistantMethodStep
          ? 'assistant-method'
          : 'scheduled-updates',
        previousStep: 'intro',
        selectCurrentOnEnter: true,
        setIndex: setAssistantProviderIndex,
        step: 'assistant-provider',
        stepIntro: formatSetupWizardStepIntro(
          'assistant-provider',
          selectedAssistantProvider,
        ),
        toggleCurrent: () => {
          const activeProvider =
            setupWizardAssistantProviderOptions[assistantProviderIndex]?.provider
          if (!activeProvider) {
            return
          }

          const nextMethod = resolveSetupWizardAssistantMethodForProvider({
            currentMethod: selectedAssistantMethod,
            provider: activeProvider,
          })
          setSelectedAssistantProvider(activeProvider)
          setSelectedAssistantMethod(nextMethod)
          setAssistantMethodIndex(
            findSetupWizardAssistantMethodIndex(activeProvider, nextMethod),
          )
        },
      },
      'assistant-method': {
        lines: assistantMethodOptions.map((option, index) => ({
          active: index === assistantMethodIndex,
          badges: buildSetupWizardAssistantMethodBadges({
            currentMethod: initialAssistantMethod,
            method: option.method,
            optionBadges: option.badges,
          }),
          description: option.description,
          detail: option.detail,
          key: option.method,
          selected: option.method === selectedAssistantMethod,
          title: option.title,
        })),
        marker: 'radio',
        nextStep: 'scheduled-updates',
        previousStep: 'assistant-provider',
        selectCurrentOnEnter: true,
        setIndex: setAssistantMethodIndex,
        step: 'assistant-method',
        stepIntro: formatSetupWizardStepIntro(
          'assistant-method',
          selectedAssistantProvider,
        ),
        toggleCurrent: () => {
          const activeMethod = assistantMethodOptions[assistantMethodIndex]?.method
          if (activeMethod) {
            setSelectedAssistantMethod(activeMethod)
          }
        },
      },
      'scheduled-updates': {
        lines: setupWizardScheduledUpdateOptions.map((option, index) => ({
          active: index === scheduledUpdateIndex,
          badges: buildSetupWizardScheduledUpdateBadges({
            isStarter: defaultScheduledUpdateIds.has(option.id),
          }),
          description: option.description,
          detail: `Suggested cadence: ${option.scheduleLabel}.`,
          key: option.id,
          selected: selectedScheduledUpdates.includes(option.id),
          title: option.title,
        })),
        marker: 'checkbox',
        nextStep: 'channels',
        previousStep: includeAssistantMethodStep
          ? 'assistant-method'
          : 'assistant-provider',
        selectCurrentOnEnter: false,
        setIndex: setScheduledUpdateIndex,
        step: 'scheduled-updates',
        stepIntro: formatSetupWizardStepIntro(
          'scheduled-updates',
          selectedAssistantProvider,
        ),
        toggleCurrent: () => {
          const activePresetId =
            setupWizardScheduledUpdateOptions[scheduledUpdateIndex]?.id
          if (activePresetId) {
            setSelectedScheduledUpdates((current) =>
              toggleSetupWizardScheduledUpdate(current, activePresetId),
            )
          }
        },
      },
      channels: {
        lines: setupWizardChannelOptions.map((option, index) => {
          const status = getChannelStatus(option.channel)
          return {
            active: index === channelIndex,
            badges: [
              {
                label: status.badge,
                tone: resolveSetupWizardRuntimeTone(status),
              },
            ],
            description: option.description,
            detail: formatSetupWizardRuntimeDetail(status),
            key: option.channel,
            selected: selectedChannels.includes(option.channel),
            title: option.title,
          }
        }),
        marker: 'checkbox',
        nextStep: 'wearables',
        previousStep: 'scheduled-updates',
        selectCurrentOnEnter: false,
        setIndex: setChannelIndex,
        step: 'channels',
        stepIntro: formatSetupWizardStepIntro('channels', selectedAssistantProvider),
        toggleCurrent: () => {
          const activeChannel = setupWizardChannelOptions[channelIndex]?.channel
          if (activeChannel) {
            setSelectedChannels((current) =>
              toggleSetupWizardChannel(current, activeChannel),
            )
          }
        },
      },
      wearables: {
        lines: setupWizardWearableOptions.map((option, index) => {
          const status = getWearableStatus(option.wearable)
          return {
            active: index === wearableIndex,
            badges: [
              {
                label: status.badge,
                tone: resolveSetupWizardRuntimeTone(status),
              },
            ],
            description: option.description,
            detail: formatSetupWizardRuntimeDetail(status),
            key: option.wearable,
            selected: selectedWearables.includes(option.wearable),
            title: option.title,
          }
        }),
        marker: 'checkbox',
        nextStep: includePublicUrlStep ? 'public-url' : 'confirm',
        previousStep: 'channels',
        selectCurrentOnEnter: false,
        setIndex: setWearableIndex,
        step: 'wearables',
        stepIntro: formatSetupWizardStepIntro('wearables', selectedAssistantProvider),
        toggleCurrent: () => {
          const activeWearable = setupWizardWearableOptions[wearableIndex]?.wearable
          if (activeWearable) {
            setSelectedWearables((current) =>
              toggleSetupWizardWearable(current, activeWearable),
            )
          }
        },
      },
    }

    const selectionStep =
      step === 'intro' || step === 'public-url' || step === 'confirm'
        ? null
        : selectionSteps[step]

    useInput((value, key) => {
      if ((key.ctrl && value === 'c') || value.toLowerCase() === 'q') {
        completion.fail(
          new VaultCliError('setup_cancelled', 'Murph setup was cancelled.'),
        )
        exit()
        return
      }

      if (step === 'intro') {
        if (key.return || value === ' ') {
          setStep('assistant-provider')
          return
        }

        if (key.escape) {
          completion.fail(
            new VaultCliError('setup_cancelled', 'Murph setup was cancelled.'),
          )
          exit()
        }
        return
      }

      if (selectionStep) {
        if (key.upArrow) {
          selectionStep.setIndex((current) =>
            wrapSetupWizardIndex(current, selectionStep.lines.length, -1),
          )
          return
        }

        if (key.downArrow) {
          selectionStep.setIndex((current) =>
            wrapSetupWizardIndex(current, selectionStep.lines.length, 1),
          )
          return
        }

        if (value === ' ') {
          selectionStep.toggleCurrent()
          return
        }

        if (key.escape) {
          setStep(selectionStep.previousStep)
          return
        }

        if (key.return) {
          if (selectionStep.step === 'assistant-provider') {
            const activeProvider =
              setupWizardAssistantProviderOptions[assistantProviderIndex]?.provider ??
              selectedAssistantProvider
            selectionStep.toggleCurrent()
            setStep(
              doesSetupWizardAssistantProviderRequireMethod(activeProvider)
                ? 'assistant-method'
                : 'scheduled-updates',
            )
            return
          }

          if (selectionStep.selectCurrentOnEnter) {
            selectionStep.toggleCurrent()
          }
          setStep(selectionStep.nextStep)
          return
        }
        return
      }

      if (step === 'public-url') {
        if (key.escape) {
          setStep('wearables')
          return
        }

        if (key.return || value === ' ') {
          setStep('confirm')
        }
        return
      }

      if (step === 'confirm') {
        if (key.escape || key.leftArrow) {
          setStep(includePublicUrlStep ? 'public-url' : 'wearables')
          return
        }

        if (key.return || value === ' ') {
          completion.submit({
            assistantApiKeyEnv: latestAssistantRef.current.apiKeyEnv,
            assistantBaseUrl: latestAssistantRef.current.baseUrl,
            assistantOss: latestAssistantRef.current.oss,
            assistantPreset: latestAssistantRef.current.preset,
            assistantProviderName: latestAssistantRef.current.providerName,
            channels: sortSetupWizardChannels(latestChannelsRef.current),
            scheduledUpdates: sortSetupWizardScheduledUpdates(
              latestScheduledUpdatesRef.current,
            ),
            wearables: sortSetupWizardWearables(latestWearablesRef.current),
          })
          exit()
        }
      }
    })

    const selectedChannelNames = selectedChannels.map((channel) =>
      formatSetupChannel(channel),
    )
    const selectedWearableNames = selectedWearables.map((wearable) =>
      formatSetupWearable(wearable),
    )
    const selectedScheduledUpdateNames = selectedScheduledUpdates.map((presetId) =>
      formatSetupScheduledUpdate(presetId),
    )
    const selectedChannelSummary = formatSelectionSummary(selectedChannelNames)
    const selectedScheduledUpdateSummary = formatSelectionSummary(
      selectedScheduledUpdateNames,
    )
    const selectedWearableSummary = formatSelectionSummary(selectedWearableNames)
    const selectedReadyNow = [
      ...selectedChannels.flatMap((channel) =>
        getChannelStatus(channel).ready ? [formatSetupChannel(channel)] : [],
      ),
      ...selectedWearables.flatMap((wearable) =>
        getWearableStatus(wearable).ready ? [formatSetupWearable(wearable)] : [],
      ),
    ]
    const selectedNeedsEnv = [
      ...selectedChannels.flatMap((channel) => {
        const status = getChannelStatus(channel)
        return status.missingEnv.length > 0
          ? [`${formatSetupChannel(channel)} (${formatMissingEnv(status.missingEnv)})`]
          : []
      }),
      ...selectedWearables.flatMap((wearable) => {
        const status = getWearableStatus(wearable)
        return status.missingEnv.length > 0
          ? [`${formatSetupWearable(wearable)} (${formatMissingEnv(status.missingEnv)})`]
          : []
      }),
      ...(assistantSelection.apiKeyEnv &&
      normalizeSetupWizardText(process.env[assistantSelection.apiKeyEnv]) === null
        ? [
            `Assistant (${assistantSelection.apiKeyEnv})`,
          ]
        : []),
    ]
    const hintRow = createSetupWizardHintRow(
      resolveSetupWizardHints({
        commandName,
        selectionMarker: selectionStep?.marker,
        step,
      }),
    )
    const confirmNextStep = describeSetupWizardReviewNextStep({
      needsEnv: selectedNeedsEnv.length > 0,
      hasScheduledUpdates: selectedScheduledUpdates.length > 0,
    })
    const completedBlocks: React.ReactElement[] = []

    if (
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'assistant-provider',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle(
              'assistant-provider',
              selectedAssistantProvider,
            ),
            value: assistantSelection.providerLabel,
          },
          'completed-assistant-provider',
        ),
      )
    }

    if (
      includeAssistantMethodStep &&
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'assistant-method',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle(
              'assistant-method',
              selectedAssistantProvider,
            ),
            value: assistantSelection.methodLabel ?? 'Skip',
            detail: assistantSelection.detail,
          },
          'completed-assistant-method',
        ),
      )
    }

    if (
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'scheduled-updates',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle(
              'scheduled-updates',
              selectedAssistantProvider,
            ),
            value: formatSelectionSummary(selectedScheduledUpdateNames),
          },
          'completed-scheduled-updates',
        ),
      )
    }

    if (
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'channels',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle('channels', selectedAssistantProvider),
            value: formatSelectionSummary(selectedChannelNames),
          },
          'completed-channels',
        ),
      )
    }

    if (
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'wearables',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle('wearables', selectedAssistantProvider),
            value: formatSelectionSummary(selectedWearableNames),
          },
          'completed-wearables',
        ),
      )
    }

    if (
      includePublicUrlStep &&
      hasSetupWizardStepPassed({
        currentStep: step,
        includeAssistantMethodStep,
        includePublicUrlStep,
        stepToCheck: 'public-url',
      })
    ) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupWizardPromptTitle('public-url', selectedAssistantProvider),
            value: formatSetupPublicUrlStrategy(
              publicUrlReview.recommendedStrategy,
            ),
            detail: publicUrlGuidance ?? publicUrlReview.summary,
          },
          'completed-public-url',
        ),
      )
    }

    const activePanel =
      step === 'intro'
        ? createSetupWizardPanel({
            title: 'Before you start',
            tone: 'accent',
            children: [
              createElement(
                Text,
                null,
                'We’ll help you choose how Murph should answer, which chats to turn on, and any health data you want to connect.',
              ),
              createElement(Text, null, ''),
              createSetupWizardBulletRow(
                {
                  body: 'You can skip anything now and change it later.',
                  label: 'Nothing is locked in',
                  tone: 'success',
                },
                'intro-change-later',
              ),
              createSetupWizardBulletRow(
                {
                  body: 'If something needs a key or token, you can enter it for this setup run only or leave it for later.',
                  label: 'Keys and tokens',
                  tone: 'accent',
                },
                'intro-keys',
              ),
              createSetupWizardBulletRow(
                {
                  body: SETUP_RUNTIME_ENV_NOTICE,
                  label: 'This setup run only',
                  tone: 'muted',
                },
                'intro-runtime-env',
              ),
            ],
          })
        : selectionStep
          ? createSetupWizardPanel({
              title: formatSetupWizardPromptTitle(
                selectionStep.step,
                selectedAssistantProvider,
              ),
              tone: 'accent',
              children: [
                selectionStep.stepIntro
                  ? createElement(
                      Text,
                      { color: resolveSetupWizardToneColor('muted') },
                      selectionStep.stepIntro,
                    )
                  : null,
                selectionStep.stepIntro ? createElement(Text, null, '') : null,
                ...selectionStep.lines.map((line) =>
                  createSetupWizardSelectionRow(
                    {
                      line,
                      marker: selectionStep.marker,
                    },
                    line.key,
                  ),
                ),
              ],
            })
          : step === 'public-url'
            ? createSetupWizardPanel({
                title: formatSetupWizardPromptTitle(
                  'public-url',
                  selectedAssistantProvider,
                ),
                tone: 'accent',
                children: [
                  createElement(Text, null, publicUrlReview.summary),
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: publicUrlGuidance ?? '',
                      label: `Easiest path: ${formatSetupPublicUrlStrategy(
                        publicUrlReview.recommendedStrategy,
                      )}`,
                      tone: 'accent',
                    },
                    'public-url-recommended',
                  ),
                  createElement(Text, null, ''),
                  createElement(
                    Text,
                    { color: resolveSetupWizardToneColor('muted'), bold: true },
                    'If you keep things local, use these URLs',
                  ),
                  createElement(Text, null, ''),
                  ...publicUrlReview.targets.map((target) =>
                    createSetupWizardPublicUrlTargetRow(target),
                  ),
                  createElement(Text, null, ''),
                  createElement(
                    Text,
                    { color: resolveSetupWizardToneColor('muted') },
                    'This step is informational only. Murph does not save a public URL choice yet.',
                  ),
                ],
              })
            : createSetupWizardPanel({
                title: 'Review your setup',
                tone: 'accent',
                children: [
                  createSetupWizardKeyValueRow(
                    { label: 'Assistant', value: assistantSelection.summary },
                    'confirm-assistant',
                  ),
                  createSetupWizardKeyValueRow(
                    { label: 'Chat channels', value: selectedChannelSummary },
                    'confirm-channels',
                  ),
                  createSetupWizardKeyValueRow(
                    { label: 'Health data', value: selectedWearableSummary },
                    'confirm-wearables',
                  ),
                  createSetupWizardKeyValueRow(
                    {
                      label: 'Auto updates',
                      value: selectedScheduledUpdateSummary,
                    },
                    'confirm-schedules',
                  ),
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: formatSelectionSummary(selectedReadyNow),
                      label: 'Can connect now',
                      tone: 'success',
                    },
                    'confirm-ready',
                  ),
                  createSetupWizardBulletRow(
                    {
                      body: formatSelectionSummary(selectedNeedsEnv),
                      label: 'Needs keys first',
                      tone: selectedNeedsEnv.length > 0 ? 'warn' : 'muted',
                    },
                    'confirm-needs-env',
                  ),
                  publicUrlGuidance
                    ? createSetupWizardBulletRow(
                        {
                          body: publicUrlGuidance,
                          label: 'Public links',
                          tone: 'accent',
                        },
                        'confirm-public-url',
                      )
                    : null,
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: confirmNextStep,
                      label: 'Next',
                      tone: 'accent',
                    },
                    'confirm-next-step',
                  ),
                ],
              })

    return createElement(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 1,
      },
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('accent'), bold: true },
        '✦ Murph setup',
      ),
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('muted') },
        'Choose the basics now. You can change anything later.',
      ),
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('muted'), dimColor: true },
        `Vault: ${input.vault}`,
      ),
      createElement(Text, null, ''),
      ...completedBlocks,
      activePanel,
      createElement(Text, null, ''),
      hintRow,
    )

    function getChannelStatus(channel: SetupChannel): SetupWizardRuntimeStatus {
      return normalizeSetupWizardRuntimeStatus(input.channelStatuses?.[channel])
    }

    function getWearableStatus(wearable: SetupWearable): SetupWizardRuntimeStatus {
      return normalizeSetupWizardRuntimeStatus(input.wearableStatuses?.[wearable])
    }
  }
  try {
    instance = render(React.createElement(App), {
      stderr: process.stderr,
      stdout: process.stderr,
      patchConsole: false,
    })
    void instance.waitUntilExit().then(
      () => {
        completion.completeExit()
      },
      (error) => {
        completion.fail(error)
      },
    )
  } catch (error) {
    completion.fail(error)
  }

  if (!instance) {
    completion.fail(new Error('Murph setup wizard failed to initialize.'))
  }

  return await completion.waitForResult()
}

function normalizeSetupWizardRuntimeStatus(
  status: SetupWizardRuntimeStatus | undefined,
): SetupWizardRuntimeStatus {
  return (
    status ?? {
      badge: 'optional',
      detail: '',
      missingEnv: [],
      ready: true,
    }
  )
}

function sortSetupWizardChannels(channels: readonly SetupChannel[]): SetupChannel[] {
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

function sortSetupWizardWearables(
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

function sortSetupWizardScheduledUpdates(
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

function findSetupWizardAssistantProviderIndex(
  provider: SetupWizardAssistantProvider,
): number {
  const index = setupWizardAssistantProviderOptions.findIndex(
    (option) => option.provider === provider,
  )
  return index >= 0 ? index : 0
}

function findSetupWizardAssistantMethodIndex(
  provider: SetupWizardAssistantProvider,
  method: SetupWizardAssistantMethod,
): number {
  const options = listSetupWizardAssistantMethodOptions(provider)
  const index = options.findIndex((option) => option.method === method)
  return index >= 0 ? index : 0
}

export function inferSetupWizardAssistantProvider(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  oss?: boolean | null
  preset: SetupAssistantPreset
  providerName?: string | null
  providerPreset?: SetupAssistantProviderPreset | null
}): SetupWizardAssistantProvider {
  switch (input.preset) {
    case 'codex':
      if (input.oss === true) {
        return resolveSetupWizardCompatibleProviderPreset(input)?.id ?? 'custom'
      }
      return 'openai'
    case 'skip':
      return 'skip'
    case 'openai-compatible':
      if (input.providerPreset) {
        return input.providerPreset
      }

      if (isOpenAIAssistantSelection(input)) {
        return 'openai'
      }

      return resolveSetupWizardCompatibleProviderPreset(input)?.id ?? 'custom'
  }
}

function inferSetupWizardAssistantMethod(input: {
  oss?: boolean | null
  preset: SetupAssistantPreset
  provider: SetupWizardAssistantProvider
}): SetupWizardAssistantMethod {
  switch (input.preset) {
    case 'codex':
      return input.oss === true ? 'compatible-codex-local' : 'openai-codex'
    case 'skip':
      return 'skip'
    case 'openai-compatible':
      if (input.provider === 'openai') {
        return 'openai-api-key'
      }

      return doesSetupWizardAssistantProviderRequireMethod(input.provider)
        ? 'compatible-endpoint'
        : 'compatible-provider'
  }
}

function doesSetupWizardAssistantProviderRequireMethod(
  provider: SetupWizardAssistantProvider,
): boolean {
  return provider === 'openai' || provider === 'custom'
}

function resolveSetupWizardAssistantMethodForProvider(input: {
  currentMethod: SetupWizardAssistantMethod
  provider: SetupWizardAssistantProvider
}): SetupWizardAssistantMethod {
  if (input.provider === 'skip') {
    return 'skip'
  }

  if (input.provider === 'openai') {
    return input.currentMethod === 'openai-api-key'
      ? 'openai-api-key'
      : 'openai-codex'
  }

  if (input.provider === 'custom') {
    return input.currentMethod === 'compatible-codex-local'
      ? 'compatible-codex-local'
      : 'compatible-endpoint'
  }

  return 'compatible-provider'
}

function listSetupWizardAssistantMethodOptions(
  provider: SetupWizardAssistantProvider,
): readonly SetupWizardAssistantMethodOption[] {
  switch (provider) {
    case 'openai':
      return setupWizardOpenAIAssistantMethodOptions
    case 'custom':
      return setupWizardCompatibleAssistantMethodOptions
    case 'skip':
      return []
    default:
      return []
  }
}

export function resolveSetupWizardAssistantSelection(input: {
  initialApiKeyEnv?: string | null
  initialBaseUrl?: string | null
  initialProvider?: SetupWizardAssistantProvider
  initialProviderName?: string | null
  method: SetupWizardAssistantMethod
  provider: SetupWizardAssistantProvider
}): SetupWizardResolvedAssistantSelection {
  const preservedSelection =
    input.initialProvider === input.provider
      ? {
          apiKeyEnv: normalizeSetupWizardText(input.initialApiKeyEnv),
          baseUrl: normalizeSetupWizardText(input.initialBaseUrl),
          providerName: normalizeSetupWizardText(input.initialProviderName),
        }
      : {
          apiKeyEnv: null,
          baseUrl: null,
          providerName: null,
        }

  if (input.provider === 'skip') {
    return {
      apiKeyEnv: null,
      baseUrl: null,
      detail: 'Murph will leave your current assistant settings alone for now.',
      methodLabel: null,
      oss: null,
      preset: 'skip',
      providerLabel: 'Skip for now',
      providerName: null,
      summary: 'Skip for now',
    }
  }

  if (input.provider === 'openai') {
    if (input.method === 'openai-api-key') {
      const apiKeyEnv = preservedSelection.apiKeyEnv ?? 'OPENAI_API_KEY'
      return {
        apiKeyEnv,
        baseUrl: preservedSelection.baseUrl ?? DEFAULT_SETUP_OPENAI_API_BASE_URL,
        detail: `Murph will use ${apiKeyEnv} and ask which model to save next.`,
        methodLabel: 'OpenAI API key',
        oss: false,
        preset: 'openai-compatible',
        providerLabel: 'OpenAI',
        providerName: preservedSelection.providerName ?? 'openai',
        summary: 'OpenAI · API key',
      }
    }

    return {
      apiKeyEnv: null,
      baseUrl: null,
      detail: 'Murph will use your saved Codex / ChatGPT sign-in and ask which default model to use next.',
      methodLabel: 'ChatGPT / Codex sign-in',
      oss: false,
      preset: 'codex',
      providerLabel: 'OpenAI',
      providerName: null,
      summary: 'OpenAI · ChatGPT / Codex sign-in',
    }
  }

  if (input.provider === 'custom') {
    if (input.method === 'compatible-codex-local') {
      return {
        apiKeyEnv: null,
        baseUrl: null,
        detail: 'Murph will keep the Codex flow and ask which local model to save next.',
        methodLabel: 'Codex local model',
        oss: true,
        preset: 'codex',
        providerLabel: 'Custom endpoint',
        providerName: null,
        summary: 'Custom endpoint · Codex local model',
      }
    }

    return {
      apiKeyEnv: preservedSelection.apiKeyEnv,
      baseUrl:
        preservedSelection.baseUrl ?? DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
      detail: 'Murph will ask for the endpoint URL and then let you choose a model.',
      methodLabel: 'Compatible endpoint',
      oss: false,
      preset: 'openai-compatible',
      providerLabel: 'Custom endpoint',
      providerName: preservedSelection.providerName,
      summary: 'Custom endpoint · Compatible endpoint',
    }
  }

  const providerPreset =
    resolveOpenAICompatibleProviderPresetFromId(input.provider) ??
    resolveOpenAICompatibleProviderPresetFromId('custom')

  return {
    apiKeyEnv: preservedSelection.apiKeyEnv ?? providerPreset?.apiKeyEnv ?? null,
    baseUrl:
      preservedSelection.baseUrl ??
      providerPreset?.baseUrl ??
      DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
    detail: buildSetupWizardNamedProviderSelectionDetail({
      apiKeyEnv: preservedSelection.apiKeyEnv ?? providerPreset?.apiKeyEnv ?? null,
      preset: providerPreset,
    }),
    methodLabel: null,
    oss: false,
    preset: 'openai-compatible',
    providerLabel: providerPreset?.title ?? 'OpenAI-compatible provider',
    providerName:
      preservedSelection.providerName ?? providerPreset?.providerName ?? null,
    summary: providerPreset?.title ?? 'OpenAI-compatible provider',
  }
}

function resolveSetupWizardCompatibleProviderPreset(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  providerName?: string | null
}): OpenAICompatibleProviderPreset | null {
  const normalizedBaseUrl = normalizeSetupWizardText(input.baseUrl)
  if (normalizedBaseUrl !== null) {
    const preset = resolveOpenAICompatibleProviderPreset({
      baseUrl: normalizedBaseUrl,
    })
    return preset?.id === 'openai' ? null : preset
  }

  const normalizedProviderName = normalizeSetupWizardText(input.providerName)
  if (normalizedProviderName !== null) {
    const preset = resolveOpenAICompatibleProviderPreset({
      providerName: normalizedProviderName,
    })
    return preset?.id === 'openai' ? null : preset
  }

  const preset = resolveOpenAICompatibleProviderPreset({
    apiKeyEnv: input.apiKeyEnv,
  })

  return preset?.id === 'openai' ? null : preset
}

function isOpenAIAssistantSelection(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  providerName?: string | null
}): boolean {
  const normalizedProviderName = normalizeSetupWizardText(input.providerName)
  if (normalizedProviderName !== null) {
    return (
      resolveOpenAICompatibleProviderPreset({
        providerName: normalizedProviderName,
      })?.id === 'openai'
    )
  }

  const normalizedBaseUrl = normalizeSetupWizardText(input.baseUrl)
  if (normalizedBaseUrl !== null) {
    return (
      resolveOpenAICompatibleProviderPreset({
        baseUrl: normalizedBaseUrl,
      })?.id === 'openai'
    )
  }

  return (
    resolveOpenAICompatibleProviderPreset({
      apiKeyEnv: input.apiKeyEnv,
    })?.id === 'openai'
  )
}

function buildSetupWizardAssistantProviderDescription(
  preset: OpenAICompatibleProviderPreset,
): string {
  if (preset.id === 'openai') {
    return 'Use OpenAI. You can choose ChatGPT / Codex sign-in or an API key next.'
  }

  if (preset.kind === 'local') {
    return `Use ${preset.title} through its local OpenAI-compatible server.`
  }

  if (preset.kind === 'gateway') {
    return `Use ${preset.title} as an OpenAI-compatible gateway.`
  }

  return `Use ${preset.title} and choose a model during setup.`
}

function buildSetupWizardNamedProviderSelectionDetail(input: {
  apiKeyEnv: string | null
  preset: OpenAICompatibleProviderPreset | null
}): string {
  const providerTitle = input.preset?.title ?? 'this provider'

  if (input.apiKeyEnv) {
    return `Murph will use ${providerTitle} and read the key from ${input.apiKeyEnv}. It will ask which model to save next.`
  }

  return `Murph will use ${providerTitle} and ask which model to save next.`
}

function formatSetupChannel(channel: SetupChannel): string {
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

function formatSetupScheduledUpdate(presetId: string): string {
  return (
    setupWizardScheduledUpdateOptions.find((option) => option.id === presetId)?.title ??
    presetId
  )
}

function formatSelectionSummary(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'None'
}

function formatMissingEnv(values: readonly string[]): string {
  if (values.length === 0) {
    return 'nothing else'
  }

  if (values.length === 1) {
    return values[0] ?? ''
  }

  return values.join(', ')
}

function formatSetupPublicUrlStrategy(strategy: SetupPublicUrlStrategy): string {
  return strategy === 'hosted' ? 'Hosted web app' : 'Local tunnel'
}

function listSetupWizardSteps(input: {
  includeAssistantMethodStep: boolean
  includePublicUrlStep: boolean
}): SetupWizardStep[] {
  return [
    'intro',
    'assistant-provider',
    ...(input.includeAssistantMethodStep ? (['assistant-method'] as const) : []),
    'scheduled-updates',
    'channels',
    'wearables',
    ...(input.includePublicUrlStep ? (['public-url'] as const) : []),
    'confirm',
  ]
}

function hasSetupWizardStepPassed(input: {
  currentStep: SetupWizardStep
  includeAssistantMethodStep: boolean
  includePublicUrlStep: boolean
  stepToCheck: SetupWizardStep
}): boolean {
  const steps = listSetupWizardSteps({
    includeAssistantMethodStep: input.includeAssistantMethodStep,
    includePublicUrlStep: input.includePublicUrlStep,
  })
  const currentIndex = steps.indexOf(input.currentStep)
  const stepIndex = steps.indexOf(input.stepToCheck)

  return currentIndex > stepIndex
}

function resolveSetupWizardToneColor(tone: SetupWizardTone): string {
  switch (tone) {
    case 'accent':
      return 'cyan'
    case 'success':
      return 'green'
    case 'warn':
      return 'yellow'
    case 'danger':
      return 'red'
    case 'muted':
      return 'gray'
  }
}

function resolveSetupWizardRuntimeTone(
  status: SetupWizardRuntimeStatus,
): SetupWizardTone {
  if (status.ready) {
    return 'success'
  }

  return status.badge.toLowerCase().includes('macos') ? 'accent' : 'warn'
}

function formatSetupWizardRuntimeDetail(
  status: SetupWizardRuntimeStatus,
): string {
  if (status.ready) {
    return 'Ready to connect now.'
  }

  if (!status.ready && status.missingEnv.length > 0) {
    return `Needs ${formatMissingEnv(status.missingEnv)} before this can connect.`
  }

  return status.badge.toLowerCase().includes('macos')
    ? 'Only available on macOS.'
    : status.detail
}

function buildSetupWizardAssistantProviderBadges(input: {
  currentProvider: SetupWizardAssistantProvider
  provider: SetupWizardAssistantProvider
}): SetupWizardInlineBadge[] {
  const badges: SetupWizardInlineBadge[] = []

  if (input.provider === 'skip') {
    badges.push({ label: 'no change', tone: 'muted' })
  } else if (input.provider === 'custom') {
    badges.push({ label: 'manual', tone: 'accent' })
  } else {
    const preset = resolveOpenAICompatibleProviderPresetFromId(input.provider)
    if (preset?.id === 'openai') {
      badges.push({ label: 'recommended', tone: 'success' })
    } else if (preset?.kind === 'local') {
      badges.push({ label: 'local', tone: 'accent' })
    } else if (preset?.kind === 'gateway') {
      badges.push({ label: 'gateway', tone: 'accent' })
    } else {
      badges.push({ label: 'hosted', tone: 'muted' })
    }
  }

  if (input.currentProvider === input.provider) {
    badges.push({ label: 'current', tone: 'accent' })
  }

  return badges
}

function buildSetupWizardAssistantMethodBadges(input: {
  currentMethod: SetupWizardAssistantMethod
  method: SetupWizardAssistantMethod
  optionBadges?: readonly SetupWizardInlineBadge[]
}): SetupWizardInlineBadge[] {
  return [
    ...(input.optionBadges ? [...input.optionBadges] : []),
    ...(input.currentMethod === input.method
      ? ([{ label: 'current', tone: 'accent' }] as const)
      : []),
  ]
}

function buildSetupWizardScheduledUpdateBadges(input: {
  isStarter: boolean
}): SetupWizardInlineBadge[] {
  return [
    ...(input.isStarter ? ([{ label: 'recommended', tone: 'accent' }] as const) : []),
    { label: 'set up later', tone: 'muted' },
  ]
}

function formatSetupWizardPromptTitle(
  step: SetupWizardStep,
  provider: SetupWizardAssistantProvider,
): string {
  switch (step) {
    case 'intro':
      return 'Before you start'
    case 'assistant-provider':
      return 'How should Murph answer?'
    case 'assistant-method':
      if (provider === 'openai') {
        return 'How should Murph connect to OpenAI?'
      }

      return 'How should Murph connect to your endpoint?'
    case 'scheduled-updates':
      return 'Auto updates'
    case 'channels':
      return 'Chat channels'
    case 'wearables':
      return 'Health data'
    case 'public-url':
      return 'Public links'
    case 'confirm':
      return 'Review'
  }
}

function formatSetupWizardStepIntro(
  step: SetupWizardStep,
  provider: SetupWizardAssistantProvider,
): string | undefined {
  switch (step) {
    case 'assistant-provider':
      return 'Choose the provider or endpoint style Murph should use by default.'
    case 'assistant-method':
      return provider === 'openai'
        ? 'Pick the OpenAI path that fits you best.'
        : 'Choose a manual endpoint or keep the Codex local-model flow.'
    case 'scheduled-updates':
      return 'These are optional check-ins Murph can send later.'
    case 'channels':
      return 'Turn on the chats you want Murph to use first.'
    case 'wearables':
      return 'Pick any health data sources you want to connect after setup.'
    default:
      return undefined
  }
}

function createSetupWizardPanel(input: {
  children: readonly React.ReactNode[]
  title: string
  tone: SetupWizardTone
}): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      borderColor: resolveSetupWizardToneColor(input.tone),
      borderStyle: 'round',
      flexDirection: 'column',
      paddingX: 1,
      paddingY: 0,
    },
    createElement(
      Text,
      { color: resolveSetupWizardToneColor(input.tone), bold: true },
      input.title,
    ),
    input.children.length > 0 ? createElement(Text, null, '') : null,
    ...input.children,
  )
}

function createSetupWizardInlineBadgeElements(
  badges: readonly SetupWizardInlineBadge[],
  keyPrefix: string,
): React.ReactElement[] {
  const createElement = React.createElement
  const elements: React.ReactElement[] = []

  for (const [index, badge] of badges.entries()) {
    if (index > 0) {
      elements.push(
        createElement(Text, { key: `${keyPrefix}:space:${index}` }, ' '),
      )
    }

    elements.push(
      createElement(
        Text,
        {
          bold: true,
          color: resolveSetupWizardToneColor(badge.tone),
          key: `${keyPrefix}:badge:${badge.label}:${index}`,
        },
        `[${badge.label}]`,
      ),
    )
  }

  return elements
}

function createSetupWizardSelectionRow(
  input: {
    line: SetupWizardSelectionLine
    marker: 'checkbox' | 'radio'
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement
  const markerSymbol =
    input.marker === 'checkbox'
      ? input.line.selected
        ? '■'
        : '□'
      : input.line.selected
        ? '●'
        : '○'
  const markerTone: SetupWizardTone = input.line.active
    ? 'accent'
    : input.line.selected
      ? 'success'
      : 'muted'
  const titleColor = input.line.active
    ? resolveSetupWizardToneColor('accent')
    : input.line.selected
      ? resolveSetupWizardToneColor('success')
      : undefined

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Box,
      { flexDirection: 'row' },
      createElement(
        Text,
        {
          color: input.line.active
            ? resolveSetupWizardToneColor('accent')
            : resolveSetupWizardToneColor('muted'),
          bold: input.line.active,
        },
        `${input.line.active ? '›' : ' '} `,
      ),
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor(markerTone),
          bold: true,
        },
        `${markerSymbol} `,
      ),
      createElement(
        Text,
        {
          color: titleColor,
          bold: true,
        },
        input.line.title,
      ),
      input.line.badges.length > 0
        ? createElement(
            Box,
            {
              flexDirection: 'row',
              marginLeft: 1,
            },
            createElement(
              Text,
              null,
              ...createSetupWizardInlineBadgeElements(input.line.badges, key),
            ),
          )
        : null,
    ),
    createElement(
      Text,
      { color: resolveSetupWizardToneColor('muted') },
      `  ${input.line.description}`,
    ),
    input.line.detail
      ? createElement(
          Text,
          {
            color: resolveSetupWizardToneColor('muted'),
            dimColor: true,
          },
          `  ${input.line.detail}`,
        )
      : null,
  )
}

function createSetupWizardAnsweredBlock(
  input: {
    detail?: string
    label: string
    value: string
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      { color: resolveSetupWizardToneColor('accent'), bold: true },
      `◇ ${input.label}`,
    ),
    createElement(
      Text,
      { bold: true },
      `  ${input.value}`,
    ),
    input.detail
      ? createElement(
          Text,
          {
            color: resolveSetupWizardToneColor('muted'),
            dimColor: true,
          },
          `  ${input.detail}`,
        )
      : null,
  )
}

function createSetupWizardBulletRow(
  input: {
    body: string
    label: string
    tone: SetupWizardTone
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor(input.tone),
          bold: true,
        },
        `• ${input.label}: `,
      ),
      input.body,
    ),
  )
}

function createSetupWizardKeyValueRow(
  input: {
    label: string
    value: string
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor('muted'),
          bold: true,
        },
        `${input.label}: `,
      ),
      input.value,
    ),
  )
}

function createSetupWizardPublicUrlTargetRow(
  target: SetupWizardPublicUrlTarget,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key: target.label,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor('muted'),
          bold: true,
        },
        `${target.label}: `,
      ),
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('accent') },
        target.url,
      ),
    ),
    createElement(
      Text,
      {
        color: resolveSetupWizardToneColor('muted'),
        dimColor: true,
      },
      `  ${target.detail}`,
    ),
  )
}

function resolveSetupWizardHints(input: {
  commandName: string
  selectionMarker: 'checkbox' | 'radio' | undefined
  step: SetupWizardStep
}): SetupWizardHint[] {
  switch (input.step) {
    case 'intro':
      return [
        { label: `Enter start ${input.commandName}`, tone: 'accent' },
        { label: 'q quit', tone: 'muted' },
      ]
    case 'assistant-provider':
    case 'assistant-method':
    case 'scheduled-updates':
    case 'channels':
    case 'wearables':
      return [
        { label: '↑/↓ move', tone: 'muted' },
        {
          label: input.selectionMarker === 'radio' ? 'Space choose' : 'Space toggle',
          tone: 'accent',
        },
        { label: 'Enter next', tone: 'success' },
        { label: 'Esc back', tone: 'muted' },
        { label: 'q quit', tone: 'muted' },
      ]
    case 'public-url':
      return [
        { label: 'Enter next', tone: 'success' },
        { label: 'Esc back', tone: 'muted' },
        { label: 'q quit', tone: 'muted' },
      ]
    case 'confirm':
      return [
        { label: 'Enter start setup', tone: 'success' },
        { label: 'Esc back', tone: 'muted' },
        { label: 'q quit', tone: 'muted' },
      ]
  }
}

function createSetupWizardHintRow(
  hints: readonly SetupWizardHint[],
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Text,
    null,
    ...createSetupWizardInlineBadgeElements(hints, 'hint'),
  )
}

function describeSetupWizardReviewNextStep(input: {
  hasScheduledUpdates: boolean
  needsEnv: boolean
}): string {
  if (input.needsEnv && input.hasScheduledUpdates) {
    return 'Murph will ask for any missing keys for this setup run, finish setup, keep your update picks ready for later, and open anything that can connect right away.'
  }

  if (input.needsEnv) {
    return 'Murph will ask for any missing keys for this setup run, finish setup, and open anything that can connect right away.'
  }

  if (input.hasScheduledUpdates) {
    return 'Murph will finish setup, keep your update picks ready for later, and open anything that can connect right away.'
  }

  return 'Murph will finish setup and open anything that can connect right away.'
}

export function buildSetupWizardPublicUrlReview(input: {
  channels: readonly SetupChannel[]
  wearables: readonly SetupWearable[]
  publicBaseUrl?: string | null
  deviceSyncLocalBaseUrl?: string | null
  linqLocalWebhookUrl?: string | null
}): SetupWizardPublicUrlReview {
  const publicBaseUrl = normalizeSetupWizardText(input.publicBaseUrl)
  const hasLinq = input.channels.includes('linq')
  const selectedWearables = sortSetupWizardWearables(input.wearables)
  const needsPublicStrategy = hasLinq || selectedWearables.length > 0
  const deviceSyncLocalBaseUrl =
    normalizeSetupWizardText(input.deviceSyncLocalBaseUrl) ??
    DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL
  const linqLocalWebhookUrl =
    normalizeSetupWizardText(input.linqLocalWebhookUrl) ??
    DEFAULT_SETUP_LINQ_WEBHOOK_URL

  if (!needsPublicStrategy || publicBaseUrl) {
    return {
      enabled: false,
      recommendedStrategy: 'hosted',
      summary: '',
      targets: [],
    }
  }

  return {
    enabled: true,
    recommendedStrategy:
      selectedWearables.length > 0 ? 'hosted' : 'tunnel',
    summary: describeSetupWizardPublicUrlSummary({
      hasLinq,
      wearables: selectedWearables,
    }),
    targets: buildSetupWizardPublicUrlTargets({
      hasLinq,
      wearables: selectedWearables,
      deviceSyncLocalBaseUrl,
      linqLocalWebhookUrl,
    }),
  }
}

export function describeSetupWizardPublicUrlStrategyChoice(input: {
  review: SetupWizardPublicUrlReview
  strategy: SetupPublicUrlStrategy
}): string {
  if (!input.review.enabled) {
    return ''
  }

  if (input.strategy === 'hosted') {
    const hasLinq = input.review.targets.some((target) => target.label === 'Linq webhook')
    return hasLinq
      ? 'Use hosted `apps/web` for Garmin/WHOOP/Oura, but keep Linq on the local webhook path for now.'
      : 'Use hosted `apps/web` for Garmin/WHOOP/Oura so callbacks stay on one stable public base.'
  }

  const hasWearableTargets = input.review.targets.some((target) =>
    target.label.startsWith('Garmin') || target.label.startsWith('WHOOP') || target.label.startsWith('Oura'),
  )
  if (hasWearableTargets) {
    return 'Expose the local callback routes through a tunnel instead of setting up hosted `apps/web` first.'
  }

  return 'Expose the local Linq webhook through a tunnel. Murph does not have a hosted Linq webhook yet.'
}

function describeSetupWizardPublicUrlSummary(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
}): string {
  if (input.wearables.length > 0 && input.hasLinq) {
    return 'Garmin/WHOOP/Oura are easiest through hosted `apps/web`, while Linq still needs the local inbox webhook today.'
  }

  if (input.wearables.length > 0) {
    return 'Garmin/WHOOP/Oura need a public callback URL. Hosted `apps/web` is the easiest stable base.'
  }

  return 'Linq still uses the local inbox webhook today, so a tunnel to your machine is the simplest public path.'
}

function buildSetupWizardPublicUrlTargets(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
  deviceSyncLocalBaseUrl: string
  linqLocalWebhookUrl: string
}): SetupWizardPublicUrlTarget[] {
  const targets: SetupWizardPublicUrlTarget[] = []

  if (input.wearables.includes('garmin')) {
    targets.push({
      label: 'Garmin callback',
      url: new URL('/oauth/garmin/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if Garmin finishes sign-in on your machine through a tunnel.',
    })
  }

  if (input.wearables.includes('whoop')) {
    targets.push({
      label: 'WHOOP callback',
      url: new URL('/oauth/whoop/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if WHOOP sends the callback directly to your machine through a tunnel.',
    })
    targets.push({
      label: 'WHOOP webhook',
      url: new URL('/webhooks/whoop', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if WHOOP sends webhooks straight to your machine through a tunnel.',
    })
  }

  if (input.wearables.includes('oura')) {
    targets.push({
      label: 'Oura callback',
      url: new URL('/oauth/oura/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if Oura finishes sign-in on your machine through a tunnel.',
    })
    targets.push({
      label: 'Oura webhook',
      url: new URL('/webhooks/oura', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Optional today. Oura can still work without this, but this is the local webhook URL if you enable it.',
    })
  }

  if (input.hasLinq) {
    targets.push({
      label: 'Linq webhook',
      url: input.linqLocalWebhookUrl,
      detail: 'Point your tunnel here. Hosted `apps/web` does not replace this Linq webhook yet.',
    })
  }

  return targets
}

function normalizeSetupWizardText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
