import * as React from 'react'
import { Box, Text, render, useApp } from 'ink'
import TextInput from 'ink-text-input'
import {
  assistantChatResultSchema,
  type AssistantSession,
} from '../../assistant-cli-contracts.js'
import type { AssistantChatInput } from '../service.js'
import { sendAssistantMessage } from '../service.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
} from '../store.js'
import { normalizeNullableString } from '../shared.js'

type AssistantChatResult = ReturnType<typeof assistantChatResultSchema.parse>

interface InkChatEntry {
  kind: 'assistant' | 'error' | 'system' | 'user'
  text: string
}

export async function runAssistantChatWithInk(
  input: AssistantChatInput,
): Promise<AssistantChatResult> {
  const startedAt = new Date().toISOString()
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
    provider: input.provider,
    model: input.model,
    sandbox: input.sandbox ?? 'read-only',
    approvalPolicy: input.approvalPolicy ?? 'never',
    oss: input.oss ?? false,
    profile: input.profile,
  })
  const redactedVault = redactAssistantDisplayPath(input.vault)

  return await new Promise<AssistantChatResult>((resolve, reject) => {
    let settled = false
    let instance: {
      cleanup?: () => void
      unmount: () => void
      waitUntilExit: () => Promise<unknown>
    } | null = null

    const resolveOnce = (result: AssistantChatResult) => {
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
      const [session, setSession] = React.useState(resolved.session)
      const [turns, setTurns] = React.useState(0)
      const [entries, setEntries] = React.useState(seedChatEntries(resolved.session))
      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [footer, setFooter] = React.useState(
        'Type a message. Use /session to inspect the Healthy Bob session id and /exit to quit.',
      )
      const latestSessionRef = React.useRef(resolved.session)
      const latestTurnsRef = React.useRef(0)
      const initialPromptRef = React.useRef(normalizeNullableString(input.initialPrompt))
      const bootstrappedRef = React.useRef(false)

      React.useEffect(() => {
        latestSessionRef.current = session
      }, [session])

      React.useEffect(() => {
        latestTurnsRef.current = turns
      }, [turns])

      React.useEffect(
        () => () => {
          resolveOnce(
            assistantChatResultSchema.parse({
              vault: redactedVault,
              startedAt,
              stoppedAt: new Date().toISOString(),
              turns: latestTurnsRef.current,
              session: latestSessionRef.current,
            }),
          )
        },
        [],
      )

      const submitPrompt = async (rawValue: string) => {
        const prompt = rawValue.trim()
        if (prompt.length === 0 || busy) {
          return
        }

        if (prompt === '/exit' || prompt === '/quit') {
          exit()
          return
        }

        if (prompt === '/session') {
          setFooter(`Healthy Bob session: ${latestSessionRef.current.sessionId}`)
          return
        }

        setEntries((previous: InkChatEntry[]) => [
          ...previous,
          {
            kind: 'user',
            text: prompt,
          },
        ])
        setBusy(true)
        setFooter('Waiting for the assistant...')
        setValue('')

        try {
          const result = await sendAssistantMessage({
            ...input,
            prompt,
            sessionId: latestSessionRef.current.sessionId,
          })

          latestSessionRef.current = result.session
          setSession(result.session)
          setTurns((previous: number) => previous + 1)
          setEntries((previous: InkChatEntry[]) => [
            ...previous,
            {
              kind: 'assistant',
              text: result.response,
            },
          ])
          setFooter(
            result.delivery
              ? `Delivered over ${result.delivery.channel} to ${result.delivery.target}.`
              : result.deliveryError
                ? `Response saved locally, but delivery failed: ${result.deliveryError.message}`
                : 'Ready for the next message.',
          )
        } catch (error) {
          setEntries((previous: InkChatEntry[]) => [
            ...previous,
            {
              kind: 'error',
              text: error instanceof Error ? error.message : String(error),
            },
          ])
          setFooter('The assistant hit an error. Fix it or keep chatting.')
        } finally {
          setBusy(false)
        }
      }

      React.useEffect(() => {
        if (bootstrappedRef.current) {
          return
        }

        bootstrappedRef.current = true
        if (initialPromptRef.current) {
          void submitPrompt(initialPromptRef.current)
        }
      }, [])

      const history = entries.slice(-16)

      return createElement(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          paddingY: 1,
        },
        createElement(
          Box,
          {
            flexDirection: 'column',
            marginBottom: 1,
          },
          createElement(Text, {}, 'Healthy Bob'),
          createElement(Text, { dimColor: true }, `session ${session.sessionId}`),
          session.binding.channel
            ? createElement(Text, { dimColor: true }, `channel ${session.binding.channel}`)
            : null,
          session.binding.actorId
            ? createElement(
                Text,
                { dimColor: true },
                `actor ${session.binding.actorId}`,
              )
            : null,
          session.binding.threadId
            ? createElement(
                Text,
                { dimColor: true },
                `thread ${session.binding.threadId}`,
              )
            : null,
        ),
        createElement(
          Box,
          {
            flexDirection: 'column',
            marginBottom: 1,
          },
          history.length > 0
            ? history.map((entry: InkChatEntry, index: number) =>
                createElement(
                  Text,
                  {
                    key: `${entry.kind}:${index}:${entry.text.slice(0, 24)}`,
                  },
                  formatEntry(entry),
                ),
              )
            : createElement(
                Text,
                { dimColor: true },
                'No visible turns yet. Start chatting below.',
              ),
        ),
        busy
          ? createElement(Text, { dimColor: true }, 'assistant is thinking...')
          : null,
        createElement(
          Box,
          {
            marginBottom: 1,
          },
          createElement(Text, {}, busy ? 'you (wait)> ' : 'you> '),
          createElement(TextInput, {
            value,
            placeholder: busy ? 'Waiting for the assistant...' : 'Type a message',
            onChange: (nextValue: string) => setValue(nextValue),
            onSubmit: (submittedValue: string) => {
              void submitPrompt(submittedValue)
            },
            focus: !busy,
            showCursor: !busy,
          }),
        ),
        createElement(Text, { dimColor: true }, footer),
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
      rejectOnce(new Error('Ink chat failed to initialize.'))
    }
  })
}

function seedChatEntries(session: AssistantSession): InkChatEntry[] {
  const entries: InkChatEntry[] = [
    {
      kind: 'system',
      text: 'Healthy Bob chat is local-first. Provider transcripts stay with the provider when supported.',
    },
  ]

  if (session.lastUserMessage) {
    entries.push({
      kind: 'user',
      text: session.lastUserMessage,
    })
  }

  if (session.lastAssistantMessage) {
    entries.push({
      kind: 'assistant',
      text: session.lastAssistantMessage,
    })
  }

  return entries
}

function formatEntry(entry: InkChatEntry): string {
  switch (entry.kind) {
    case 'assistant':
      return `assistant> ${entry.text}`
    case 'error':
      return `error> ${entry.text}`
    case 'system':
      return `system> ${entry.text}`
    case 'user':
      return `you> ${entry.text}`
  }
}
