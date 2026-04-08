import * as React from 'react'
import { render } from 'ink'
import {
  type SetupAssistantPreset,
  type SetupAssistantProviderPreset,
  type SetupChannel,
  type SetupWearable,
} from '@murphai/operator-config/setup-cli-contracts'
import { type SetupWizardRuntimeStatus } from '@murphai/operator-config/setup-runtime-env'
import {
  getDefaultSetupWizardAssistantPreset,
  type SetupAssistantWizardInput,
  type SetupAssistantWizardResult,
  runSetupAssistantWizard,
} from './setup-assistant-wizard.js'
import { SetupWizardApp } from './setup-wizard-app.js'
import {
  createSetupWizardCompletionController as createGenericSetupWizardCompletionController,
  type SetupWizardCompletionController,
} from './setup-wizard-core.js'
import {
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
  resolveSetupWizardInitialScheduledUpdates,
  sortSetupWizardChannels,
  sortSetupWizardWearables,
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
  try {
    instance = render(
      React.createElement(SetupWizardApp, {
        channelStatuses: input.channelStatuses,
        commandName,
        defaultScheduledUpdateIds,
        deviceSyncLocalBaseUrl: input.deviceSyncLocalBaseUrl,
        initialAssistantApiKeyEnv: input.initialAssistantApiKeyEnv,
        initialAssistantBaseUrl: input.initialAssistantBaseUrl,
        initialAssistantOss: input.initialAssistantOss,
        initialAssistantPreset,
        initialAssistantProviderName: input.initialAssistantProviderName,
        initialAssistantProviderPreset: input.initialAssistantProviderPreset,
        initialChannels,
        initialScheduledUpdates,
        initialWearables,
        linqLocalWebhookUrl: input.linqLocalWebhookUrl,
        onCancel: (error) => {
          completion.fail(error)
        },
        onComplete: (result) => {
          completion.submit(result)
        },
        publicBaseUrl: input.publicBaseUrl,
        vault: input.vault,
        wearableStatuses: input.wearableStatuses,
      }),
      {
        stderr: process.stderr,
        stdout: process.stderr,
        patchConsole: false,
      },
    )
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
