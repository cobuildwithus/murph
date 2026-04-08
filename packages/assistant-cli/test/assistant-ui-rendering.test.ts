import assert from 'node:assert/strict'
import path from 'node:path'
import * as React from 'react'
import { test } from 'vitest'

import { type AssistantCatalogModel } from '@murphai/assistant-engine/assistant-provider-catalog'

import {
  ChatComposer,
  ChatFooter,
  ChatStatus,
  QueuedFollowUpStatus,
} from '../src/assistant/ui/ink-composer-panel.js'
import { applyComposerEditingInput } from '../src/assistant/ui/composer-editing.js'
import {
  formatAssistantTerminalHyperlink,
  resolveAssistantHyperlinkTarget,
  resolveMessageRoleLabel,
  splitAssistantMarkdownLinks,
  supportsAssistantTerminalHyperlinks,
} from '../src/assistant/ui/ink-message-text.js'
import {
  formatFooterBadgeText,
  renderWrappedPlainTextBlock,
  resolveAssistantChatViewportWidth,
  resolveAssistantPlainTextWrapColumns,
  resolveChromePanelBoxProps,
  wrapAssistantPlainText,
} from '../src/assistant/ui/ink-layout.js'
import {
  captureAssistantInkThemeBaseline,
  DARK_ASSISTANT_INK_THEME,
  inferAssistantInkThemeModeFromAppleInterfaceStyle,
  inferAssistantInkThemeModeFromColorFgbg,
  LIGHT_ASSISTANT_INK_THEME,
  resolveAssistantInkTheme,
  resolveAssistantInkThemeForMode,
  resolveAssistantInkThemeForOpenChat,
  resolveAssistantInkThemeMode,
  resolveAssistantInkThemeModeForOpenChat,
} from '../src/assistant/ui/theme.js'
import {
  createModelSwitcherState,
  dismissModelSwitcher,
  ModelSwitcher,
  offsetModelSwitcherSelection,
  resolveModelSwitcherSelection,
} from '../src/assistant/ui/model-switcher.js'
import {
  ChatEntryRow,
  ChatHeader,
  ChatTranscriptFeed,
  partitionChatTranscriptEntries,
  shouldShowBusyStatus,
} from '../src/assistant/ui/ink-transcript.js'
import {
  formatQueuedFollowUpPreview,
  mergeComposerDraftWithQueuedPrompts,
  normalizeAssistantInkArrowKey,
} from '../src/assistant/ui/composer-terminal.js'
import { normalizeComposerInsertedText } from '../src/assistant/ui/composer-editing.js'
import { renderComposerValue } from '../src/assistant/ui/composer-render.js'
import {
  CHAT_COMPOSER_HINT,
  CHAT_STARTER_SUGGESTIONS,
  type InkChatEntry,
} from '../src/assistant/ui/view-model.js'
import { AssistantInkThemeContext } from '../src/assistant/ui/ink-layout.js'
import { createInkKey, renderInkOutput } from './helpers.ts'

const TEST_THEME = LIGHT_ASSISTANT_INK_THEME

function withTheme(node: React.ReactElement): React.ReactElement {
  return React.createElement(
    AssistantInkThemeContext.Provider,
    {
      value: TEST_THEME,
    },
    node,
  )
}

test('composer terminal helpers normalize raw keys, queue previews, and merge queued drafts deterministically', () => {
  const normalizedArrowKey = normalizeAssistantInkArrowKey(
    '\u001b[1;5A',
    createInkKey(),
  )
  assert.equal(normalizedArrowKey.ctrl, true)
  assert.equal(normalizedArrowKey.meta, false)
  assert.equal(normalizedArrowKey.shift, false)
  assert.equal(normalizedArrowKey.upArrow, true)
  assert.equal(normalizedArrowKey.downArrow, false)
  assert.equal(normalizedArrowKey.leftArrow, false)
  assert.equal(normalizedArrowKey.rightArrow, false)

  assert.equal(
    mergeComposerDraftWithQueuedPrompts('draft', ['queued one', 'queued two']),
    'draft\n\nqueued one\n\nqueued two',
  )
  assert.equal(
    normalizeComposerInsertedText('line 1\r\nline 2\rline 3'),
    'line 1\nline 2\nline 3',
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      '  This queued follow-up preview should collapse whitespace and trim cleanly.  ',
    ),
    'This queued follow-up preview should collapse whitespace and trim cleanly.',
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      'This queued follow-up is intentionally far longer than the preview budget so the formatter has to trim it on a sensible word boundary instead of dumping the whole prompt verbatim into the status line.',
    ).endsWith('…'),
    true,
  )
})

test('composer editing and render helpers honor cursor movement, word deletion, yank, and placeholder rendering', () => {
  const afterMetaDelete = applyComposerEditingInput(
    {
      cursorOffset: 6,
      killBuffer: '',
      value: 'hello brave world',
    },
    '',
    createInkKey({
      meta: true,
      delete: true,
    }),
  )
  assert.deepEqual(afterMetaDelete, {
    cursorOffset: 6,
    handled: true,
    killBuffer: 'brave',
    value: 'hello  world',
  })

  const afterYank = applyComposerEditingInput(
    afterMetaDelete,
    'y',
    createInkKey({
      ctrl: true,
    }),
  )
  assert.deepEqual(afterYank, {
    cursorOffset: 11,
    handled: true,
    killBuffer: 'brave',
    value: 'hello brave world',
  })

  const placeholderOutput = renderInkOutput(
    withTheme(
      renderComposerValue({
        cursorOffset: 0,
        disabled: false,
        placeholder: 'Type a message',
        theme: TEST_THEME,
        value: '',
      }),
    ),
  )
  assert.match(placeholderOutput, /Type a message/u)

  const newlineCursorOutput = renderInkOutput(
    withTheme(
      renderComposerValue({
        cursorOffset: 5,
        disabled: false,
        placeholder: 'Type a message',
        theme: TEST_THEME,
        value: 'line1\nline2',
      }),
    ),
  )
  assert.match(newlineCursorOutput, /line1\s+line2/u)

  const disabledComposerOutput = renderInkOutput(
    withTheme(
      renderComposerValue({
        cursorOffset: 2,
        disabled: true,
        placeholder: 'Type a message',
        theme: TEST_THEME,
        value: 'locked value',
      }),
    ),
  )
  assert.match(disabledComposerOutput, /locked value/u)
})

test('layout and message helpers wrap plain text, format footer badges, and parse markdown link targets', () => {
  assert.deepEqual(resolveChromePanelBoxProps({}), {
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 0,
    paddingY: 0,
    width: '100%',
  })
  assert.deepEqual(resolveChromePanelBoxProps({ backgroundColor: '#fff' }), {
    backgroundColor: '#fff',
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 1,
    paddingY: 0,
    width: '100%',
  })
  assert.equal(resolveAssistantChatViewportWidth(40), 38)
  assert.equal(resolveAssistantPlainTextWrapColumns(40), 37)
  assert.equal(
    wrapAssistantPlainText('  alpha beta gamma', 10),
    '  alpha\n  beta\n  gamma',
  )
  assert.match(
    renderInkOutput(
      renderWrappedPlainTextBlock({
        columns: 10,
        text: 'alpha beta gamma',
      }),
    ),
    /alpha\s+beta\s+gamma/u,
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'model',
      label: 'model',
      value: 'gpt-5.4',
    }),
    ' gpt-5.4 ',
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'vault',
      label: 'vault',
      value: 'vault-a',
    }),
    ' vault: vault-a ',
  )
  assert.equal(resolveMessageRoleLabel('assistant'), null)
  assert.equal(resolveMessageRoleLabel('error'), 'error')
  assert.deepEqual(splitAssistantMarkdownLinks('See [docs](https://example.com) now'), [
    {
      kind: 'text',
      text: 'See ',
    },
    {
      kind: 'link',
      label: 'docs',
      target: 'https://example.com',
    },
    {
      kind: 'text',
      text: ' now',
    },
  ])
  assert.equal(
    resolveAssistantHyperlinkTarget(path.resolve('/tmp/example.txt') + '#L1'),
    'file:///tmp/example.txt#L1',
  )
  assert.equal(resolveAssistantHyperlinkTarget('relative/path.md'), null)
  assert.equal(
    formatAssistantTerminalHyperlink('docs', 'https://example.com'),
    '\u001B]8;;https://example.com\u0007docs\u001B]8;;\u0007',
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        WT_SESSION: '1',
      },
      isTTY: true,
    }),
    true,
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        CI: 'true',
        FORCE_HYPERLINK: '1',
      },
      isTTY: true,
    }),
    false,
  )
})

test('transcript and composer panel components render chat guidance, busy state, and queued follow-ups without snapshots', () => {
  const entries: InkChatEntry[] = [
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'thinking',
      text: 'Working through the request',
    },
    {
      kind: 'assistant',
      text: 'final answer',
    },
  ]

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries,
    }),
    {
      liveEntries: [
        {
          kind: 'thinking',
          text: 'Working through the request',
        },
        {
          kind: 'assistant',
          text: 'final answer',
        },
      ],
      staticEntries: [
        {
          kind: 'user',
          text: 'hello',
        },
      ],
    },
  )
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries,
    }),
    false,
  )
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'hello',
        },
        {
          kind: 'thinking',
          text: 'still running',
        },
      ],
    }),
    true,
  )

  const transcriptOutput = renderInkOutput(
    withTheme(
      React.createElement(ChatTranscriptFeed, {
        bindingSummary: 'local · direct',
        busy: true,
        entries,
        sessionId: 'session-ui',
      }),
    ),
  )
  assert.match(transcriptOutput, /Murph/u)
  assert.match(transcriptOutput, /local · direct/u)
  assert.match(transcriptOutput, /hello/u)
  assert.match(transcriptOutput, /Working through the request/u)
  assert.match(transcriptOutput, /final answer/u)

  const composerOutput = renderInkOutput(
    withTheme(
      React.createElement(ChatComposer, {
        entryCount: 0,
        modelSwitcherActive: false,
        onChange: () => {},
        onEditLastQueuedPrompt: () => {},
        onSubmit: (): 'keep' => 'keep',
        value: '/m',
      }),
    ),
  )
  assert.match(composerOutput, /› \/m/u)
  assert.equal(composerOutput.includes('Enter send · Tab queue when busy'), true)
  assert.equal(composerOutput.includes('/session show session · /exit quit'), true)
  assert.match(composerOutput, /commands/u)
  assert.match(composerOutput, /\/model/u)

  const starterOutput = renderInkOutput(
    withTheme(
      React.createElement(ChatComposer, {
        entryCount: 0,
        modelSwitcherActive: false,
        onChange: () => {},
        onEditLastQueuedPrompt: () => {},
        onSubmit: (): 'keep' => 'keep',
        value: '',
      }),
    ),
  )
  assert.match(starterOutput, /try:/u)
  assert.match(starterOutput, new RegExp(CHAT_STARTER_SUGGESTIONS[0], 'u'))

  const busyStatusOutput = renderInkOutput(
    withTheme(
      React.createElement(ChatStatus, {
        busy: true,
        status: {
          kind: 'error',
          text: 'network stalled',
        },
      }),
    ),
  )
  assert.match(busyStatusOutput, /Working/u)
  assert.match(busyStatusOutput, /network stalled/u)

  const queuedOutput = renderInkOutput(
    withTheme(
      React.createElement(QueuedFollowUpStatus, {
        latestPrompt: 'Send the follow-up after this finishes',
        queuedPromptCount: 3,
      }),
    ),
  )
  assert.match(queuedOutput, /Queued follow-up messages/u)
  assert.match(queuedOutput, /\+2 more queued/u)
  assert.match(queuedOutput, /edit last queued message/u)

  const footerOutput = renderInkOutput(
    withTheme(
      React.createElement(ChatFooter, {
        badges: [
          {
            key: 'model',
            label: 'model',
            value: 'gpt-5.4',
          },
          {
            key: 'vault',
            label: 'vault',
            value: 'demo',
          },
        ],
      }),
    ),
  )
  assert.match(footerOutput, /gpt-5\.4/u)
  assert.match(footerOutput, /vault: demo/u)
})

test('theme helpers resolve deterministic light and dark behavior across launch and open-chat states', () => {
  assert.equal(inferAssistantInkThemeModeFromColorFgbg(undefined), null)
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('0;15'), 'light')
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('7;0'), 'dark')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle(''), 'light')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle(' Dark '), 'dark')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle('sepia'), null)

  assert.equal(resolveAssistantInkThemeForMode('light'), LIGHT_ASSISTANT_INK_THEME)
  assert.equal(resolveAssistantInkThemeForMode('dark'), DARK_ASSISTANT_INK_THEME)
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: 'dark',
      colorFgbg: '0;15',
      platform: 'darwin',
    }),
    'light',
  )
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: 'dark',
      colorFgbg: undefined,
      platform: 'darwin',
    }),
    'dark',
  )
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: 'dark',
      colorFgbg: undefined,
      platform: 'linux',
    }),
    'light',
  )

  assert.equal(
    resolveAssistantInkTheme({
      env: {
        COLORFGBG: '0;15',
      },
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'dark',
    }).mode,
    'light',
  )

  assert.deepEqual(
    captureAssistantInkThemeBaseline({
      env: {
        COLORFGBG: '0;15',
      },
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'dark',
    }),
    {
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      theme: LIGHT_ASSISTANT_INK_THEME,
    },
  )

  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: 'light',
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      platform: 'linux',
    }),
    'dark',
  )
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: 'light',
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: undefined,
      platform: 'darwin',
    }),
    'light',
  )
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: null,
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      platform: 'darwin',
    }),
    'dark',
  )
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: 'dark',
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      platform: 'darwin',
    }),
    'light',
  )
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'light',
      currentAppleInterfaceStyle: 'light',
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      platform: 'darwin',
    }),
    'light',
  )
  assert.equal(
    resolveAssistantInkThemeForOpenChat({
      currentMode: 'dark',
      initialAppleInterfaceStyle: 'dark',
      initialColorFgbg: '0;15',
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'light',
    }).mode,
    'light',
  )
})

test('model switcher helpers and component preserve current selections across model and reasoning modes', () => {
  const models = [
    {
      capabilities: {
        images: false,
        pdf: false,
        reasoning: true,
        streaming: true,
        tools: true,
      },
      id: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Fast default',
      source: 'static',
    },
    {
      capabilities: {
        images: false,
        pdf: false,
        reasoning: false,
        streaming: true,
        tools: true,
      },
      id: 'gpt-5.4-mini',
      label: 'GPT-5.4 mini',
      description: 'Cheaper default',
      source: 'static',
    },
  ] satisfies readonly AssistantCatalogModel[]
  const modelOptions = models.map((model) => ({
    description: model.description,
    label: model.label,
    value: model.id,
  }))

  const initialState = createModelSwitcherState({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'high',
    models,
    modelOptions,
  })
  assert.equal(initialState.modelIndex, 0)
  assert.equal(initialState.reasoningIndex, 2)
  assert.deepEqual(
    offsetModelSwitcherSelection({
      activeReasoningEffort: 'high',
      delta: 1,
      state: initialState,
    }),
    {
      ...initialState,
      modelIndex: 1,
      reasoningIndex: 0,
      reasoningOptions: [],
    },
  )
  assert.deepEqual(
    offsetModelSwitcherSelection({
      activeReasoningEffort: 'high',
      delta: -1,
      state: {
        ...initialState,
        mode: 'reasoning',
        reasoningIndex: 0,
      },
    }),
    {
      ...initialState,
      mode: 'reasoning',
      reasoningIndex: 3,
    },
  )

  const selectedModel = resolveModelSwitcherSelection({
    activeModel: 'fallback-model',
    activeReasoningEffort: 'medium',
    selection: {
      ...initialState,
      mode: 'reasoning',
      reasoningIndex: 1,
    },
  })
  assert.deepEqual(selectedModel, {
    nextModel: 'gpt-5.4',
    nextReasoningEffort: 'medium',
    selectedLabel: 'gpt-5.4 medium',
  })
  assert.deepEqual(
    resolveModelSwitcherSelection({
      activeModel: 'fallback-model',
      activeReasoningEffort: 'medium',
      selection: {
        ...initialState,
        mode: 'reasoning',
        modelIndex: 1,
        reasoningIndex: 0,
        reasoningOptions: [],
      },
    }),
    {
      nextModel: 'gpt-5.4-mini',
      nextReasoningEffort: null,
      selectedLabel: 'gpt-5.4-mini',
    },
  )
  assert.deepEqual(
    dismissModelSwitcher({
      ...initialState,
      mode: 'reasoning',
    }),
    {
      ...initialState,
      mode: 'model',
    },
  )
  assert.equal(dismissModelSwitcher(initialState), null)
  assert.equal(
    createModelSwitcherState({
      activeModel: 'missing-model',
      activeReasoningEffort: null,
      models,
      modelOptions,
    }).modelIndex,
    0,
  )

  const switcherOutput = renderInkOutput(
    React.createElement(ModelSwitcher, {
      currentModel: 'gpt-5.4',
      currentReasoningEffort: 'high',
      mode: 'reasoning',
      modelIndex: 0,
      modelOptions,
      onCancel: () => {},
      onConfirm: () => {},
      onMove: () => {},
      reasoningIndex: 2,
      reasoningOptions: [
        { description: 'Faster answers', label: 'low', value: 'low' },
        { description: 'Balanced answers', label: 'medium', value: 'medium' },
        { description: 'Deep answers', label: 'high', value: 'high' },
      ],
      theme: TEST_THEME,
    }),
  )
  assert.match(switcherOutput, /Choose reasoning for gpt-5\.4/u)
  assert.match(switcherOutput, /gpt-5\.4/u)
  assert.match(switcherOutput, /current/u)
  assert.match(switcherOutput, /Deep answers/u)
  assert.match(switcherOutput, /Step 2 of 2/u)
  assert.match(switcherOutput, /Enter confirm · Esc back/u)
  assert.match(switcherOutput, /medium \(default\)/u)

  assert.match(
    renderInkOutput(
      React.createElement(ModelSwitcher, {
        currentModel: 'gpt-5.4',
        currentReasoningEffort: null,
        mode: 'model',
        modelIndex: 1,
        modelOptions,
        onCancel: () => {},
        onConfirm: () => {},
        onMove: () => {},
        reasoningIndex: 0,
        reasoningOptions: [],
        theme: TEST_THEME,
      }),
    ),
    /Choose a model/u,
  )
  assert.match(
    renderInkOutput(
      React.createElement(ModelSwitcher, {
        currentModel: 'gpt-5.4-mini',
        currentReasoningEffort: null,
        mode: 'model',
        modelIndex: 1,
        modelOptions,
        onCancel: () => {},
        onConfirm: () => {},
        onMove: () => {},
        reasoningIndex: 0,
        reasoningOptions: [],
        theme: TEST_THEME,
      }),
    ),
    /Enter confirms the active model/u,
  )
  assert.match(
    renderInkOutput(
      React.createElement(ModelSwitcher, {
        currentModel: 'gpt-5.4',
        currentReasoningEffort: null,
        mode: 'model',
        modelIndex: 0,
        modelOptions,
        onCancel: () => {},
        onConfirm: () => {},
        onMove: () => {},
        reasoningIndex: 0,
        reasoningOptions: [
          { description: 'Balanced answers', label: 'medium', value: 'medium' },
        ],
        theme: TEST_THEME,
      }),
    ),
    /Step 1 of 2/u,
  )
})

test('transcript helpers and rows cover compact header, non-user busy flows, and entry rendering variants', () => {
  const compactColumns = process.stderr.columns
  const compactRows = process.stderr.rows
  process.stderr.columns = 60
  process.stderr.rows = 16

  try {
    const compactHeaderOutput = renderInkOutput(
      withTheme(
        React.createElement(ChatHeader, {
          bindingSummary: 'telegram · thread',
        }),
      ),
    )
    assert.match(compactHeaderOutput, /Murph/u)
    assert.match(compactHeaderOutput, /telegram · thread/u)
    assert.doesNotMatch(compactHeaderOutput, /interactive chat/u)
  } finally {
    process.stderr.columns = compactColumns
    process.stderr.rows = compactRows
  }

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries: [],
    }),
    {
      liveEntries: [],
      staticEntries: [],
    },
  )
  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: false,
      entries: [{ kind: 'assistant', text: 'done' }],
    }),
    {
      liveEntries: [],
      staticEntries: [{ kind: 'assistant', text: 'done' }],
    },
  )
  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries: [{ kind: 'status', text: 'warming up' }],
    }),
    {
      liveEntries: [{ kind: 'status', text: 'warming up' }],
      staticEntries: [],
    },
  )
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [{ kind: 'status', text: 'warming up' }],
    }),
    true,
  )
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        { kind: 'user', text: 'hello' },
        { kind: 'assistant', text: '   ' },
      ],
    }),
    true,
  )
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        { kind: 'user', text: 'hello' },
        { kind: 'error', text: 'network failed' },
      ],
    }),
    false,
  )

  const assistantRow = renderInkOutput(
    withTheme(
      React.createElement(ChatEntryRow, {
        entry: { kind: 'assistant', text: 'assistant reply' },
      }),
    ),
  )
  const errorRow = renderInkOutput(
    withTheme(
      React.createElement(ChatEntryRow, {
        entry: { kind: 'error', text: 'bad gateway' },
      }),
    ),
  )
  const traceRow = renderInkOutput(
    withTheme(
      React.createElement(ChatEntryRow, {
        entry: {
          kind: 'trace',
          pending: true,
          text: 'trace line',
          traceId: 'trace:1',
          traceKind: 'tool',
        },
      }),
    ),
  )
  const statusRow = renderInkOutput(
    withTheme(
      React.createElement(ChatEntryRow, {
        entry: { kind: 'status', text: 'still working' },
      }),
    ),
  )
  const userRow = renderInkOutput(
    withTheme(
      React.createElement(ChatEntryRow, {
        entry: { kind: 'user', text: 'hello user' },
      }),
    ),
  )

  assert.match(assistantRow, /assistant reply/u)
  assert.match(errorRow, /bad gateway/u)
  assert.match(traceRow, /trace line/u)
  assert.match(statusRow, /still working/u)
  assert.match(userRow, /hello user/u)
})
