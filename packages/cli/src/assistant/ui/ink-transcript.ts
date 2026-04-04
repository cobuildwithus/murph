import * as React from 'react'
import { Box, Static, Text, useStdout, type StaticProps } from 'ink'
import { normalizeNullableString } from '@murphai/assistant-core/assistant-runtime'

import type { InkChatEntry } from './view-model.js'
import {
  ChromePanel,
  WrappedPlainTextBlock,
  WrappedTextBlock,
  resolveAssistantChatViewportWidth,
  useAssistantInkTheme,
} from './ink-layout.js'
import { AssistantMessageText, MessageRoleLabel } from './ink-message-text.js'

interface ChatHeaderProps {
  bindingSummary: string | null
}

interface ChatEntryRowProps {
  entry: InkChatEntry
}

interface StaticTranscriptRowHeader {
  kind: 'header'
  bindingSummary: string | null
  sessionId: string
}

interface StaticTranscriptRowEntry {
  kind: 'entry'
  entry: InkChatEntry
}

type StaticTranscriptRow = StaticTranscriptRowHeader | StaticTranscriptRowEntry

const StaticTranscript = Static as React.ComponentType<
  StaticProps<StaticTranscriptRow>
>

export const ChatHeader = React.memo(function ChatHeader(
  props: ChatHeaderProps,
): React.ReactElement {
  const theme = useAssistantInkTheme()
  const terminalColumns = process.stderr.columns ?? 80
  const terminalRows = process.stderr.rows ?? 24
  const compactHeader = terminalColumns < 72 || terminalRows < 18

  if (compactHeader) {
    return React.createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
      },
      React.createElement(
        Text,
        {
          wrap: 'wrap',
        },
        React.createElement(Text, { color: theme.accentColor }, '●'),
        ' ',
        React.createElement(Text, { bold: true }, 'Murph'),
      ),
      props.bindingSummary
        ? React.createElement(
            Text,
            {
              color: theme.mutedColor,
              wrap: 'wrap',
            },
            props.bindingSummary,
          )
        : null,
    )
  }

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
      width: '100%',
    },
    React.createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
      },
      React.createElement(
        Text,
        {
          wrap: 'wrap',
        },
        React.createElement(Text, { color: theme.accentColor }, '●'),
        ' ',
        React.createElement(Text, { bold: true }, 'Murph'),
        ' ',
        React.createElement(Text, { color: theme.mutedColor }, 'interactive chat'),
      ),
    ),
    React.createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 0,
      },
      React.createElement(
        Text,
        {
          color: theme.mutedColor,
          wrap: 'wrap',
        },
        React.createElement(Text, { color: theme.accentColor }, '↳'),
        ` ${props.bindingSummary ?? 'local transcript-backed session'}`,
      ),
    ),
  )
})

export const ChatEntryRow = React.memo(function ChatEntryRow(
  props: ChatEntryRowProps,
): React.ReactElement {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()
  const rowWidth = resolveAssistantChatViewportWidth(stdout?.columns)

  if (props.entry.kind === 'assistant') {
    return React.createElement(
      ChromePanel,
      {
        marginBottom: 1,
        width: rowWidth,
      },
      React.createElement(AssistantMessageText, { text: props.entry.text }),
    )
  }

  if (props.entry.kind === 'error') {
    return React.createElement(
      ChromePanel,
      {
        backgroundColor: theme.switcherBackground,
        marginBottom: 1,
        width: rowWidth,
      },
      React.createElement(MessageRoleLabel, {
        kind: 'error',
      }),
      React.createElement(
        WrappedTextBlock,
        {
          color: theme.errorColor,
        },
        props.entry.text,
      ),
    )
  }

  if (props.entry.kind === 'trace') {
    return React.createElement(
      Box,
      {
        marginBottom: 1,
        paddingLeft: 2,
        width: rowWidth,
      },
      React.createElement(WrappedPlainTextBlock, {
        columns: Math.max(1, rowWidth - 2),
        dimColor: true,
        text: `${props.entry.pending ? '· ' : '  '}${props.entry.text}`,
      }),
    )
  }

  if (props.entry.kind === 'thinking' || props.entry.kind === 'status') {
    return React.createElement(
      Box,
      {
        marginBottom: 1,
        width: rowWidth,
      },
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          width: rowWidth,
        },
        React.createElement(
          Text,
          { dimColor: true },
          props.entry.kind === 'thinking' ? '· ' : '↻ ',
        ),
        React.createElement(
          Box,
          {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
          },
          React.createElement(
            WrappedTextBlock,
            {
              dimColor: true,
            },
            props.entry.text,
          ),
        ),
      ),
    )
  }

  return React.createElement(
    ChromePanel,
    {
      backgroundColor: theme.composerBackground,
      marginBottom: 1,
      paddingY: 1,
      width: rowWidth,
    },
    React.createElement(
      Box,
      {
        flexDirection: 'row',
        width: '100%',
      },
      React.createElement(
        Text,
        {
          color: theme.composerTextColor,
        },
        '› ',
      ),
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
        },
        React.createElement(
          Text,
          {
            color: theme.composerTextColor,
            wrap: 'wrap',
          },
          props.entry.text,
        ),
      ),
    ),
  )
})

export function partitionChatTranscriptEntries(input: {
  busy: boolean
  entries: readonly InkChatEntry[]
}): {
  liveEntries: readonly InkChatEntry[]
  staticEntries: readonly InkChatEntry[]
} {
  if (input.entries.length === 0) {
    return {
      liveEntries: [],
      staticEntries: [],
    }
  }

  if (!input.busy) {
    return {
      liveEntries: [],
      staticEntries: [...input.entries],
    }
  }

  let lastUserEntryIndex = -1
  for (let index = input.entries.length - 1; index >= 0; index -= 1) {
    const entry = input.entries[index]
    if (entry?.kind === 'user') {
      lastUserEntryIndex = index
      break
    }
  }

  if (lastUserEntryIndex < 0) {
    return {
      liveEntries: [...input.entries],
      staticEntries: [],
    }
  }

  return {
    liveEntries: input.entries.slice(lastUserEntryIndex + 1),
    staticEntries: input.entries.slice(0, lastUserEntryIndex + 1),
  }
}

export function shouldShowBusyStatus(input: {
  busy: boolean
  entries: readonly InkChatEntry[]
}): boolean {
  if (!input.busy) {
    return false
  }

  let lastUserEntryIndex = -1
  for (let index = input.entries.length - 1; index >= 0; index -= 1) {
    if (input.entries[index]?.kind === 'user') {
      lastUserEntryIndex = index
      break
    }
  }

  if (lastUserEntryIndex < 0) {
    return true
  }

  for (let index = lastUserEntryIndex + 1; index < input.entries.length; index += 1) {
    const entry = input.entries[index]
    if (entry?.kind === 'assistant' && normalizeNullableString(entry.text)) {
      return false
    }

    if (entry?.kind === 'error' && normalizeNullableString(entry.text)) {
      return false
    }
  }

  return true
}

function renderStaticTranscriptRow(
  item: StaticTranscriptRow,
  index: number,
): React.ReactElement {
  if (item.kind === 'header') {
    return React.createElement(ChatHeader, {
      key: `static-header:${item.sessionId}`,
      bindingSummary: item.bindingSummary,
    })
  }

  return React.createElement(ChatEntryRow, {
    key: `static-entry:${index}`,
    entry: item.entry,
  })
}

export function renderChatTranscriptFeed(input: {
  bindingSummary: string | null
  busy: boolean
  entries: readonly InkChatEntry[]
  sessionId: string
}): React.ReactElement {
  const { liveEntries, staticEntries } = partitionChatTranscriptEntries({
    busy: input.busy,
    entries: input.entries,
  })
  const staticRows: StaticTranscriptRow[] = [
    {
      kind: 'header',
      bindingSummary: input.bindingSummary,
      sessionId: input.sessionId,
    },
    ...staticEntries.map((entry) => ({
      kind: 'entry' as const,
      entry,
    })),
  ]

  return React.createElement(
    React.Fragment,
    {},
    React.createElement(StaticTranscript, {
      items: staticRows,
      children: renderStaticTranscriptRow,
    }),
    React.createElement(
      Box,
      {
        flexDirection: 'column',
        width: '100%',
      },
      ...liveEntries.map((entry, index) =>
        React.createElement(ChatEntryRow, {
          key: `live-entry:${staticEntries.length + index}`,
          entry,
        }),
      ),
    ),
  )
}

export const ChatTranscriptFeed = React.memo(function ChatTranscriptFeed(input: {
  bindingSummary: string | null
  busy: boolean
  entries: readonly InkChatEntry[]
  sessionId: string
}): React.ReactElement {
  return renderChatTranscriptFeed(input)
})
