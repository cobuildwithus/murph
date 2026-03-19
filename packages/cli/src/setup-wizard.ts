import * as React from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type SetupChannel,
  setupChannelValues,
} from './setup-cli-contracts.js'

export interface SetupWizardResult {
  channels: SetupChannel[]
}

export interface SetupWizardInput {
  commandName?: string
  initialChannels?: readonly SetupChannel[]
  vault: string
}

interface SetupWizardChannelOption {
  available: boolean
  channel: SetupChannel
  description: string
  title: string
}

type SetupWizardStep = 'intro' | 'channels' | 'confirm'

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
]

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
      const [activeIndex, setActiveIndex] = React.useState(0)
      const [selectedChannels, setSelectedChannels] = React.useState<SetupChannel[]>(
        initialChannels,
      )
      const latestSelectionRef = React.useRef<SetupChannel[]>(initialChannels)

      React.useEffect(() => {
        latestSelectionRef.current = selectedChannels
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
            setStep('channels')
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

        if (step === 'channels') {
          if (key.upArrow) {
            setActiveIndex((current) =>
              wrapSetupWizardIndex(
                current,
                setupWizardChannelOptions.length,
                -1,
              ),
            )
            return
          }

          if (key.downArrow) {
            setActiveIndex((current) =>
              wrapSetupWizardIndex(
                current,
                setupWizardChannelOptions.length,
                1,
              ),
            )
            return
          }

          if (value === ' ') {
            const activeChannel = setupWizardChannelOptions[activeIndex]?.channel
            if (!activeChannel) {
              return
            }
            setSelectedChannels((current) =>
              toggleSetupWizardChannel(current, activeChannel),
            )
            return
          }

          if (key.escape) {
            setStep('intro')
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
              channels: sortSetupWizardChannels(latestSelectionRef.current),
            })
            exit()
          }
        }
      })

      const channelLines = setupWizardChannelOptions.map((option, index) => {
        const active = index === activeIndex
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

      const enabledSummary =
        selectedChannels.length > 0
          ? selectedChannels
              .map((channel) =>
                channel === 'imessage' ? 'iMessage' : channel === 'telegram' ? 'Telegram' : channel,
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
                'Set up local channels so Healthy Bob can receive and deliver messages outside the terminal chat.',
              ),
              createElement(Text, null, ''),
              createElement(Text, null, `Vault: ${input.vault}`),
              createElement(Text, null, ''),
              createElement(
                Text,
                null,
                'iMessage is enabled by default. Telegram works through the same assistant channel surface when HEALTHYBOB_TELEGRAM_BOT_TOKEN is exported before setup.',
              ),
              createElement(Text, null, ''),
              createElement(Text, null, 'Press Enter to choose channels, or q to cancel.'),
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
              createElement(Text, null, `Enabled channels: ${enabledSummary}`),
              createElement(Text, null, ''),
              createElement(
                Text,
                null,
                selectedChannels.includes('imessage') && selectedChannels.includes('telegram')
                  ? 'Healthy Bob will add the local iMessage connector, configure the Telegram bot connector when a bot token is available, and start the assistant automation loop after setup so either channel can create or continue a shared assistant conversation.'
                  : selectedChannels.includes('imessage')
                    ? 'Healthy Bob will add the local iMessage connector and start the assistant automation loop after setup so new texts can create or continue an assistant conversation.'
                    : selectedChannels.includes('telegram')
                      ? 'Healthy Bob will configure the Telegram bot connector when a bot token is available and then start the assistant automation loop after setup so Telegram chats can create or continue an assistant conversation.'
                      : 'Healthy Bob will finish machine and vault setup without enabling an external message channel yet.',
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
