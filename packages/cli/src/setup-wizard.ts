import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import { listAssistantCronPresets } from './assistant/cron/presets.js'
import { getDefaultSetupAssistantPreset as getDefaultAssistantPreset } from './setup-assistant.js'
import {
  type SetupAssistantPreset,
  type SetupChannel,
  type SetupWearable,
  setupChannelValues,
  setupWearableValues,
} from './setup-cli-contracts.js'
import {
  SETUP_RUNTIME_ENV_NOTICE,
  type SetupWizardRuntimeStatus,
} from './setup-runtime-env.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface SetupWizardResult {
  assistantPreset?: SetupAssistantPreset
  channels: SetupChannel[]
  scheduledUpdates: string[]
  wearables: SetupWearable[]
}

export interface SetupWizardInput {
  channelStatuses?: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
  commandName?: string
  deviceSyncLocalBaseUrl?: string | null
  initialAssistantPreset?: SetupAssistantPreset
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

interface SetupWizardAssistantOption {
  description: string
  preset: SetupAssistantPreset
  title: string
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
  | 'assistant'
  | 'scheduled-updates'
  | 'channels'
  | 'wearables'
  | 'public-url'
  | 'confirm'

type SetupWizardFlowStep = Exclude<SetupWizardStep, 'intro'>
type SetupWizardSelectionStep = Extract<
  SetupWizardFlowStep,
  'assistant' | 'scheduled-updates' | 'channels' | 'wearables'
>

const DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL = 'http://127.0.0.1:8788'
const DEFAULT_SETUP_LINQ_WEBHOOK_URL = 'http://127.0.0.1:8789/linq-webhook'

const setupWizardAssistantOptions: readonly SetupWizardAssistantOption[] = [
  {
    preset: 'codex-cli',
    title: 'Codex CLI',
    description: 'Hosted-model Codex flow with a saved default like gpt-5.4.',
  },
  {
    preset: 'codex-oss',
    title: 'Codex OSS / local model',
    description: 'Keep the Codex CLI path, but default it to a local OSS model.',
  },
  {
    preset: 'openai-compatible',
    title: 'OpenAI-compatible endpoint',
    description: 'Save one base URL for Ollama, a local gateway, or a hosted API.',
  },
  {
    preset: 'skip',
    title: 'Skip for now',
    description: 'Leave the current assistant backend unchanged.',
  },
]

const setupWizardChannelOptions: readonly SetupWizardChannelOption[] = [
  {
    channel: 'imessage',
    description: 'Messages.app auto-reply on macOS.',
    title: 'iMessage',
  },
  {
    channel: 'telegram',
    description: 'Telegram bot auto-reply.',
    title: 'Telegram',
  },
  {
    channel: 'linq',
    description: 'Linq iMessage/SMS/RCS auto-reply via webhook.',
    title: 'Linq',
  },
  {
    channel: 'email',
    description: 'AgentMail inbox plus email auto-reply.',
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
    description: 'OAuth connect plus scheduled sync.',
    title: 'Oura',
    wearable: 'oura',
  },
  {
    description: 'OAuth connect plus ongoing sync.',
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
  const initialScheduledUpdates = sortSetupWizardScheduledUpdates(
    input.initialScheduledUpdates && input.initialScheduledUpdates.length > 0
      ? [...input.initialScheduledUpdates]
      : getDefaultSetupWizardScheduledUpdates(),
  )
  const initialWearables = sortSetupWizardWearables(
    input.initialWearables && input.initialWearables.length > 0
      ? [...input.initialWearables]
      : getDefaultSetupWizardWearables(),
  )
  const commandName = input.commandName ?? 'murph'
  const completion = createSetupWizardCompletionController()

  let instance:
    | {
        unmount: () => void
        waitUntilExit: () => Promise<unknown>
      }
    | null = null

  const App = (): React.ReactElement => {
    const createElement = React.createElement
    const { exit } = useApp()
    const [step, setStep] = React.useState<SetupWizardStep>('intro')
    const [assistantIndex, setAssistantIndex] = React.useState(
      findSetupWizardAssistantOptionIndex(initialAssistantPreset),
    )
    const [scheduledUpdateIndex, setScheduledUpdateIndex] = React.useState(0)
    const [channelIndex, setChannelIndex] = React.useState(0)
    const [wearableIndex, setWearableIndex] = React.useState(0)
    const [selectedAssistantPreset, setSelectedAssistantPreset] =
      React.useState<SetupAssistantPreset>(initialAssistantPreset)
    const [selectedChannels, setSelectedChannels] = React.useState<SetupChannel[]>(
      initialChannels,
    )
    const [selectedScheduledUpdates, setSelectedScheduledUpdates] =
      React.useState<string[]>(initialScheduledUpdates)
    const [selectedWearables, setSelectedWearables] = React.useState<SetupWearable[]>(
      initialWearables,
    )
    const latestAssistantRef = React.useRef<SetupAssistantPreset>(
      initialAssistantPreset,
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
    const publicUrlGuidance = publicUrlReview.enabled
      ? describeSetupWizardPublicUrlStrategyChoice({
          review: publicUrlReview,
          strategy: publicUrlReview.recommendedStrategy,
        })
      : null

    React.useEffect(() => {
      latestAssistantRef.current = selectedAssistantPreset
    }, [selectedAssistantPreset])

    React.useEffect(() => {
      latestChannelsRef.current = selectedChannels
    }, [selectedChannels])

    React.useEffect(() => {
      latestScheduledUpdatesRef.current = selectedScheduledUpdates
    }, [selectedScheduledUpdates])

    React.useEffect(() => {
      latestWearablesRef.current = selectedWearables
    }, [selectedWearables])

    type SetupWizardSelectionLine = {
      active: boolean
      description: string
      key: string
      selected: boolean
      title: string
    }

    type SetupWizardSelectionConfig = {
      instructions: string
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

    const selectionSteps: Record<
      SetupWizardSelectionStep,
      SetupWizardSelectionConfig
    > = {
      assistant: {
        instructions:
          'Use ↑/↓ to move, Space to select, Enter to continue, or Esc to go back.',
        lines: setupWizardAssistantOptions.map((option, index) => ({
          active: index === assistantIndex,
          description: option.description,
          key: option.preset,
          selected: option.preset === selectedAssistantPreset,
          title: option.title,
        })),
        marker: 'radio',
        nextStep: 'scheduled-updates',
        previousStep: 'intro',
        selectCurrentOnEnter: true,
        setIndex: setAssistantIndex,
        step: 'assistant',
        toggleCurrent: () => {
          const activePreset = setupWizardAssistantOptions[assistantIndex]?.preset
          if (activePreset) {
            setSelectedAssistantPreset(activePreset)
          }
        },
      },
      'scheduled-updates': {
        instructions:
          'Use ↑/↓ to move, Space to toggle, Enter to continue, or Esc to go back.',
        lines: setupWizardScheduledUpdateOptions.map((option, index) => ({
          active: index === scheduledUpdateIndex,
          description: option.description,
          key: option.id,
          selected: selectedScheduledUpdates.includes(option.id),
          title: `${option.title} · ${option.scheduleLabel}`,
        })),
        marker: 'checkbox',
        nextStep: 'channels',
        previousStep: 'assistant',
        selectCurrentOnEnter: false,
        setIndex: setScheduledUpdateIndex,
        step: 'scheduled-updates',
        stepIntro:
          'Two broad starter updates are selected by default. Onboarding will not install them automatically because cron jobs now require an explicit outbound destination; use this screen to review what you may want to install later with `assistant cron preset install --channel ...`.',
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
        instructions:
          'Use ↑/↓ to move, Space to toggle, Enter to continue, or Esc to go back.',
        lines: setupWizardChannelOptions.map((option, index) => {
          const status = getChannelStatus(option.channel)
          return {
            active: index === channelIndex,
            description: `${option.description} ${status.detail}`.trim(),
            key: option.channel,
            selected: selectedChannels.includes(option.channel),
            title: `${option.title} · ${status.badge}`,
          }
        }),
        marker: 'checkbox',
        nextStep: 'wearables',
        previousStep: 'scheduled-updates',
        selectCurrentOnEnter: false,
        setIndex: setChannelIndex,
        step: 'channels',
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
        instructions:
          'Use ↑/↓ to move, Space to toggle, Enter to continue, or Esc to go back.',
        lines: setupWizardWearableOptions.map((option, index) => {
          const status = getWearableStatus(option.wearable)
          return {
            active: index === wearableIndex,
            description: `${option.description} ${status.detail}`.trim(),
            key: option.wearable,
            selected: selectedWearables.includes(option.wearable),
            title: `${option.title} · ${status.badge}`,
          }
        }),
        marker: 'checkbox',
        nextStep: includePublicUrlStep ? 'public-url' : 'confirm',
        previousStep: 'channels',
        selectCurrentOnEnter: false,
        setIndex: setWearableIndex,
        step: 'wearables',
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
          setStep('assistant')
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
            assistantPreset: latestAssistantRef.current,
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

    const assistantSummary = formatSetupAssistantPreset(selectedAssistantPreset)
    const selectedChannelSummary = formatSelectionSummary(
      selectedChannels.map((channel) => formatSetupChannel(channel)),
    )
    const selectedScheduledUpdateSummary = formatSelectionSummary(
      selectedScheduledUpdates.map((presetId) =>
        formatSetupScheduledUpdate(presetId),
      ),
    )
    const selectedWearableSummary = formatSelectionSummary(
      selectedWearables.map((wearable) => formatSetupWearable(wearable)),
    )
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
    ]

    const selectionStepLines =
      selectionStep?.lines.map((line) =>
        createElement(
          Box,
          {
            flexDirection: 'column',
            key: line.key,
            marginBottom: 1,
          },
          createElement(
            Text,
            null,
            `${line.active ? '>' : ' '} ${
              selectionStep.marker === 'checkbox'
                ? line.selected
                  ? '[x]'
                  : '[ ]'
                : line.selected
                  ? '(x)'
                  : '( )'
            } ${line.title}`,
          ),
          createElement(Text, null, `    ${line.description}`),
        ),
      ) ?? []

    const publicUrlTargetLines = publicUrlReview.targets.flatMap((target) => [
      createElement(Text, { key: `${target.label}:url` }, `${target.label}: ${target.url}`),
      createElement(Text, { key: `${target.label}:detail` }, `    ${target.detail}`),
    ])

    return createElement(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 1,
      },
      createElement(Text, null, 'Murph onboarding'),
      createElement(Text, null, formatSetupWizardStepper(step, includePublicUrlStep)),
      createElement(Text, null, ''),
      createElement(Text, null, `Vault: ${input.vault}`),
      createElement(Text, null, `Assistant: ${assistantSummary}`),
      createElement(Text, null, `Schedules: ${selectedScheduledUpdateSummary}`),
      createElement(Text, null, `Channels: ${selectedChannelSummary}`),
      createElement(Text, null, `Wearables: ${selectedWearableSummary}`),
      createElement(Text, null, ''),
      step === 'intro'
        ? createElement(
            Box,
            { flexDirection: 'column' },
            createElement(
              Text,
              null,
              'Set your default assistant, review a small starter bundle of scheduled-update presets, choose message channels, and optionally connect wearables in the same onboarding flow.',
            ),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              'The next screens highlight preset-backed scheduled updates like weekly health compass summaries, environment checks, ingestible watchlists, and research roundups. Cron jobs now require an explicit outbound destination, so onboarding leaves these for later installation with `assistant cron preset install --channel ...`.',
            ),
            createElement(Text, null, ''),
            createElement(Text, null, SETUP_RUNTIME_ENV_NOTICE),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              'Missing credentials can be entered after review for this run only, or left for later.',
            ),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              `Press Enter to continue with ${commandName}, or q to cancel.`,
            ),
          )
        : null,
      selectionStep
        ? createElement(
            Box,
            { flexDirection: 'column' },
            createElement(
              Text,
              null,
              formatSetupWizardStepTitle(selectionStep.step, includePublicUrlStep),
            ),
            createElement(Text, null, ''),
            selectionStep.stepIntro
              ? createElement(Text, null, selectionStep.stepIntro)
              : null,
            selectionStep.stepIntro ? createElement(Text, null, '') : null,
            ...selectionStepLines,
            createElement(Text, null, selectionStep.instructions),
          )
        : null,
      step === 'public-url'
        ? createElement(
            Box,
            { flexDirection: 'column' },
            createElement(
              Text,
              null,
              formatSetupWizardStepTitle('public-url', includePublicUrlStep),
            ),
            createElement(Text, null, ''),
            createElement(Text, null, publicUrlReview.summary),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              `Recommended starting point: ${formatSetupPublicUrlStrategy(publicUrlReview.recommendedStrategy)}`,
            ),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              publicUrlReview.recommendedStrategy === 'hosted'
                ? 'Hosted app first keeps WHOOP/Oura callbacks and webhook ingress on the hosted `apps/web` surface, which is the easier stable base when you need public device-sync ingress.'
                : 'Tunnel first keeps ingress local and exposes callback or webhook routes through a tunnel, which is the recommended starting point for Linq today.',
            ),
            createElement(Text, null, ''),
            createElement(Text, null, 'Local targets for tunnel mode or smoke tests:'),
            createElement(Text, null, ''),
            ...publicUrlTargetLines,
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              'This screen is informational only. Murph does not save a public URL mode yet.',
            ),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              'Press Enter to continue, or Esc to go back.',
            ),
          )
        : null,
      step === 'confirm'
        ? createElement(
            Box,
            { flexDirection: 'column' },
            createElement(
              Text,
              null,
              formatSetupWizardStepTitle('confirm', includePublicUrlStep),
            ),
            createElement(Text, null, ''),
            createElement(Text, null, `Ready now: ${formatSelectionSummary(selectedReadyNow)}`),
            createElement(
              Text,
              null,
              `Still needs env: ${formatSelectionSummary(selectedNeedsEnv)}`,
            ),
            createElement(
              Text,
              null,
              `Scheduled updates: ${selectedScheduledUpdateSummary}`,
            ),
            publicUrlGuidance
              ? createElement(Text, null, `Public URL note: ${publicUrlGuidance}`)
              : null,
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              selectedNeedsEnv.length > 0
                ? selectedScheduledUpdates.length > 0
                  ? 'Murph will prompt for missing runtime credentials next, then finish setup, leave the selected scheduled updates for explicit later installation, and open any ready wearable connect flows.'
                  : 'Murph will prompt for missing runtime credentials next, then finish setup and open any ready wearable connect flows.'
                : selectedScheduledUpdates.length > 0
                  ? 'Murph will finish setup, leave the selected scheduled updates for explicit later installation, and open any selected wearable connect flows that are ready.'
                  : 'Murph will finish setup and open any selected wearable connect flows that are ready.',
            ),
            createElement(Text, null, ''),
            createElement(
              Text,
              null,
              'Press Enter to run setup, or Esc to change the selection.',
            ),
          )
        : null,
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

function findSetupWizardAssistantOptionIndex(
  preset: SetupAssistantPreset,
): number {
  const index = setupWizardAssistantOptions.findIndex(
    (option) => option.preset === preset,
  )
  return index >= 0 ? index : 0
}

function formatSetupAssistantPreset(preset: SetupAssistantPreset): string {
  switch (preset) {
    case 'codex-cli':
      return 'Codex CLI'
    case 'codex-oss':
      return 'Codex OSS / local model'
    case 'openai-compatible':
      return 'OpenAI-compatible endpoint'
    case 'skip':
      return 'Skip for now'
  }
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
  return wearable === 'oura' ? 'Oura' : 'WHOOP'
}

function formatSetupScheduledUpdate(presetId: string): string {
  return (
    setupWizardScheduledUpdateOptions.find((option) => option.id === presetId)?.title ??
    presetId
  )
}

function formatSelectionSummary(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none'
}

function formatMissingEnv(values: readonly string[]): string {
  if (values.length === 0) {
    return 'none'
  }

  if (values.length === 1) {
    return values[0] ?? ''
  }

  return values.join(' + ')
}

function formatSetupPublicUrlStrategy(strategy: SetupPublicUrlStrategy): string {
  return strategy === 'hosted' ? 'Hosted app first' : 'Tunnel first'
}

function formatSetupWizardStepLabel(step: SetupWizardStep): string {
  switch (step) {
    case 'intro':
      return 'Intro'
    case 'assistant':
      return 'Assistant'
    case 'scheduled-updates':
      return 'Schedules'
    case 'channels':
      return 'Channels'
    case 'wearables':
      return 'Wearables'
    case 'public-url':
      return 'Public URL'
    case 'confirm':
      return 'Review'
  }
}

function listSetupWizardSteps(includePublicUrlStep: boolean): SetupWizardStep[] {
  return includePublicUrlStep
    ? [
        'intro',
        'assistant',
        'scheduled-updates',
        'channels',
        'wearables',
        'public-url',
        'confirm',
      ]
    : ['intro', 'assistant', 'scheduled-updates', 'channels', 'wearables', 'confirm']
}

function listSetupWizardFlowSteps(
  includePublicUrlStep: boolean,
): Array<Exclude<SetupWizardStep, 'intro'>> {
  return includePublicUrlStep
    ? ['assistant', 'scheduled-updates', 'channels', 'wearables', 'public-url', 'confirm']
    : ['assistant', 'scheduled-updates', 'channels', 'wearables', 'confirm']
}

function formatSetupWizardStepTitle(
  step: Exclude<SetupWizardStep, 'intro'>,
  includePublicUrlStep: boolean,
): string {
  const steps = listSetupWizardFlowSteps(includePublicUrlStep)
  const index = steps.indexOf(step)
  return `${index + 1} of ${steps.length} · ${formatSetupWizardStepLabel(step)}`
}

function formatSetupWizardStepper(
  step: SetupWizardStep,
  includePublicUrlStep: boolean,
): string {
  const steps = listSetupWizardSteps(includePublicUrlStep)
  const currentIndex = steps.indexOf(step)

  return steps
    .map((wizardStep, index) =>
      index === currentIndex
        ? `[${formatSetupWizardStepLabel(wizardStep)}]`
        : `${index + 1}.${formatSetupWizardStepLabel(wizardStep)}`,
    )
    .join('  ')
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
      ? 'Use hosted `apps/web` for WHOOP/Oura, but keep Linq on the local webhook path until a hosted Linq bridge exists.'
      : 'Use hosted `apps/web` for WHOOP/Oura so callbacks and webhooks stay on one stable public base.'
  }

  const hasWearableTargets = input.review.targets.some((target) =>
    target.label.startsWith('WHOOP') || target.label.startsWith('Oura'),
  )
  if (hasWearableTargets) {
    return 'Expose the local callback and webhook routes through a tunnel instead of deploying hosted ingress first.'
  }

  return 'Expose the local Linq webhook through a tunnel. Murph does not provide a hosted Linq ingress yet.'
}

function describeSetupWizardPublicUrlSummary(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
}): string {
  if (input.wearables.length > 0 && input.hasLinq) {
    return 'WHOOP/Oura are easiest behind hosted `apps/web`, while Linq still expects the local inbox webhook today.'
  }

  if (input.wearables.length > 0) {
    return 'WHOOP/Oura can use either hosted `apps/web` or a local tunnel. Hosted mode is the easier stable callback base.'
  }

  return 'Linq still uses the local inbox webhook today, so tunnel mode is the recommended public path.'
}

function buildSetupWizardPublicUrlTargets(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
  deviceSyncLocalBaseUrl: string
  linqLocalWebhookUrl: string
}): SetupWizardPublicUrlTarget[] {
  const targets: SetupWizardPublicUrlTarget[] = []

  if (input.wearables.includes('whoop')) {
    targets.push({
      label: 'WHOOP callback',
      url: new URL('/oauth/whoop/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this local callback path when you keep WHOOP ingress on the local daemon.',
    })
    targets.push({
      label: 'WHOOP webhook',
      url: new URL('/webhooks/whoop', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this local webhook path if WHOOP posts directly to your machine through a tunnel.',
    })
  }

  if (input.wearables.includes('oura')) {
    targets.push({
      label: 'Oura callback',
      url: new URL('/oauth/oura/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this local callback path when you keep Oura OAuth completion on the local daemon.',
    })
    targets.push({
      label: 'Oura webhook',
      url: new URL('/webhooks/oura', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Optional today. Oura still works in polling-first mode, but this is the local webhook target if you enable it.',
    })
  }

  if (input.hasLinq) {
    targets.push({
      label: 'Linq webhook',
      url: input.linqLocalWebhookUrl,
      detail: 'Point Linq here through a tunnel. Hosted `apps/web` does not replace this inbox webhook path yet.',
    })
  }

  return targets
}

function normalizeSetupWizardText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
