import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type SetupAssistantPreset,
  type SetupChannel,
  setupChannelValues,
} from './setup-cli-contracts.js'
import { getDefaultSetupAssistantPreset } from './setup-assistant.js'

export interface SetupWizardResult {
  assistantPreset?: SetupAssistantPreset
  channels: SetupChannel[]
}

export interface SetupWizardInput {
  commandName?: string
  initialAssistantPreset?: SetupAssistantPreset
  initialChannels?: readonly SetupChannel[]
  vault: string
}

interface SetupWizardAssistantOption {
  description: string
  preset: SetupAssistantPreset
  title: string
}

interface SetupWizardChannelOption {
  available: boolean
  channel: SetupChannel
  description: string
  title: string
}

type SetupWizardStep = 'intro' | 'assistant' | 'channels' | 'confirm'

const setupWizardAssistantOptions: readonly SetupWizardAssistantOption[] = [
  {
    preset: 'codex-cli',
    title: 'Codex CLI (recommended)',
    description:
      'Healthy Bob keeps the existing agentic Codex path and saves a default hosted model such as gpt-5.4.',
  },
  {
    preset: 'codex-oss',
    title: 'Codex OSS / local model',
    description:
      'Save a local Codex OSS model default for operators who want the Codex CLI flow backed by an open-source local model.',
  },
  {
    preset: 'openai-compatible',
    title: 'OpenAI-compatible API or local endpoint',
    description:
      'Use one OpenAI-compatible base URL for Ollama, local gateways, or hosted provider APIs and save the model plus API-key env-var name.',
  },
  {
    preset: 'skip',
    title: 'Skip for now',
    description:
      'Leave the assistant backend unchanged during setup and configure it later with assistant chat defaults.',
  },
]

const setupWizardChannelOptions: readonly SetupWizardChannelOption[] = [
  {
    available: true,
    channel: 'imessage',
    description:
      'Receive and deliver replies through Messages.app. Healthy Bob reuses one assistant session per conversation.',
    title: 'Configure iMessage',
  },
  {
    available: true,
    channel: 'telegram',
    description:
      'Receive and deliver replies through a Telegram bot. Export HEALTHYBOB_TELEGRAM_BOT_TOKEN before setup to enable assistant auto-reply.',
    title: 'Configure Telegram',
  },
  {
    available: true,
    channel: 'email',
    description:
      'Provision an AgentMail inbox for summaries and email conversations. Export HEALTHYBOB_AGENTMAIL_API_KEY before setup to enable the channel.',
    title: 'Configure email',
  },
]

export function getDefaultSetupWizardAssistantPreset(): SetupAssistantPreset {
  return getDefaultSetupAssistantPreset()
}

export function getDefaultSetupWizardChannels(): SetupChannel[] {
  return ['imessage']
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
  const option = setupWizardChannelOptions.find((candidate) => candidate.channel === channel)
  if (!option || !option.available) {
    return [...selectedChannels]
  }

  const next = new Set(selectedChannels)
  if (next.has(channel)) {
    next.delete(channel)
  } else {
    next.add(channel)
  }

  return sortSetupWizardChannels([...next])
}

export async function runSetupWizard(
  input: SetupWizardInput,
): Promise<SetupWizardResult> {
  const initialAssistantPreset =
    input.initialAssistantPreset ?? getDefaultSetupWizardAssistantPreset()
  const initialChannels = sortSetupWizardChannels(
    input.initialChannels && input.initialChannels.length > 0
      ? [...input.initialChannels]
      : getDefaultSetupWizardChannels(),
  )

  return await new Promise<SetupWizardResult>((resolve, reject) => {
    let settled = false
    let instance:
      | {
          unmount: () => void
          waitUntilExit: () => Promise<unknown>
        }
      | null = null

    const resolveOnce = (result: SetupWizardResult) => {
      if (settled) {
        return
      }

      settled = true
      resolve(result)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      reject(error)
    }

    const App = (): React.ReactElement => {
      const createElement = React.createElement
      const { exit } = useApp()
      const [step, setStep] = React.useState<SetupWizardStep>('intro')
      const [assistantIndex, setAssistantIndex] = React.useState(
        findSetupWizardAssistantOptionIndex(initialAssistantPreset),
      )
      const [channelIndex, setChannelIndex] = React.useState(0)
      const [selectedAssistantPreset, setSelectedAssistantPreset] =
        React.useState<SetupAssistantPreset>(initialAssistantPreset)
      const [selectedChannels, setSelectedChannels] = React.useState<SetupChannel[]>(
        initialChannels,
      )
      const latestAssistantRef = React.useRef<SetupAssistantPreset>(
        initialAssistantPreset,
      )
      const latestChannelsRef = React.useRef<SetupChannel[]>(initialChannels)

      React.useEffect(() => {
        latestAssistantRef.current = selectedAssistantPreset
      }, [selectedAssistantPreset])

      React.useEffect(() => {
        latestChannelsRef.current = selectedChannels
      }, [selectedChannels])

      useInput((value, key) => {
        if ((key.ctrl && value === 'c') || value.toLowerCase() === 'q') {
          rejectOnce(
            new VaultCliError('setup_cancelled', 'Healthy Bob setup was cancelled.'),
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
            rejectOnce(
              new VaultCliError('setup_cancelled', 'Healthy Bob setup was cancelled.'),
            )
            exit()
          }
          return
        }

        if (step === 'assistant') {
          if (key.upArrow) {
            setAssistantIndex((current) =>
              wrapSetupWizardIndex(current, setupWizardAssistantOptions.length, -1),
            )
            return
          }

          if (key.downArrow) {
            setAssistantIndex((current) =>
              wrapSetupWizardIndex(current, setupWizardAssistantOptions.length, 1),
            )
            return
          }

          if (value === ' ') {
            const activePreset = setupWizardAssistantOptions[assistantIndex]?.preset
            if (activePreset) {
              setSelectedAssistantPreset(activePreset)
            }
            return
          }

          if (key.escape) {
            setStep('intro')
            return
          }

          if (key.return) {
            const activePreset = setupWizardAssistantOptions[assistantIndex]?.preset
            if (activePreset) {
              setSelectedAssistantPreset(activePreset)
            }
            setStep('channels')
          }
          return
        }

        if (step === 'channels') {
          if (key.upArrow) {
            setChannelIndex((current) =>
              wrapSetupWizardIndex(current, setupWizardChannelOptions.length, -1),
            )
            return
          }

          if (key.downArrow) {
            setChannelIndex((current) =>
              wrapSetupWizardIndex(current, setupWizardChannelOptions.length, 1),
            )
            return
          }

          if (value === ' ') {
            const activeChannel = setupWizardChannelOptions[channelIndex]?.channel
            if (!activeChannel) {
              return
            }
            setSelectedChannels((current) =>
              toggleSetupWizardChannel(current, activeChannel),
            )
            return
          }

          if (key.escape) {
            setStep('assistant')
            return
          }

          if (key.return) {
            setStep('confirm')
          }
          return
        }

        if (step === 'confirm') {
          if (key.escape || key.leftArrow) {
            setStep('channels')
            return
          }

          if (key.return || value === ' ') {
            resolveOnce({
              assistantPreset: latestAssistantRef.current,
              channels: sortSetupWizardChannels(latestChannelsRef.current),
            })
            exit()
          }
        }
      })

      const assistantLines = setupWizardAssistantOptions.map((option, index) => {
        const active = index === assistantIndex
        const selected = option.preset === selectedAssistantPreset
        const marker = active ? '>' : ' '
        const radio = selected ? '(x)' : '( )'

        return createElement(
          Box,
          {
            flexDirection: 'column',
            key: option.preset,
            marginBottom: 1,
          },
          createElement(Text, null, `${marker} ${radio} ${option.title}`),
          createElement(Text, null, `    ${option.description}`),
        )
      })

      const channelLines = setupWizardChannelOptions.map((option, index) => {
        const active = index === channelIndex
        const selected = selectedChannels.includes(option.channel)
        const marker = active ? '>' : ' '
        const checkbox = option.available
          ? selected
            ? '[x]'
            : '[ ]'
          : '[·]'
        const title = option.title

        return createElement(
          Box,
          {
            flexDirection: 'column',
            key: option.channel,
            marginBottom: 1,
          },
          createElement(Text, null, `${marker} ${checkbox} ${title}`),
          createElement(Text, null, `    ${option.description}`),
        )
      })

      const assistantSummary = formatSetupAssistantPreset(selectedAssistantPreset)
      const enabledSummary =
        selectedChannels.length > 0
          ? selectedChannels
              .map((channel) =>
                channel === 'imessage'
                  ? 'iMessage'
                  : channel === 'telegram'
                    ? 'Telegram'
                    : channel === 'email'
                      ? 'Email'
                    : channel,
              )
              .join(', ')
          : 'none'

      return createElement(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          paddingY: 1,
        },
        createElement(Text, null, 'Healthy Bob onboarding'),
        createElement(Text, null, ''),
        step === 'intro'
          ? createElement(
              Box,
              {
                flexDirection: 'column',
              },
              createElement(
                Text,
                null,
                'Choose the assistant backend you want Healthy Bob to save for local chat and channel auto-reply, then pick which external message channels to enable during setup.',
              ),
              createElement(Text, null, ''),
              createElement(Text, null, `Vault: ${input.vault}`),
              createElement(Text, null, ''),
              createElement(
                Text,
                null,
                'Codex CLI is preselected, iMessage is enabled by default, and Telegram or email can opt into the same assistant session surface when their environment credentials are exported before setup.',
              ),
              createElement(Text, null, ''),
              createElement(Text, null, 'Press Enter to continue, or q to cancel.'),
            )
          : null,
        step === 'assistant'
          ? createElement(
              Box,
              {
                flexDirection: 'column',
              },
              createElement(Text, null, 'Assistant backend'),
              createElement(Text, null, ''),
              ...assistantLines,
              createElement(
                Text,
                null,
                'Use ↑/↓ to move, Space to select, Enter to continue, or Esc to go back.',
              ),
            )
          : null,
        step === 'channels'
          ? createElement(
              Box,
              {
                flexDirection: 'column',
              },
              createElement(Text, null, 'Message channels'),
              createElement(Text, null, ''),
              createElement(
                Text,
                null,
                `Assistant backend: ${assistantSummary}`,
              ),
              createElement(Text, null, ''),
              ...channelLines,
              createElement(
                Text,
                null,
                'Use ↑/↓ to move, Space to toggle, Enter to continue, or Esc to go back.',
              ),
            )
          : null,
        step === 'confirm'
          ? createElement(
              Box,
              {
                flexDirection: 'column',
              },
              createElement(Text, null, 'Review setup'),
              createElement(Text, null, ''),
              createElement(Text, null, `Assistant backend: ${assistantSummary}`),
              createElement(Text, null, `Enabled channels: ${enabledSummary}`),
              createElement(Text, null, ''),
              createElement(
                Text,
                null,
                selectedChannels.includes('imessage') &&
                  selectedChannels.includes('telegram')
                  ? 'Healthy Bob will save the assistant defaults you selected, add the local iMessage connector, configure the Telegram bot connector when a bot token is available, and start the assistant automation loop after setup so either channel can create or continue a shared assistant conversation.'
                  : selectedChannels.includes('imessage')
                    ? 'Healthy Bob will save the assistant defaults you selected, add the local iMessage connector, and start the assistant automation loop after setup so new texts can create or continue an assistant conversation.'
                    : selectedChannels.includes('telegram')
                      ? 'Healthy Bob will save the assistant defaults you selected, configure the Telegram bot connector when a bot token is available, and then start the assistant automation loop after setup so Telegram chats can create or continue an assistant conversation.'
                      : 'Healthy Bob will save the assistant defaults you selected and finish machine plus vault setup without enabling an external message channel yet.',
              ),
              createElement(Text, null, ''),
              createElement(Text, null, 'Press Enter to run setup, or Esc to change the selection.'),
            )
          : null,
      )
    }

    try {
      instance = render(React.createElement(App), {
        stderr: process.stderr,
        stdout: process.stderr,
        patchConsole: false,
      })
      void instance.waitUntilExit().catch(rejectOnce)
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (!instance) {
      rejectOnce(new Error('Healthy Bob setup wizard failed to initialize.'))
    }
  })
}

function sortSetupWizardChannels(channels: readonly SetupChannel[]): SetupChannel[] {
  const order = new Map(setupChannelValues.map((channel, index) => [channel, index] as const))
  const unique = [...new Set(channels)]
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
      return 'OpenAI-compatible API or local endpoint'
    case 'skip':
      return 'Skip for now'
  }
}
