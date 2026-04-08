import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import {
  type SetupAssistantPreset,
  type SetupAssistantProviderPreset,
  type SetupChannel,
  type SetupWearable,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  SETUP_RUNTIME_ENV_NOTICE,
  type SetupWizardRuntimeStatus,
} from '@murphai/operator-config/setup-runtime-env'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  getDefaultSetupWizardAssistantPreset,
  buildSetupWizardAssistantMethodBadges,
  buildSetupWizardAssistantProviderBadges,
  doesSetupWizardAssistantProviderRequireMethod,
  findSetupWizardAssistantMethodIndex,
  findSetupWizardAssistantProviderIndex,
  inferSetupWizardAssistantMethod,
  inferSetupWizardAssistantProvider,
  listSetupWizardAssistantMethodOptions,
  listSetupWizardAssistantProviderOptions,
  resolveSetupWizardAssistantMethodForProvider,
  resolveSetupWizardAssistantSelection,
  runSetupAssistantWizard,
  type SetupAssistantWizardInput,
  type SetupAssistantWizardResult,
  type SetupWizardAssistantMethod,
  type SetupWizardAssistantProvider,
  type SetupWizardResolvedAssistantSelection,
} from './setup-assistant-wizard.js'
import {
  createSetupWizardCompletionController as createGenericSetupWizardCompletionController,
  wrapSetupWizardIndex,
  type SetupWizardCompletionController,
} from './setup-wizard-core.js'
import {
  createSetupWizardAnsweredBlock,
  createSetupWizardBulletRow,
  createSetupWizardHintRow,
  createSetupWizardKeyValueRow,
  createSetupWizardPanel,
  createSetupWizardPublicUrlTargetRow,
  createSetupWizardSelectionRow,
  resolveSetupWizardToneColor,
  type SetupWizardSelectionLine,
} from './setup-wizard-ui.js'
import {
  buildSetupWizardPublicUrlReview,
  describeSetupWizardPublicUrlStrategyChoice,
  formatSetupPublicUrlStrategy,
  normalizeSetupWizardText,
  type SetupPublicUrlStrategy,
  type SetupWizardPublicUrlReview,
} from './setup-wizard-public-url.js'
import {
  buildSetupWizardScheduledUpdateBadges,
  describeSetupWizardReviewNextStep,
  formatMissingEnv,
  formatSelectionSummary,
  formatSetupWizardPromptTitle,
  formatSetupWizardRuntimeDetail,
  formatSetupWizardStepIntro,
  hasSetupWizardStepPassed,
  resolveSetupWizardHints,
  resolveSetupWizardRuntimeTone,
  type SetupWizardSelectionStep,
  type SetupWizardStep,
} from './setup-wizard-flow.js'
import {
  formatSetupChannel,
  formatSetupScheduledUpdate,
  formatSetupWearable,
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
  resolveSetupWizardInitialScheduledUpdates,
  setupWizardChannelOptions,
  setupWizardScheduledUpdateOptions,
  setupWizardWearableOptions,
  sortSetupWizardChannels,
  sortSetupWizardScheduledUpdates,
  sortSetupWizardWearables,
  toggleSetupWizardChannel,
  toggleSetupWizardScheduledUpdate,
  toggleSetupWizardWearable,
} from './setup-wizard-options.js'

export {
  getDefaultSetupWizardAssistantPreset,
  inferSetupWizardAssistantProvider,
  runSetupAssistantWizard,
  type SetupAssistantWizardInput,
  type SetupAssistantWizardResult,
  resolveSetupWizardAssistantSelection,
  type SetupWizardAssistantMethod,
  type SetupWizardAssistantProvider,
  type SetupWizardResolvedAssistantSelection,
} from './setup-assistant-wizard.js'
export { wrapSetupWizardIndex, type SetupWizardCompletionController } from './setup-wizard-core.js'
export {
  buildSetupWizardPublicUrlReview,
  describeSetupWizardPublicUrlStrategyChoice,
  type SetupPublicUrlStrategy,
  type SetupWizardPublicUrlReview,
  type SetupWizardPublicUrlTarget,
} from './setup-wizard-public-url.js'
export {
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
  resolveSetupWizardInitialScheduledUpdates,
  toggleSetupWizardChannel,
  toggleSetupWizardScheduledUpdate,
  toggleSetupWizardWearable,
} from './setup-wizard-options.js'

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

export function createSetupWizardCompletionController(): SetupWizardCompletionController<SetupWizardResult> {
  return createGenericSetupWizardCompletionController<SetupWizardResult>({
    unexpectedExitMessage: 'Murph setup wizard exited unexpectedly.',
  })
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
    const assistantProviderOptions = listSetupWizardAssistantProviderOptions()
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
        lines: assistantProviderOptions.map((option, index) => ({
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
          const activeProvider = assistantProviderOptions[assistantProviderIndex]?.provider
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
              assistantProviderOptions[assistantProviderIndex]?.provider ??
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
