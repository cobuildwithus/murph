import type { SetupWizardRuntimeStatus } from '@murphai/operator-config/setup-runtime-env'
import type { SetupWizardAssistantProvider } from './setup-assistant-wizard.js'
import type {
  SetupWizardHint,
  SetupWizardInlineBadge,
  SetupWizardTone,
} from './setup-wizard-ui.js'

export type SetupWizardStep =
  | 'intro'
  | 'assistant-provider'
  | 'assistant-method'
  | 'scheduled-updates'
  | 'channels'
  | 'wearables'
  | 'public-url'
  | 'confirm'

export type SetupWizardFlowStep = Exclude<SetupWizardStep, 'intro'>
export type SetupWizardSelectionStep = Extract<
  SetupWizardFlowStep,
  'assistant-provider' | 'assistant-method' | 'scheduled-updates' | 'channels' | 'wearables'
>

export function formatSelectionSummary(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'None'
}

export function formatMissingEnv(values: readonly string[]): string {
  if (values.length === 0) {
    return 'nothing else'
  }

  if (values.length === 1) {
    return values[0] ?? ''
  }

  return values.join(', ')
}

export function listSetupWizardSteps(input: {
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

export function hasSetupWizardStepPassed(input: {
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

export function resolveSetupWizardRuntimeTone(
  status: SetupWizardRuntimeStatus,
): SetupWizardTone {
  if (status.ready) {
    return 'success'
  }

  return status.badge.toLowerCase().includes('macos') ? 'accent' : 'warn'
}

export function formatSetupWizardRuntimeDetail(
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

export function buildSetupWizardScheduledUpdateBadges(input: {
  isStarter: boolean
}): SetupWizardInlineBadge[] {
  return [
    ...(input.isStarter ? ([{ label: 'recommended', tone: 'accent' }] as const) : []),
    { label: 'set up later', tone: 'muted' },
  ]
}

export function formatSetupWizardPromptTitle(
  step: Exclude<SetupWizardStep, 'intro' | 'confirm'>,
  provider: SetupWizardAssistantProvider,
): string {
  switch (step) {
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
  }
}

export function formatSetupWizardStepIntro(
  step: SetupWizardSelectionStep,
  provider: SetupWizardAssistantProvider,
): string {
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
  }
}

export function resolveSetupWizardHints(input: {
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

export function describeSetupWizardReviewNextStep(input: {
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
