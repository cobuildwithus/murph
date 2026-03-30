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

const setupWizardAssistantOptions: readonly SetupWizardAssistantOption[] = [
  {
    preset: 'codex-cli',
    title: 'Codex CLI',
    description: 'Best default when you want hosted models and the saved Codex flow.',
  },
  {
    preset: 'codex-oss',
    title: 'Codex OSS / local model',
    description: 'Keep the Codex path, but point the default at a local OSS model.',
  },
  {
    preset: 'openai-compatible',
    title: 'OpenAI-compatible endpoint',
    description: 'Use Ollama, a local gateway, LM Studio, or a hosted compatible API.',
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
    const wideLayout = (process.stderr.columns ?? 0) >= 108

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

    const selectionSteps: Record<
      SetupWizardSelectionStep,
      SetupWizardSelectionConfig
    > = {
      assistant: {
        lines: setupWizardAssistantOptions.map((option, index) => ({
          active: index === assistantIndex,
          badges: buildSetupWizardAssistantBadges({
            currentPreset: initialAssistantPreset,
            preset: option.preset,
          }),
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
        stepIntro:
          'Choose the default model and auth path Murph should save into operator defaults.',
        toggleCurrent: () => {
          const activePreset = setupWizardAssistantOptions[assistantIndex]?.preset
          if (activePreset) {
            setSelectedAssistantPreset(activePreset)
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
        previousStep: 'assistant',
        selectCurrentOnEnter: false,
        setIndex: setScheduledUpdateIndex,
        step: 'scheduled-updates',
        stepIntro:
          'Keep or trim the starter automation bundle. These remain recommendations here and are installed later once you choose a delivery route.',
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
        stepIntro:
          'Pick the chat lanes you want live first. Missing tokens can be entered for this run or left for later.',
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
        stepIntro:
          'Select the health data sources you want next. Ready items can open their connect flows after setup finishes.',
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
    ]
    const hintRow = createSetupWizardHintRow(
      resolveSetupWizardHints({
        commandName,
        selectionMarker: selectionStep?.marker,
        step,
      }),
    )
    const stepper = createSetupWizardStepper({
      includePublicUrlStep,
      step,
    })
    const snapshotPanel = createSetupWizardPanel({
      title: 'Snapshot',
      tone: 'accent',
      children: [
        createSetupWizardKeyValueRow({ label: 'Vault', value: input.vault }, 'vault'),
        createSetupWizardKeyValueRow(
          { label: 'Assistant', value: assistantSummary },
          'assistant',
        ),
        createSetupWizardKeyValueRow(
          {
            label: 'Channels',
            value: formatCompactSelectionSummary(selectedChannelNames),
          },
          'channels',
        ),
        createSetupWizardKeyValueRow(
          {
            label: 'Wearables',
            value: formatCompactSelectionSummary(selectedWearableNames),
          },
          'wearables',
        ),
        createSetupWizardKeyValueRow(
          {
            label: 'Schedules',
            value: formatCompactSelectionSummary(selectedScheduledUpdateNames),
          },
          'schedules',
        ),
        createSetupWizardKeyValueRow(
          {
            label: 'Ready now',
            value: formatCompactSelectionSummary(selectedReadyNow),
          },
          'ready-now',
        ),
        createSetupWizardKeyValueRow(
          {
            label: 'Needs env',
            value: formatCompactSelectionSummary(selectedNeedsEnv),
          },
          'needs-env',
        ),
        publicUrlReview.enabled
          ? createSetupWizardKeyValueRow(
              {
                label: 'Ingress',
                value: formatSetupPublicUrlStrategy(
                  publicUrlReview.recommendedStrategy,
                ),
              },
              'ingress',
            )
          : null,
      ],
    })

    const confirmNextStep = describeSetupWizardReviewNextStep({
      needsEnv: selectedNeedsEnv.length > 0,
      hasScheduledUpdates: selectedScheduledUpdates.length > 0,
    })

    const mainPanel =
      step === 'intro'
        ? createSetupWizardPanel({
            title: 'Start here',
            tone: 'accent',
            children: [
              createElement(
                Text,
                null,
                'Pick the assistant default, trim the starter automations, choose the first live channels, and queue any wearable connects in one pass.',
              ),
              createElement(Text, null, ''),
              createSetupWizardBulletRow(
                {
                  body: 'Save the model and auth path Murph should reach for by default.',
                  label: 'Assistant + auth',
                  tone: 'accent',
                },
                'intro-assistant',
              ),
              createSetupWizardBulletRow(
                {
                  body: 'Keep or drop the recommended update bundle without installing cron jobs yet.',
                  label: 'Starter schedules',
                  tone: 'warn',
                },
                'intro-schedules',
              ),
              createSetupWizardBulletRow(
                {
                  body: 'Turn on the channels and wearables you want Murph to wire up next.',
                  label: 'Channels + wearables',
                  tone: 'success',
                },
                'intro-integrations',
              ),
              createElement(Text, null, ''),
              createSetupWizardBulletRow(
                {
                  body: SETUP_RUNTIME_ENV_NOTICE,
                  label: 'Run-only environment',
                  tone: 'accent',
                },
                'intro-env',
              ),
              createSetupWizardBulletRow(
                {
                  body: 'Missing credentials can be entered after review for this run only, or left for later.',
                  label: 'No lock-in',
                  tone: 'muted',
                },
                'intro-lock-in',
              ),
            ],
          })
        : selectionStep
          ? createSetupWizardPanel({
              title: formatSetupWizardStepTitle(
                selectionStep.step,
                includePublicUrlStep,
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
                title: formatSetupWizardStepTitle('public-url', includePublicUrlStep),
                tone: 'accent',
                children: [
                  createElement(Text, null, publicUrlReview.summary),
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: publicUrlGuidance ?? '',
                      label: `Recommended: ${formatSetupPublicUrlStrategy(
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
                    'Local targets',
                  ),
                  createElement(Text, null, ''),
                  ...publicUrlReview.targets.map((target) =>
                    createSetupWizardPublicUrlTargetRow(target),
                  ),
                  createElement(Text, null, ''),
                  createElement(
                    Text,
                    { color: resolveSetupWizardToneColor('muted') },
                    'Info only — Murph does not save a public URL mode yet.',
                  ),
                ],
              })
            : createSetupWizardPanel({
                title: formatSetupWizardStepTitle('confirm', includePublicUrlStep),
                tone: 'accent',
                children: [
                  createSetupWizardKeyValueRow(
                    { label: 'Assistant', value: assistantSummary },
                    'confirm-assistant',
                  ),
                  createSetupWizardKeyValueRow(
                    { label: 'Channels', value: selectedChannelSummary },
                    'confirm-channels',
                  ),
                  createSetupWizardKeyValueRow(
                    { label: 'Wearables', value: selectedWearableSummary },
                    'confirm-wearables',
                  ),
                  createSetupWizardKeyValueRow(
                    {
                      label: 'Schedules',
                      value: selectedScheduledUpdateSummary,
                    },
                    'confirm-schedules',
                  ),
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: formatSelectionSummary(selectedReadyNow),
                      label: 'Ready now',
                      tone: 'success',
                    },
                    'confirm-ready',
                  ),
                  createSetupWizardBulletRow(
                    {
                      body: formatSelectionSummary(selectedNeedsEnv),
                      label: 'Needs env',
                      tone:
                        selectedNeedsEnv.length > 0 ? 'warn' : 'muted',
                    },
                    'confirm-needs-env',
                  ),
                  publicUrlGuidance
                    ? createSetupWizardBulletRow(
                        {
                          body: publicUrlGuidance,
                          label: 'Public ingress',
                          tone: 'accent',
                        },
                        'confirm-public-url',
                      )
                    : null,
                  createElement(Text, null, ''),
                  createSetupWizardBulletRow(
                    {
                      body: confirmNextStep,
                      label: 'After you continue',
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
        'Cleaner onboarding, better hierarchy, and less copy between you and a working local health assistant.',
      ),
      createElement(Text, null, ''),
      stepper,
      createElement(Text, null, ''),
      createElement(
        Box,
        {
          flexDirection: wideLayout ? 'row' : 'column',
          alignItems: 'flex-start',
        },
        createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            marginRight: wideLayout ? 2 : 0,
          },
          mainPanel,
        ),
        createElement(
          Box,
          {
            flexDirection: 'column',
            marginTop: wideLayout ? 0 : 1,
            width: wideLayout ? 36 : undefined,
          },
          snapshotPanel,
        ),
      ),
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

function formatCompactSelectionSummary(values: readonly string[]): string {
  if (values.length === 0) {
    return 'none'
  }

  if (values.length <= 2) {
    return values.join(', ')
  }

  return `${values.slice(0, 2).join(', ')} +${values.length - 2}`
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
      return 'Start'
    case 'assistant':
      return 'Assistant'
    case 'scheduled-updates':
      return 'Schedules'
    case 'channels':
      return 'Channels'
    case 'wearables':
      return 'Wearables'
    case 'public-url':
      return 'Public ingress'
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
  return `${index + 1}/${steps.length} · ${formatSetupWizardStepLabel(step)}`
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
  if (!status.ready && status.missingEnv.length > 0) {
    return `Needs ${formatMissingEnv(status.missingEnv)} in the current environment.`
  }

  return status.detail
}

function buildSetupWizardAssistantBadges(input: {
  currentPreset: SetupAssistantPreset
  preset: SetupAssistantPreset
}): SetupWizardInlineBadge[] {
  const badges: SetupWizardInlineBadge[] = []

  switch (input.preset) {
    case 'codex-cli':
      badges.push({ label: 'recommended', tone: 'success' })
      break
    case 'codex-oss':
      badges.push({ label: 'local model', tone: 'accent' })
      break
    case 'openai-compatible':
      badges.push({ label: 'gateway/api', tone: 'accent' })
      break
    case 'skip':
      badges.push({ label: 'no change', tone: 'muted' })
      break
  }

  if (input.currentPreset === input.preset) {
    badges.push({ label: 'current', tone: 'accent' })
  }

  return badges
}

function buildSetupWizardScheduledUpdateBadges(input: {
  isStarter: boolean
}): SetupWizardInlineBadge[] {
  return [
    ...(input.isStarter ? [{ label: 'starter', tone: 'accent' as const }] : []),
    { label: 'install later', tone: 'muted' },
  ]
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

function createSetupWizardStepper(input: {
  includePublicUrlStep: boolean
  step: SetupWizardStep
}): React.ReactElement {
  const createElement = React.createElement
  const steps = listSetupWizardSteps(input.includePublicUrlStep)
  const currentIndex = steps.indexOf(input.step)
  const children: React.ReactNode[] = []

  for (const [index, wizardStep] of steps.entries()) {
    if (index > 0) {
      children.push(
        createElement(
          Text,
          {
            color: resolveSetupWizardToneColor('muted'),
            key: `${wizardStep}:separator`,
          },
          '  ·  ',
        ),
      )
    }

    const tone: SetupWizardTone =
      index < currentIndex ? 'success' : index === currentIndex ? 'accent' : 'muted'
    const prefix =
      index < currentIndex
        ? '✓'
        : index === currentIndex
          ? '→'
          : `${index + 1}.`

    children.push(
      createElement(
        Text,
        {
          bold: index === currentIndex,
          color: resolveSetupWizardToneColor(tone),
          key: wizardStep,
        },
        `${prefix} ${formatSetupWizardStepLabel(wizardStep)}`,
      ),
    )
  }

  return createElement(Text, null, ...children)
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
    case 'assistant':
    case 'scheduled-updates':
    case 'channels':
    case 'wearables':
      return [
        { label: '↑/↓ move', tone: 'muted' },
        {
          label: input.selectionMarker === 'radio' ? 'Space select' : 'Space toggle',
          tone: 'accent',
        },
        { label: 'Enter continue', tone: 'success' },
        { label: 'Esc back', tone: 'muted' },
        { label: 'q quit', tone: 'muted' },
      ]
    case 'public-url':
      return [
        { label: 'Enter continue', tone: 'success' },
        { label: 'Esc back', tone: 'muted' },
        { label: 'q quit', tone: 'muted' },
      ]
    case 'confirm':
      return [
        { label: 'Enter run setup', tone: 'success' },
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
    return 'Murph will collect any missing runtime env, finish setup, keep the selected schedules ready for later install, and open wearable connect flows that are already ready.'
  }

  if (input.needsEnv) {
    return 'Murph will collect any missing runtime env, finish setup, and open wearable connect flows that are already ready.'
  }

  if (input.hasScheduledUpdates) {
    return 'Murph will finish setup, keep the selected schedules ready for later install, and open wearable connect flows that are already ready.'
  }

  return 'Murph will finish setup and open any wearable connect flows that are already ready.'
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
