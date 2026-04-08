import assert from 'node:assert/strict'
import * as React from 'react'
import { render } from 'ink'
import { beforeEach, test, vi } from 'vitest'

import type { Key } from 'ink'

const inkMocks = vi.hoisted(() => ({
  handlers: [] as Array<(input: string, key: Key) => void>,
  useInput: vi.fn((handler: (input: string, key: Key) => void) => {
    inkMocks.handlers.push(handler)
  }),
}))

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')

  return {
    ...actual,
    useInput: inkMocks.useInput,
    useStdout: () => ({
      stdout: {
        columns: 80,
      },
    }),
  }
})

import {
  ChatComposer,
  ChatFooter,
  ChatStatus,
  QueuedFollowUpStatus,
} from '../src/assistant/ui/ink-composer-panel.js'
import {
  LIGHT_ASSISTANT_INK_THEME,
} from '../src/assistant/ui/theme.js'
import {
  createModelSwitcherState,
  ModelSwitcher,
} from '../src/assistant/ui/model-switcher.js'
import {
  AssistantMessageText,
  supportsAssistantTerminalHyperlinks,
} from '../src/assistant/ui/ink-message-text.js'
import {
  AssistantInkThemeContext,
} from '../src/assistant/ui/ink-layout.js'
import {
  createInkKey,
  createInkTestInput,
  createInkTestOutput,
  flushAsyncWork,
  renderInkOutput,
} from './helpers.ts'

function key(overrides: Partial<Key> = {}): Key {
  return createInkKey(overrides)
}

function withTheme(node: React.ReactElement): React.ReactElement {
  return React.createElement(
    AssistantInkThemeContext.Provider,
    {
      value: LIGHT_ASSISTANT_INK_THEME,
    },
    node,
  )
}

beforeEach(() => {
  inkMocks.handlers.length = 0
  inkMocks.useInput.mockClear()
})

test('ChatComposer handles editing, submit, queued-edit shortcuts, and disabled mode on a mounted Ink tree', async () => {
  const stdin = createInkTestInput()
  const stdout = createInkTestOutput()
  const stderr = createInkTestOutput()
  const changes: string[] = []
  const submits: Array<{ mode: 'enter' | 'tab'; value: string }> = []
  let editLastQueuedCalls = 0
  let setDisabled: ((next: boolean) => void) | null = null

  function Harness(): React.ReactElement {
    const [value, setValue] = React.useState('')
    const [disabled, setDisabledState] = React.useState(false)
    setDisabled = (next) => {
      setDisabledState(next)
    }

    return withTheme(
      React.createElement(ChatComposer, {
        entryCount: 0,
        modelSwitcherActive: disabled,
        onChange(next) {
          changes.push(next)
          setValue(next)
        },
        onEditLastQueuedPrompt() {
          editLastQueuedCalls += 1
        },
        onSubmit(nextValue, mode) {
          submits.push({ mode, value: nextValue })
          return 'clear'
        },
        value,
      }),
    )
  }

  const instance = render(React.createElement(Harness), {
    patchConsole: false,
    stdin,
    stdout,
    stderr,
  })

  await flushAsyncWork(8)

  const composerHandler = inkMocks.handlers[0]
  assert.ok(composerHandler)

  composerHandler?.('h', key())
  composerHandler?.('i', key())
  await flushAsyncWork(8)
  assert.deepEqual(changes.slice(-2), ['h', 'hi'])

  composerHandler?.('', {
    ...key(),
    shift: true,
    tab: true,
  })
  composerHandler?.('c', {
    ...key(),
    ctrl: true,
  })
  await flushAsyncWork(4)
  assert.deepEqual(submits, [])

  composerHandler?.('\u007f', key())
  await flushAsyncWork(8)
  assert.equal(changes.at(-1), 'h')

  composerHandler?.('', {
    ...key(),
    tab: true,
  })
  await flushAsyncWork(8)
  assert.deepEqual(submits.at(-1), {
    mode: 'tab',
    value: 'h',
  })
  assert.equal(changes.at(-1), '')

  composerHandler?.('\u001b[1;3A', key())
  await flushAsyncWork(4)
  assert.equal(editLastQueuedCalls, 1)

  composerHandler?.('', {
    ...key(),
    upArrow: true,
  })
  composerHandler?.('', {
    ...key(),
    downArrow: true,
  })
  composerHandler?.('', {
    ...key(),
    ctrl: true,
  })
  await flushAsyncWork(4)

  const disabledSetter: unknown = setDisabled
  if (typeof disabledSetter !== 'function') {
    throw new Error('disabled setter was not captured')
  }
  disabledSetter(true)
  await flushAsyncWork(8)
  composerHandler?.('z', key())
  await flushAsyncWork(8)
  assert.equal(changes.includes('z'), false)

  instance.unmount()
  await flushAsyncWork(4)
  stdin.destroy()
  stdout.destroy()
  stderr.destroy()
})

test('status, queued follow-up, footer, message text, and model switcher surfaces cover interaction branches', async () => {
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        TERM_PROGRAM: 'WarpTerminal',
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

  const renderedStatus = renderInkOutput(
    withTheme(
      React.createElement(
        React.Fragment,
        {},
        React.createElement(ChatStatus, {
          busy: true,
          status: {
            kind: 'error',
            text: 'network retry pending',
          },
        }),
        React.createElement(QueuedFollowUpStatus, {
          latestPrompt: 'Follow up with a much longer queued prompt for preview trimming',
          queuedPromptCount: 3,
        }),
        React.createElement(ChatFooter, {
          badges: [
            {
              key: 'model',
              label: 'model',
              value: 'gpt-5.4',
            },
          ],
        }),
        React.createElement(AssistantMessageText, {
          text: 'See [docs](https://example.com) and [/tmp/file](/tmp/file.txt#L1)',
        }),
      ),
    ),
  )

  assert.match(renderedStatus, /Working/u)
  assert.match(renderedStatus, /Queued follow-up messages/u)
  assert.match(renderedStatus, /gpt-5\.4/u)
  assert.match(renderedStatus, /docs/u)
  assert.match(renderedStatus, /\/tmp\/file/u)
  assert.equal(
    renderInkOutput(
      withTheme(
        React.createElement(ChatStatus, {
          busy: false,
          status: null,
        }),
      ),
    ).trim(),
    '',
  )
  assert.match(
    renderInkOutput(
      withTheme(
        React.createElement(ChatStatus, {
          busy: false,
          status: {
            kind: 'success',
            text: 'Delivered successfully',
          },
        }),
      ),
    ),
    /Delivered successfully/u,
  )
  assert.equal(
    renderInkOutput(
      withTheme(
        React.createElement(QueuedFollowUpStatus, {
          latestPrompt: null,
          queuedPromptCount: 0,
        }),
      ),
    ).trim(),
    '',
  )
  assert.doesNotMatch(
    renderInkOutput(
      withTheme(
        React.createElement(ChatComposer, {
          entryCount: 1,
          modelSwitcherActive: true,
          onChange: () => undefined,
          onEditLastQueuedPrompt: () => undefined,
          onSubmit: (): 'keep' => 'keep',
          value: '/model',
        }),
      ),
    ),
    /commands/u,
  )

  const stdin = createInkTestInput()
  const stdout = createInkTestOutput()
  const stderr = createInkTestOutput()
  const moves: number[] = []
  let cancels = 0
  let confirms = 0

  const modelSwitcherState = createModelSwitcherState({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'medium',
    models: [
      {
        capabilities: {
          images: false,
          pdf: false,
          reasoning: true,
          streaming: true,
          tools: true,
        },
        description: 'Fast default',
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        source: 'static',
      },
    ],
    modelOptions: [
      {
        description: 'Fast default',
        value: 'gpt-5.4',
      },
    ],
  })

  const instance = render(
    withTheme(
      React.createElement(ModelSwitcher, {
        currentModel: 'gpt-5.4',
        currentReasoningEffort: 'medium',
        mode: modelSwitcherState.mode,
        modelIndex: modelSwitcherState.modelIndex,
        modelOptions: modelSwitcherState.modelOptions,
        onCancel() {
          cancels += 1
        },
        onConfirm() {
          confirms += 1
        },
        onMove(delta) {
          moves.push(delta)
        },
        reasoningIndex: modelSwitcherState.reasoningIndex,
        reasoningOptions: modelSwitcherState.reasoningOptions,
        theme: LIGHT_ASSISTANT_INK_THEME,
      }),
    ),
    {
      patchConsole: false,
      stdin,
      stdout,
      stderr,
    },
  )

  await flushAsyncWork(8)

  const switcherHandler = inkMocks.handlers.at(-1)
  assert.ok(switcherHandler)

  switcherHandler?.('j', key())
  switcherHandler?.('k', key())
  switcherHandler?.('', {
    ...key(),
    return: true,
  })
  switcherHandler?.('', {
    ...key(),
    escape: true,
  })
  await flushAsyncWork(4)

  assert.deepEqual(moves, [1, -1])
  assert.equal(confirms, 1)
  assert.equal(cancels, 1)

  instance.unmount()
  await flushAsyncWork(4)
  stdin.destroy()
  stdout.destroy()
  stderr.destroy()
})
