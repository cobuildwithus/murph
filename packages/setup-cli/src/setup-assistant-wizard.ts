import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import {
  listNamedOpenAICompatibleProviderPresets,
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromId,
  type OpenAICompatibleProviderPreset,
} from '@murphai/assistant-engine/assistant-provider'
import {
  DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
  getDefaultSetupAssistantPreset as getDefaultAssistantPreset,
} from './setup-assistant.js'
import type {
  SetupAssistantPreset,
  SetupAssistantProviderPreset,
} from '@murphai/operator-config/setup-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createSetupWizardCompletionController,
  wrapSetupWizardIndex,
} from './setup-wizard-core.js'
import {
  createSetupWizardAnsweredBlock,
  createSetupWizardBulletRow,
  createSetupWizardHintRow,
  createSetupWizardKeyValueRow,
  createSetupWizardPanel,
  createSetupWizardSelectionRow,
  resolveSetupWizardToneColor,
  type SetupWizardHint,
  type SetupWizardInlineBadge,
  type SetupWizardSelectionLine,
} from './setup-wizard-ui.js'

export type SetupAssistantWizardResult = {
  assistantApiKeyEnv?: string | null
  assistantBaseUrl?: string | null
  assistantOss?: boolean | null
  assistantPreset?: Exclude<SetupAssistantPreset, 'skip'>
  assistantProviderName?: string | null
}

export interface SetupAssistantWizardInput {
  initialAssistantApiKeyEnv?: string | null
  initialAssistantBaseUrl?: string | null
  initialAssistantOss?: boolean | null
  initialAssistantPreset?: SetupAssistantPreset
  initialAssistantProviderPreset?: SetupAssistantProviderPreset | null
  initialAssistantProviderName?: string | null
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

const setupWizardOpenAIAssistantMethodOptions: readonly SetupWizardAssistantMethodOption[] =
  [
    {
      method: 'openai-codex',
      title: 'ChatGPT / Codex sign-in',
      description: 'Best if you already use the Codex sign-in flow.',
      detail:
        'Murph will use your saved Codex / ChatGPT login and ask which default model to use next.',
      badges: [{ label: 'recommended', tone: 'success' }],
    },
    {
      method: 'openai-api-key',
      title: 'OpenAI API key',
      description: 'Use OPENAI_API_KEY and choose a model.',
      detail: 'Good if you want direct API billing instead of the Codex sign-in path.',
    },
  ]

const setupWizardCompatibleAssistantMethodOptions: readonly SetupWizardAssistantMethodOption[] =
  [
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

export function getDefaultSetupWizardAssistantPreset(): SetupAssistantPreset {
  return getDefaultAssistantPreset()
}

export function listSetupWizardAssistantProviderOptions(): readonly SetupWizardAssistantProviderOption[] {
  return setupWizardAssistantProviderOptions
}

export function listSetupAssistantWizardProviderOptions(): readonly SetupWizardAssistantProviderOption[] {
  return setupWizardAssistantProviderOptions.filter(
    (option) => option.provider !== 'skip',
  )
}

export function findSetupWizardAssistantProviderIndex(
  provider: SetupWizardAssistantProvider,
): number {
  const index = setupWizardAssistantProviderOptions.findIndex(
    (option) => option.provider === provider,
  )
  return index >= 0 ? index : 0
}

export function findSetupAssistantWizardProviderIndex(
  provider: SetupWizardAssistantProvider,
): number {
  const index = listSetupAssistantWizardProviderOptions().findIndex(
    (option) => option.provider === provider,
  )
  return index >= 0 ? index : 0
}

export function findSetupWizardAssistantMethodIndex(
  provider: SetupWizardAssistantProvider,
  method: SetupWizardAssistantMethod,
): number {
  const options = listSetupWizardAssistantMethodOptions(provider)
  const index = options.findIndex((option) => option.method === method)
  return index >= 0 ? index : 0
}

export function normalizeSetupAssistantWizardProvider(
  provider: SetupWizardAssistantProvider,
): SetupWizardAssistantProvider {
  return provider === 'skip' ? 'openai' : provider
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

export function inferSetupWizardAssistantMethod(input: {
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

export function doesSetupWizardAssistantProviderRequireMethod(
  provider: SetupWizardAssistantProvider,
): boolean {
  return provider === 'openai' || provider === 'custom'
}

export function resolveSetupWizardAssistantMethodForProvider(input: {
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

export function listSetupWizardAssistantMethodOptions(
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
      detail:
        'Murph will use your saved Codex / ChatGPT sign-in and ask which default model to use next.',
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

  const preset =
    resolveOpenAICompatibleProviderPresetFromId(input.provider) ??
    resolveOpenAICompatibleProviderPresetFromId('custom')
  const apiKeyEnv =
    preservedSelection.apiKeyEnv ?? preset?.apiKeyEnv ?? null
  return {
    apiKeyEnv,
    baseUrl:
      preservedSelection.baseUrl ??
      preset?.baseUrl ??
      DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
    detail: buildSetupWizardNamedProviderSelectionDetail({
      apiKeyEnv,
      preset,
    }),
    methodLabel: null,
    oss: false,
    preset: 'openai-compatible',
    providerLabel: preset?.title ?? 'OpenAI-compatible provider',
    providerName: preservedSelection.providerName ?? preset?.providerName ?? null,
    summary: preset?.title ?? 'OpenAI-compatible provider',
  }
}

export function buildSetupWizardAssistantProviderBadges(input: {
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

export function buildSetupWizardAssistantMethodBadges(input: {
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

export async function runSetupAssistantWizard(
  input: SetupAssistantWizardInput,
): Promise<SetupAssistantWizardResult> {
  const initialAssistantPreset =
    input.initialAssistantPreset ?? getDefaultSetupWizardAssistantPreset()
  const completion =
    createSetupWizardCompletionController<SetupAssistantWizardResult>({
      unexpectedExitMessage: 'Murph assistant picker exited unexpectedly.',
    })

  let instance:
    | {
        unmount: () => void
        waitUntilExit: () => Promise<unknown>
      }
    | null = null

  const App = (): React.ReactElement => {
    const createElement = React.createElement
    const { exit } = useApp()
    const initialAssistantProvider = normalizeSetupAssistantWizardProvider(
      inferSetupWizardAssistantProvider({
        apiKeyEnv: input.initialAssistantApiKeyEnv,
        baseUrl: input.initialAssistantBaseUrl,
        oss: input.initialAssistantOss,
        preset: initialAssistantPreset,
        providerName: input.initialAssistantProviderName,
        providerPreset: input.initialAssistantProviderPreset,
      }),
    )
    const initialAssistantMethod = inferSetupWizardAssistantMethod({
      oss: input.initialAssistantOss,
      preset: initialAssistantPreset,
      provider: initialAssistantProvider,
    })
    const assistantProviderOptions = listSetupAssistantWizardProviderOptions()
    const [step, setStep] = React.useState<
      'assistant-provider' | 'assistant-method' | 'confirm'
    >('assistant-provider')
    const [assistantProviderIndex, setAssistantProviderIndex] = React.useState(
      findSetupAssistantWizardProviderIndex(initialAssistantProvider),
    )
    const [assistantMethodIndex, setAssistantMethodIndex] = React.useState(
      findSetupWizardAssistantMethodIndex(
        initialAssistantProvider,
        initialAssistantMethod,
      ),
    )
    const [selectedAssistantProvider, setSelectedAssistantProvider] =
      React.useState<SetupWizardAssistantProvider>(initialAssistantProvider)
    const [selectedAssistantMethod, setSelectedAssistantMethod] = React.useState<
      SetupWizardAssistantMethod
    >(initialAssistantMethod)
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
    const includeAssistantMethodStep = doesSetupWizardAssistantProviderRequireMethod(
      selectedAssistantProvider,
    )

    React.useEffect(() => {
      latestAssistantRef.current = assistantSelection
    }, [assistantSelection])

    React.useEffect(() => {
      setAssistantMethodIndex(
        findSetupWizardAssistantMethodIndex(
          selectedAssistantProvider,
          selectedAssistantMethod,
        ),
      )
    }, [selectedAssistantMethod, selectedAssistantProvider])

    type SetupAssistantWizardSelectionConfig = {
      lines: SetupWizardSelectionLine[]
      marker: 'radio'
      nextStep: 'assistant-method' | 'confirm'
      previousStep: 'assistant-provider' | 'assistant-method'
      setIndex: React.Dispatch<React.SetStateAction<number>>
      step: 'assistant-provider' | 'assistant-method'
      stepIntro?: string
      toggleCurrent: () => void
    }

    const assistantMethodOptions = listSetupWizardAssistantMethodOptions(
      selectedAssistantProvider,
    )
    const selectionSteps: Record<
      'assistant-provider' | 'assistant-method',
      SetupAssistantWizardSelectionConfig
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
        nextStep: includeAssistantMethodStep ? 'assistant-method' : 'confirm',
        previousStep: 'assistant-provider',
        setIndex: setAssistantProviderIndex,
        step: 'assistant-provider',
        stepIntro: formatSetupAssistantWizardStepIntro(
          'assistant-provider',
          selectedAssistantProvider,
        ),
        toggleCurrent: () => {
          const activeProvider =
            assistantProviderOptions[assistantProviderIndex]?.provider
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
        nextStep: 'confirm',
        previousStep: 'assistant-provider',
        setIndex: setAssistantMethodIndex,
        step: 'assistant-method',
        stepIntro: formatSetupAssistantWizardStepIntro(
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
    }

    const selectionStep = step === 'confirm' ? null : selectionSteps[step]

    useInput((value, key) => {
      if ((key.ctrl && value === 'c') || value.toLowerCase() === 'q') {
        completion.fail(
          new VaultCliError('setup_cancelled', 'Murph model selection was cancelled.'),
        )
        exit()
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
          if (selectionStep.step === 'assistant-provider') {
            completion.fail(
              new VaultCliError(
                'setup_cancelled',
                'Murph model selection was cancelled.',
              ),
            )
            exit()
            return
          }

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
                : 'confirm',
            )
            return
          }

          selectionStep.toggleCurrent()
          setStep(selectionStep.nextStep)
        }
        return
      }

      if (key.escape || key.leftArrow) {
        setStep(includeAssistantMethodStep ? 'assistant-method' : 'assistant-provider')
        return
      }

      if (key.return || value === ' ') {
        if (latestAssistantRef.current.preset === 'skip') {
          completion.fail(
            new VaultCliError(
              'invalid_option',
              'Assistant-only model selection must resolve to a saved backend.',
            ),
          )
          exit()
          return
        }

        completion.submit({
          assistantApiKeyEnv: latestAssistantRef.current.apiKeyEnv,
          assistantBaseUrl: latestAssistantRef.current.baseUrl,
          assistantOss: latestAssistantRef.current.oss,
          assistantPreset: latestAssistantRef.current.preset,
          assistantProviderName: latestAssistantRef.current.providerName,
        })
        exit()
      }
    })

    const completedBlocks: React.ReactElement[] = []

    if (step !== 'assistant-provider') {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupAssistantWizardPromptTitle(
              'assistant-provider',
              selectedAssistantProvider,
            ),
            value: assistantSelection.providerLabel,
          },
          'completed-assistant-provider',
        ),
      )
    }

    if (step === 'confirm' && includeAssistantMethodStep) {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupAssistantWizardPromptTitle(
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

    const activePanel = selectionStep
      ? createSetupWizardPanel({
          title: formatSetupAssistantWizardPromptTitle(
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
      : createSetupWizardPanel({
          title: 'Review',
          tone: 'accent',
          children: [
            createSetupWizardKeyValueRow(
              {
                label: 'Assistant',
                value: assistantSelection.summary,
              },
              'confirm-assistant',
            ),
            createSetupWizardBulletRow(
              {
                body: 'Murph will ask for any remaining model or endpoint details next, then save this backend as your default.',
                label: 'Next',
                tone: 'accent',
              },
              'confirm-next',
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
        '✦ Murph model',
      ),
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('muted') },
        'Choose the default assistant path first. Murph will ask for any remaining details next.',
      ),
      createElement(Text, null, ''),
      ...completedBlocks,
      activePanel,
      createElement(Text, null, ''),
      createSetupWizardHintRow(
        resolveSetupAssistantWizardHints({
          step,
          selectionStep,
        }),
      ),
    )
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
    completion.fail(new Error('Murph assistant picker failed to initialize.'))
  }

  return await completion.waitForResult()
}

function resolveSetupAssistantWizardHints(input: {
  step: 'assistant-provider' | 'assistant-method' | 'confirm'
  selectionStep:
    | {
        step: 'assistant-provider' | 'assistant-method'
      }
    | null
}): SetupWizardHint[] {
  if (input.selectionStep) {
    return [
      { label: '↑/↓ move', tone: 'muted' },
      { label: 'Space choose', tone: 'accent' },
      { label: 'Enter next', tone: 'success' },
      {
        label:
          input.selectionStep.step === 'assistant-provider' ? 'Esc cancel' : 'Esc back',
        tone: 'muted',
      },
      { label: 'q quit', tone: 'muted' },
    ]
  }

  return [
    { label: 'Enter continue', tone: 'success' },
    { label: 'Esc back', tone: 'muted' },
    { label: 'q quit', tone: 'muted' },
  ]
}

function formatSetupAssistantWizardPromptTitle(
  step: 'assistant-provider' | 'assistant-method' | 'confirm',
  provider: SetupWizardAssistantProvider,
): string {
  switch (step) {
    case 'assistant-provider':
      return 'How should Murph answer?'
    case 'assistant-method':
      return provider === 'openai'
        ? 'How should Murph connect to OpenAI?'
        : 'How should Murph connect to your endpoint?'
    case 'confirm':
      return 'Review'
  }
}

function formatSetupAssistantWizardStepIntro(
  step: 'assistant-provider' | 'assistant-method',
  provider: SetupWizardAssistantProvider,
): string | undefined {
  switch (step) {
    case 'assistant-provider':
      return 'Choose the provider or endpoint style Murph should use by default.'
    case 'assistant-method':
      return provider === 'openai'
        ? 'Pick the OpenAI path that fits you best.'
        : 'Choose a manual endpoint or keep the Codex local-model flow.'
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

function normalizeSetupWizardText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
