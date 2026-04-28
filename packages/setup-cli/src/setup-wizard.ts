import * as React from 'react'
import { render } from 'ink'
import {
  type SetupAssistantPreset,
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
  buildSetupWizardPublicUrlHelpText,
  buildSetupWizardPublicUrlReview,
  describeSetupWizardPublicUrlStrategyChoice,
  type SetupPublicUrlStrategy,
  type SetupWizardPublicUrlDocLink,
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
  assistantOss?: boolean | null
  assistantPreset?: SetupAssistantPreset
  channels: SetupChannel[]
  scheduledUpdates: string[]
  wearables: SetupWearable[]
}

export interface SetupWizardInput {
  channelStatuses?: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
  commandName?: string
  deviceSyncLocalBaseUrl?: string | null
  initialAssistantOss?: boolean | null
  initialAssistantPreset?: SetupAssistantPreset
  initialChannels?: readonly SetupChannel[]
  initialScheduledUpdates?: readonly string[]
  initialWearables?: readonly SetupWearable[]
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
    input.initialChannels === undefined
      ? getDefaultSetupWizardChannels(input.platform)
      : [...input.initialChannels],
  )
  const initialScheduledUpdates = resolveSetupWizardInitialScheduledUpdates(
    input.initialScheduledUpdates,
  )
  const initialWearables = sortSetupWizardWearables(
    input.initialWearables === undefined
      ? getDefaultSetupWizardWearables()
      : [...input.initialWearables],
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
        initialAssistantOss: input.initialAssistantOss,
        initialAssistantPreset,
        initialChannels,
        initialScheduledUpdates,
        initialWearables,
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
