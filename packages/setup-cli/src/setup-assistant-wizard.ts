import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import { getDefaultSetupAssistantPreset as getDefaultAssistantPreset } from './setup-assistant.js'
import type { SetupAssistantPreset } from '@murphai/operator-config/setup-cli-contracts'
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
  assistantOss?: boolean | null
  assistantPreset?: Exclude<SetupAssistantPreset, 'skip'>
}

export interface SetupAssistantWizardInput {
  initialAssistantOss?: boolean | null
  initialAssistantPreset?: SetupAssistantPreset
}

export type SetupWizardAssistantProvider =
  | 'codex-cloud'
  | 'codex-local'
  | 'skip'

export type SetupWizardAssistantMethod =
  | 'codex-cloud'
  | 'codex-local'
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
  detail: string
  methodLabel: string | null
  oss: boolean | null
  preset: SetupAssistantPreset
  providerLabel: string
  summary: string
}

const setupWizardAssistantProviderOptions: readonly SetupWizardAssistantProviderOption[] = [
  {
    provider: 'codex-cloud',
    title: 'ChatGPT / Codex sign-in',
    description: 'Use the saved Codex sign-in path.',
  },
  {
    provider: 'codex-local',
    title: 'Codex local model',
    description: 'Use Codex with a local OSS model.',
  },
  {
    provider: 'skip',
    title: 'Skip for now',
    description: 'Leave the current assistant settings alone.',
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
  const resolvedMethod = resolveSetupWizardAssistantMethodForProvider({
    currentMethod: method,
    provider,
  })
  return resolvedMethod === 'codex-local' ? 1 : 0
}

export function normalizeSetupAssistantWizardProvider(
  provider: SetupWizardAssistantProvider,
): SetupWizardAssistantProvider {
  return provider === 'skip' ? 'codex-cloud' : provider
}

export function inferSetupWizardAssistantProvider(input: {
  oss?: boolean | null
  preset: SetupAssistantPreset
}): SetupWizardAssistantProvider {
  if (input.preset === 'skip') {
    return 'skip'
  }

  return input.oss === true ? 'codex-local' : 'codex-cloud'
}

export function inferSetupWizardAssistantMethod(input: {
  oss?: boolean | null
  preset: SetupAssistantPreset
  provider: SetupWizardAssistantProvider
}): SetupWizardAssistantMethod {
  if (input.preset === 'skip' || input.provider === 'skip') {
    return 'skip'
  }

  return input.oss === true || input.provider === 'codex-local'
    ? 'codex-local'
    : 'codex-cloud'
}

export function doesSetupWizardAssistantProviderRequireMethod(
  _provider: SetupWizardAssistantProvider,
): boolean {
  return false
}

export function resolveSetupWizardAssistantMethodForProvider(input: {
  currentMethod: SetupWizardAssistantMethod
  provider: SetupWizardAssistantProvider
}): SetupWizardAssistantMethod {
  switch (input.provider) {
    case 'codex-local':
      return 'codex-local'
    case 'skip':
      return 'skip'
    case 'codex-cloud':
    default:
      return 'codex-cloud'
  }
}

export function listSetupWizardAssistantMethodOptions(
  _provider: SetupWizardAssistantProvider,
): readonly SetupWizardAssistantMethodOption[] {
  return []
}

export function resolveSetupWizardAssistantSelection(input: {
  method: SetupWizardAssistantMethod
  provider: SetupWizardAssistantProvider
}): SetupWizardResolvedAssistantSelection {
  if (input.provider === 'skip' || input.method === 'skip') {
    return {
      detail: 'Murph will leave your current assistant settings alone for now.',
      methodLabel: null,
      oss: null,
      preset: 'skip',
      providerLabel: 'Skip for now',
      summary: 'Skip for now',
    }
  }

  if (input.provider === 'codex-local' || input.method === 'codex-local') {
    return {
      detail: 'Murph will ask which local model id to save next.',
      methodLabel: null,
      oss: true,
      preset: 'codex',
      providerLabel: 'Codex local model',
      summary: 'Codex local model',
    }
  }

  return {
    detail: 'Murph will use your saved Codex / ChatGPT sign-in.',
    methodLabel: null,
    oss: false,
    preset: 'codex',
    providerLabel: 'ChatGPT / Codex sign-in',
    summary: 'ChatGPT / Codex sign-in',
  }
}

export function buildSetupWizardAssistantProviderBadges(input: {
  currentProvider: SetupWizardAssistantProvider
  provider: SetupWizardAssistantProvider
}): SetupWizardInlineBadge[] {
  const badges: SetupWizardInlineBadge[] = []

  if (input.provider === 'codex-cloud') {
    badges.push({ label: 'recommended', tone: 'success' })
  } else if (input.provider === 'codex-local') {
    badges.push({ label: 'local', tone: 'accent' })
  } else {
    badges.push({ label: 'no change', tone: 'muted' })
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
        oss: input.initialAssistantOss,
        preset: initialAssistantPreset,
      }),
    )
    const initialAssistantMethod = inferSetupWizardAssistantMethod({
      oss: input.initialAssistantOss,
      preset: initialAssistantPreset,
      provider: initialAssistantProvider,
    })
    const assistantProviderOptions = listSetupAssistantWizardProviderOptions()
    const [step, setStep] = React.useState<'assistant-provider' | 'confirm'>(
      'assistant-provider',
    )
    const [assistantProviderIndex, setAssistantProviderIndex] = React.useState(
      findSetupAssistantWizardProviderIndex(initialAssistantProvider),
    )
    const [selectedAssistantProvider, setSelectedAssistantProvider] =
      React.useState<SetupWizardAssistantProvider>(initialAssistantProvider)
    const [selectedAssistantMethod, setSelectedAssistantMethod] = React.useState<
      SetupWizardAssistantMethod
    >(initialAssistantMethod)
    const assistantSelection = resolveSetupWizardAssistantSelection({
      method: selectedAssistantMethod,
      provider: selectedAssistantProvider,
    })
    const latestAssistantRef = React.useRef<SetupWizardResolvedAssistantSelection>(
      assistantSelection,
    )

    React.useEffect(() => {
      latestAssistantRef.current = assistantSelection
    }, [assistantSelection])

    const selectionLines: SetupWizardSelectionLine[] = assistantProviderOptions.map(
      (option, index) => ({
        active: index === assistantProviderIndex,
        badges: buildSetupWizardAssistantProviderBadges({
          currentProvider: initialAssistantProvider,
          provider: option.provider,
        }),
        description: option.description,
        key: option.provider,
        selected: option.provider === selectedAssistantProvider,
        title: option.title,
      }),
    )

    const toggleCurrent = () => {
      const activeProvider =
        assistantProviderOptions[assistantProviderIndex]?.provider
      if (!activeProvider) {
        return
      }

      setSelectedAssistantProvider(activeProvider)
      setSelectedAssistantMethod(
        resolveSetupWizardAssistantMethodForProvider({
          currentMethod: selectedAssistantMethod,
          provider: activeProvider,
        }),
      )
    }

    useInput((value, key) => {
      if ((key.ctrl && value === 'c') || value.toLowerCase() === 'q') {
        completion.fail(
          new VaultCliError('setup_cancelled', 'Murph model selection was cancelled.'),
        )
        exit()
        return
      }

      if (step === 'assistant-provider') {
        if (key.upArrow) {
          setAssistantProviderIndex((current) =>
            wrapSetupWizardIndex(current, selectionLines.length, -1),
          )
          return
        }

        if (key.downArrow) {
          setAssistantProviderIndex((current) =>
            wrapSetupWizardIndex(current, selectionLines.length, 1),
          )
          return
        }

        if (value === ' ') {
          toggleCurrent()
          return
        }

        if (key.escape) {
          completion.fail(
            new VaultCliError(
              'setup_cancelled',
              'Murph model selection was cancelled.',
            ),
          )
          exit()
          return
        }

        if (key.return) {
          toggleCurrent()
          setStep('confirm')
        }
        return
      }

      if (key.escape || key.leftArrow) {
        setStep('assistant-provider')
        return
      }

      if (key.return || value === ' ') {
        if (latestAssistantRef.current.preset !== 'codex') {
          completion.fail(
            new VaultCliError(
              'invalid_option',
              'Assistant-only model selection must resolve to a saved Codex backend.',
            ),
          )
          exit()
          return
        }

        completion.submit({
          assistantOss: latestAssistantRef.current.oss,
          assistantPreset: latestAssistantRef.current.preset,
        })
        exit()
      }
    })

    const completedBlocks: React.ReactElement[] = []

    if (step === 'confirm') {
      completedBlocks.push(
        createSetupWizardAnsweredBlock(
          {
            label: formatSetupAssistantWizardPromptTitle('assistant-provider'),
            value: assistantSelection.providerLabel,
            detail: assistantSelection.detail,
          },
          'completed-assistant-provider',
        ),
      )
    }

    const activePanel =
      step === 'assistant-provider'
        ? createSetupWizardPanel({
            title: formatSetupAssistantWizardPromptTitle('assistant-provider'),
            tone: 'accent',
            children: [
              createElement(
                Text,
                { color: resolveSetupWizardToneColor('muted') },
                formatSetupAssistantWizardStepIntro(),
              ),
              createElement(Text, null, ''),
              ...selectionLines.map((line) =>
                createSetupWizardSelectionRow(
                  {
                    line,
                    marker: 'radio',
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
                  body: 'Murph will ask for any remaining Codex model details next, then save this backend as your default.',
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
        'Choose the default Codex assistant path first. Murph will ask for model details next.',
      ),
      createElement(Text, null, ''),
      ...completedBlocks,
      activePanel,
      createElement(Text, null, ''),
      createSetupWizardHintRow(
        resolveSetupAssistantWizardHints({
          step,
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
  step: 'assistant-provider' | 'confirm'
}): SetupWizardHint[] {
  if (input.step === 'assistant-provider') {
    return [
      { label: '↑/↓ move', tone: 'muted' },
      { label: 'Space choose', tone: 'accent' },
      { label: 'Enter next', tone: 'success' },
      { label: 'Esc cancel', tone: 'muted' },
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
  _step: 'assistant-provider' | 'confirm',
): string {
  return 'How should Murph answer?'
}

function formatSetupAssistantWizardStepIntro(): string {
  return 'Choose the Codex path Murph should use by default.'
}
