import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  findComposerNextWordEnd,
  findComposerPreviousWordStart,
  reconcileComposerControlledValue,
  resolveComposerVerticalCursorMove,
} from '../src/assistant/ui/composer-state.js'
import {
  captureAssistantInkThemeBaseline,
  DARK_ASSISTANT_INK_THEME,
  inferAssistantInkThemeModeFromAppleInterfaceStyle,
  inferAssistantInkThemeModeFromColorFgbg,
  LIGHT_ASSISTANT_INK_THEME,
  resolveAssistantInkTheme,
  resolveAssistantInkThemeForOpenChat,
  resolveAssistantInkThemeModeForOpenChat,
} from '../src/assistant/ui/theme.js'
import {
  applyInkChatTraceUpdates,
  applyProviderProgressEventToEntries,
  finalizePendingInkChatTraces,
} from '../src/assistant/ui/view-model.js'

test('theme helpers prefer terminal color hints, capture launch baselines, and adapt open chat mode on macOS', () => {
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('0;15'), 'light')
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('7;0'), 'dark')
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('bogus'), null)
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle(' Dark '), 'dark')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle(''), 'light')

  assert.deepEqual(
    resolveAssistantInkTheme({
      env: {
        COLORFGBG: '0;0',
      },
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'Light',
    }),
    DARK_ASSISTANT_INK_THEME,
  )

  const baseline = captureAssistantInkThemeBaseline({
    env: {
      COLORFGBG: '0;15',
    },
    platform: 'darwin',
    readAppleInterfaceStyle: () => 'Light',
  })

  assert.equal(baseline.initialAppleInterfaceStyle, 'Light')
  assert.equal(baseline.initialColorFgbg, '0;15')
  assert.deepEqual(baseline.theme, LIGHT_ASSISTANT_INK_THEME)

  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: baseline.theme.mode,
      currentAppleInterfaceStyle: 'Dark',
      initialAppleInterfaceStyle: baseline.initialAppleInterfaceStyle,
      initialColorFgbg: baseline.initialColorFgbg,
      platform: 'darwin',
    }),
    'dark',
  )

  assert.deepEqual(
    resolveAssistantInkThemeForOpenChat({
      currentMode: baseline.theme.mode,
      initialAppleInterfaceStyle: baseline.initialAppleInterfaceStyle,
      initialColorFgbg: baseline.initialColorFgbg,
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'Dark',
    }),
    DARK_ASSISTANT_INK_THEME,
  )
})

test('provider progress helpers dedupe and finalize trace entries deterministically', () => {
  const pendingEntries = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'turn_123:search',
      kind: 'search',
      state: 'running',
      text: '  finding recent labs  ',
    },
  })

  assert.deepEqual(pendingEntries, [
    {
      kind: 'trace',
      pending: true,
      text: 'finding recent labs',
      traceId: 'turn_123:search',
      traceKind: 'search',
    },
  ])

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: pendingEntries,
      event: {
        id: 'turn_123:search',
        kind: 'search',
        state: 'running',
        text: 'finding recent labs',
      },
    }),
    pendingEntries,
  )

  const updatedEntries = applyProviderProgressEventToEntries({
    entries: pendingEntries,
    event: {
      id: 'turn_123:search',
      kind: 'search',
      state: 'completed',
      text: 'found recent labs',
    },
  })

  assert.deepEqual(updatedEntries, [
    {
      kind: 'trace',
      pending: false,
      text: 'found recent labs',
      traceId: 'turn_123:search',
      traceKind: 'search',
    },
  ])

  assert.deepEqual(
    finalizePendingInkChatTraces(
      [
        {
          kind: 'trace',
          pending: true,
          text: 'tool still running',
          traceId: 'turn_123:tool',
          traceKind: 'tool',
        },
        {
          kind: 'trace',
          pending: true,
          text: 'other turn',
          traceId: 'turn_999:tool',
          traceKind: 'tool',
        },
      ],
      'turn_123',
    ),
    [
      {
        kind: 'trace',
        pending: false,
        text: 'tool still running',
        traceId: 'turn_123:tool',
        traceKind: 'tool',
      },
      {
        kind: 'trace',
        pending: true,
        text: 'other turn',
        traceId: 'turn_999:tool',
        traceKind: 'tool',
      },
    ],
  )
})

test('trace update helpers replace and append stream content while ignoring empty updates', () => {
  const entries = applyInkChatTraceUpdates([], [
    {
      kind: 'thinking',
      streamKey: 'thinking:1',
      text: 'Plan',
    },
    {
      kind: 'assistant',
      streamKey: 'assistant:1',
      text: 'First line',
    },
    {
      kind: 'assistant',
      mode: 'append',
      streamKey: 'assistant:1',
      text: '\nSecond line',
    },
    {
      kind: 'assistant',
      streamKey: 'assistant:2',
      text: '',
    },
  ])

  assert.deepEqual(entries, [
    {
      kind: 'thinking',
      streamKey: 'thinking:1',
      text: 'Plan',
    },
    {
      kind: 'assistant',
      streamKey: 'assistant:1',
      text: 'First line\nSecond line',
    },
  ])
})

test('composer state helpers preserve pending echoes and cursor movement across wrapped lines', () => {
  assert.deepEqual(
    reconcileComposerControlledValue({
      cursorOffset: 20,
      currentValue: 'draft',
      nextControlledValue: 'queued 1',
      pendingValues: ['queued 1', 'queued 2'],
      previousControlledValue: 'previous',
    }),
    {
      cursorOffset: 5,
      nextValue: 'draft',
      pendingValues: ['queued 2'],
    },
  )

  assert.deepEqual(
    reconcileComposerControlledValue({
      cursorOffset: 2,
      currentValue: 'draft',
      nextControlledValue: 'remote update',
      pendingValues: ['queued 1'],
      previousControlledValue: 'previous',
    }),
    {
      cursorOffset: 'remote update'.length,
      nextValue: 'remote update',
      pendingValues: [],
    },
  )

  assert.deepEqual(
    resolveComposerVerticalCursorMove({
      cursorOffset: 1,
      direction: 'down',
      preferredColumn: null,
      value: 'ab\ncdef\nxy',
    }),
    {
      cursorOffset: 4,
      preferredColumn: 1,
    },
  )

  assert.equal(findComposerPreviousWordStart('hello, world', 12), 7)
  assert.equal(findComposerNextWordEnd('hello, world', 5), 6)
  assert.equal(findComposerNextWordEnd('hello, world', 7), 12)
})
