import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

type InputEvent = {
  key?: Partial<{
    ctrl: boolean
    downArrow: boolean
    escape: boolean
    leftArrow: boolean
    return: boolean
    upArrow: boolean
  }>
  value?: string
}

const inkState = vi.hoisted(() => ({
  events: [] as InputEvent[],
  exitCalls: 0,
}))

vi.mock('react', async () => {
  type HookContext = {
    effects: Array<() => void>
    index: number
    pendingRerender: boolean
    refs: unknown[]
    rerender: (() => void) | null
    states: unknown[]
  }

  const current = {
    ctx: null as HookContext | null,
  }

  function requireContext(): HookContext {
    if (!current.ctx) {
      throw new Error('React hooks were used outside the mocked renderer.')
    }
    return current.ctx
  }

  const createElement = (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ({
    props: {
      ...(props ?? {}),
      children,
    },
    type,
  })
  const useEffect = (effect: () => void) => {
    requireContext().effects.push(effect)
  }
  const useRef = <T,>(initialValue: T) => {
    const ctx = requireContext()
    const index = ctx.index++
    if (ctx.refs[index] === undefined) {
      ctx.refs[index] = { current: initialValue }
    }
    return ctx.refs[index] as { current: T }
  }
  const useState = <T,>(initialValue: T) => {
    const ctx = requireContext()
    const index = ctx.index++
    if (ctx.states[index] === undefined) {
      ctx.states[index] = initialValue
    }

    return [
      ctx.states[index] as T,
      (next: T | ((value: T) => T)) => {
        const resolved =
          typeof next === 'function'
            ? (next as (value: T) => T)(ctx.states[index] as T)
            : next
        if (!Object.is(ctx.states[index], resolved)) {
          ctx.states[index] = resolved
          ctx.pendingRerender = true
        }
      },
    ] as const
  }

  const ReactMock = {
    Children: {
      toArray(children: unknown) {
        return Array.isArray(children) ? children : [children]
      },
    },
    createElement,
    useEffect,
    useRef,
    useState,
    __setContext(ctx: HookContext | null) {
      current.ctx = ctx
    },
  }

  return {
    createElement,
    default: ReactMock,
    useEffect,
    useRef,
    useState,
  }
})

vi.mock('ink', async () => {
  const React = (await import('react')).default as unknown as {
    __setContext: (ctx: unknown) => void
    createElement: (...args: unknown[]) => unknown
  }

  let inputHandler:
    | ((value: string, key: Record<string, boolean | undefined>) => void)
    | null = null

  function render(element: { type: () => unknown }) {
    const ctx = {
      effects: [] as Array<() => void>,
      index: 0,
      pendingRerender: false,
      refs: [] as unknown[],
      rerender: null as (() => void) | null,
      states: [] as unknown[],
    }

    const runRender = () => {
      do {
        ctx.pendingRerender = false
        ctx.effects = []
        ctx.index = 0
        React.__setContext(ctx)
        element.type()
        React.__setContext(null)
        const effects = [...ctx.effects]
        ctx.effects = []
        for (const effect of effects) {
          effect()
        }
      } while (ctx.pendingRerender)
    }

    ctx.rerender = runRender
    runRender()

    const waitUntilExit = (async () => {
      for (const event of inkState.events) {
        inputHandler?.(event.value ?? '', event.key ?? {})
        ctx.rerender?.()
      }
    })()

    return {
      unmount() {},
      waitUntilExit: async () => {
        await waitUntilExit
      },
    }
  }

  return {
    Box(props: Record<string, unknown>) {
      return React.createElement('box', props)
    },
    Text(props: Record<string, unknown>) {
      return React.createElement('text', props)
    },
    render,
    useApp() {
      return {
        exit() {
          inkState.exitCalls += 1
        },
      }
    },
    useInput(handler: (value: string, key: Record<string, boolean | undefined>) => void) {
      inputHandler = handler
    },
  }
})

afterEach(() => {
  inkState.events = []
  inkState.exitCalls = 0
  vi.resetModules()
})

test('assistant wizard walks the default OpenAI sign-in flow to a saved selection', async () => {
  inkState.events = [
    { key: { return: true } },
    { key: { return: true } },
    { key: { return: true } },
  ]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')
  const result = await runSetupAssistantWizard({
    initialAssistantPreset: 'codex',
  })

  assert.deepEqual(result, {
    assistantApiKeyEnv: null,
    assistantBaseUrl: null,
    assistantOss: false,
    assistantPreset: 'codex',
    assistantProviderName: null,
  })
  assert.equal(inkState.exitCalls, 1)
})

test('assistant wizard can switch to a named compatible provider and finish the flow', async () => {
  inkState.events = [
    { key: { downArrow: true } },
    { key: { downArrow: true } },
    { key: { return: true } },
    { key: { return: true } },
    { key: { return: true } },
  ]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')
  const result = await runSetupAssistantWizard({
    initialAssistantApiKeyEnv: '  CUSTOM_KEY  ',
    initialAssistantBaseUrl: ' https://example.test/v1 ',
    initialAssistantPreset: 'openai-compatible',
    initialAssistantProviderName: ' custom-provider ',
  })

  assert.deepEqual(result, {
    assistantApiKeyEnv: 'OPENROUTER_API_KEY',
    assistantBaseUrl: 'https://openrouter.ai/api/v1',
    assistantOss: false,
    assistantPreset: 'openai-compatible',
    assistantProviderName: 'openrouter',
  })
})

test('assistant wizard surfaces the cancellation error when the user quits from the provider step', async () => {
  inkState.events = [{ value: 'q' }]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')

  await assert.rejects(
    runSetupAssistantWizard({
      initialAssistantPreset: 'codex',
    }),
    /Murph model selection was cancelled/u,
  )
})

test('assistant wizard also cancels when escape is pressed on the provider step', async () => {
  inkState.events = [{ key: { escape: true } }]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')

  await assert.rejects(
    runSetupAssistantWizard({
      initialAssistantPreset: 'codex',
    }),
    /Murph model selection was cancelled/u,
  )
})

test('assistant wizard can go back from review to the method step before saving', async () => {
  inkState.events = [
    { key: { return: true } },
    { key: { downArrow: true } },
    { key: { return: true } },
    { key: { leftArrow: true } },
    { key: { upArrow: true } },
    { key: { return: true } },
    { key: { return: true } },
  ]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')
  const result = await runSetupAssistantWizard({
    initialAssistantPreset: 'codex',
  })

  assert.deepEqual(result, {
    assistantApiKeyEnv: null,
    assistantBaseUrl: null,
    assistantOss: false,
    assistantPreset: 'codex',
    assistantProviderName: null,
  })
})

test('assistant wizard lets the user back out of the method step and switch providers', async () => {
  inkState.events = [
    { key: { return: true } },
    { key: { escape: true } },
    { key: { downArrow: true } },
    { key: { downArrow: true } },
    { key: { return: true } },
    { key: { return: true } },
    { key: { return: true } },
  ]

  const { runSetupAssistantWizard } = await import('../src/setup-assistant-wizard.ts')
  const result = await runSetupAssistantWizard({
    initialAssistantPreset: 'codex',
  })

  assert.deepEqual(result, {
    assistantApiKeyEnv: 'VENICE_API_KEY',
    assistantBaseUrl: 'https://api.venice.ai/api/v1',
    assistantOss: false,
    assistantPreset: 'openai-compatible',
    assistantProviderName: 'venice',
  })
})
