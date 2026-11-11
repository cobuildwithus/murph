import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
  type AssistantSystemPromptLayers,
} from '../src/assistant/system-prompt.js'
import {
  ASSISTANT_PROMPT_BLOCK_DEFINITIONS,
  type AssistantPromptBlock,
  type AssistantPromptBlockAudience,
  type AssistantPromptBlockId,
  type AssistantPromptBlockLayer,
} from '../src/assistant/system-prompt-blocks.js'
import {
  HOSTED_ROUTE_BASE,
  PROMPT_ROUTE_CLI_CONTRACT,
  PROMPT_ROUTE_INPUTS,
  renderPromptRoutes,
  sweepPromptInputs,
} from './support/prompt-route-fixtures.js'

/**
 * Which prompt blocks reach which route.
 *
 * These tests name block ids, routes and input flags. They never quote prompt
 * wording, so rewording a block does not touch them. Adding, renaming,
 * removing or re-routing a block does: regenerate the matrix with
 *
 *   MURPH_UPDATE_PROMPT_ROUTE_MATRIX=1 pnpm --dir packages/assistant-engine \
 *     exec vitest run --config vitest.config.ts --no-coverage test/prompt-route-matrix.test.ts
 *
 * and review the diff of test/support/prompt-route-matrix.json by id.
 */
const MATRIX_PATH = fileURLToPath(new URL('./support/prompt-route-matrix.json', import.meta.url))

const ALL_IDS = Object.keys(ASSISTANT_PROMPT_BLOCK_DEFINITIONS) as AssistantPromptBlockId[]
const ids = (layers: AssistantSystemPromptLayers): AssistantPromptBlockId[] =>
  layers.blocks.map((block) => block.id)
const render = (input: AssistantSystemPromptInput) => buildAssistantSystemPromptLayers(input)

const ALLOWED_AUDIENCES: Record<string, readonly AssistantPromptBlockAudience[]> = {
  direct: ['any', 'private', 'private-or-group'],
  group: ['any', 'group', 'private-or-group'],
  'unverified-external': ['any', 'unverified'],
}

function layerText(layers: AssistantSystemPromptLayers, layer: AssistantPromptBlockLayer): string {
  return {
    core: layers.staticCacheableCorePrompt,
    route: layers.stableRouteCapabilityPrompt,
    thread: layers.threadContextPrompt,
    turn: layers.dynamicTurnContextPrompt,
  }[layer]
}

function expectBlocksAreTheRender(layers: AssistantSystemPromptLayers): void {
  for (const layer of ['core', 'route', 'thread', 'turn'] as const) {
    const text = layers.blocks
      .filter((block) => block.layer === layer)
      .map((block) => block.text)
      .join('\n\n')
    expect(layerText(layers, layer)).toBe(text)
  }
  expect(layers.prompt).toBe(layers.blocks.map((block) => block.text).join('\n\n'))
}

describe('prompt route matrix', () => {
  const routes = renderPromptRoutes()

  it('admits exactly the committed blocks to each named route', () => {
    const actual = Object.fromEntries(
      Object.entries(routes).map(([route, layers]) => [route, ids(layers)]),
    )
    if (process.env.MURPH_UPDATE_PROMPT_ROUTE_MATRIX === '1') {
      writeFileSync(MATRIX_PATH, `${JSON.stringify(actual, null, 2)}\n`)
    }
    expect(actual).toEqual(JSON.parse(readFileSync(MATRIX_PATH, 'utf8')))
  })

  it('renders each layer as exactly its blocks, in order, with no id in the text', () => {
    for (const layers of Object.values(routes)) {
      expectBlocksAreTheRender(layers)
      for (const id of ALL_IDS) expect(layers.prompt.includes(id)).toBe(false)
    }
    for (const input of sweepPromptInputs()) expectBlocksAreTheRender(render(input))
  })

  it('never admits a block twice and keeps every block in its declared layer order', () => {
    const layerOrder: AssistantPromptBlockLayer[] = ['core', 'route', 'thread', 'turn']
    for (const input of sweepPromptInputs()) {
      const blocks = render(input).blocks
      expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length)
      const positions = blocks.map((block) => layerOrder.indexOf(block.layer))
      expect(positions).toEqual([...positions].sort((left, right) => left - right))
    }
  })

  it('admits a block only to the audience it declares', () => {
    for (const input of sweepPromptInputs()) {
      const scope = input.conversationScope ?? 'direct'
      const offenders = render(input).blocks
        .filter((block) => !ALLOWED_AUDIENCES[scope]!.includes(block.audience))
        .map((block) => `${block.id} (${block.audience}) reached ${scope} ${input.channel ?? 'local'}`)
      expect(offenders).toEqual([])
    }
  })

  it('gives an unverified audience no route capabilities and no private or group block', () => {
    for (const input of sweepPromptInputs()) {
      if (input.conversationScope !== 'unverified-external') continue
      const layers = render(input)
      expect(layers.stableRouteCapabilityPrompt).toBe('')
      expect(layers.blocks.filter((block) => block.layer === 'route')).toEqual([])
      expect(ids(layers)).toContain('core.unverified-external')
      expect(ids(layers)).toContain('thread.conversation-scope.unverified')
    }
  })

  it('admits every registered block on at least one input', () => {
    const seen = new Set<AssistantPromptBlockId>()
    for (const layers of Object.values(routes)) for (const id of ids(layers)) seen.add(id)
    for (const input of sweepPromptInputs()) for (const id of ids(render(input))) seen.add(id)
    expect(ALL_IDS.filter((id) => !seen.has(id))).toEqual([])
  })

  it('keeps the injected CLI contract as the last route block, byte for byte', () => {
    for (const route of ['direct-linq', 'direct-linq-onboarding', 'direct-scheduled', 'direct-local'] as const) {
      const routeBlocks = routes[route].blocks.filter((block) => block.layer === 'route')
      const last = routeBlocks.at(-1) as AssistantPromptBlock
      expect(last.id).toBe('route.cli-contract')
      expect(last.text).toBe(PROMPT_ROUTE_CLI_CONTRACT)
      expect(routes[route].stableRouteCapabilityPrompt.endsWith(`\n\n${PROMPT_ROUTE_CLI_CONTRACT}`)).toBe(true)
    }
  })
})

describe('prompt boundary blocks', () => {
  const direct = ['direct-linq', 'direct-linq-onboarding', 'direct-scheduled', 'direct-local'] as const
  const group = ['group-linq', 'group-telegram', 'group-email'] as const
  const groupChat = ['group-linq', 'group-telegram'] as const
  // Every block that states a privacy, safety or authority rule, and the
  // routes that must carry it. Its wording is free; its presence is not.
  const REQUIRED: Partial<Record<AssistantPromptBlockId, readonly string[]>> = {
    'core.unverified-external': ['unverified-external'],
    'core.identity.direct': direct,
    'core.identity.group': group,
    'core.follow-through-authorization': [...direct, ...group],
    'core.health-evidence-safety.direct': direct,
    'core.health-evidence-safety.group': group,
    'core.tool-truthfulness.direct': direct,
    'core.tool-truthfulness.group': group,
    'route.private-delivery-context': [...direct, ...group],
    'route.computer-use': direct,
    'route.connected-apps.group': group,
    'route.family-plan.group': group,
    'route.hosted-groups.private-consult': direct,
    'route.hosted-groups': group,
    'route.group-cli-boundary': groupChat,
    'route.group-email-no-cli': ['group-email'],
    'thread.conversation-scope.direct': direct,
    'thread.conversation-scope.group': group,
    'thread.conversation-scope.unverified': ['unverified-external'],
    'output-only.ask-continuation': ['output-only-continuation'],
    'output-only.system-notification': ['system-notification'],
    'output-only.operator-message': ['operator-message'],
  }
  const routes = renderPromptRoutes()

  it('lists required routes for every block flagged as a boundary', () => {
    const flagged = ALL_IDS.filter((id) =>
      (ASSISTANT_PROMPT_BLOCK_DEFINITIONS[id] as { boundary?: true }).boundary === true)
    expect(Object.keys(REQUIRED).sort()).toEqual([...flagged].sort())
  })

  it('admits each boundary block to every route that must carry it', () => {
    const missing: string[] = []
    for (const [id, required] of Object.entries(REQUIRED)) {
      for (const route of required) {
        const layers = routes[route as keyof typeof routes]
        if (!ids(layers).includes(id as AssistantPromptBlockId)) missing.push(`${id} missing from ${route}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('carries the scope boundaries on every input, whatever capabilities are on', () => {
    for (const input of sweepPromptInputs()) {
      const scope = input.conversationScope ?? 'direct'
      const admitted = ids(render(input))
      if (scope === 'direct') {
        expect(admitted).toEqual(expect.arrayContaining([
          'core.identity.direct', 'core.health-evidence-safety.direct', 'core.tool-truthfulness.direct',
          'route.private-delivery-context', 'route.computer-use', 'thread.conversation-scope.direct',
        ]))
      } else if (scope === 'group') {
        expect(admitted).toEqual(expect.arrayContaining([
          'core.identity.group', 'core.health-evidence-safety.group', 'core.tool-truthfulness.group',
          'route.private-delivery-context', 'route.connected-apps.group', 'route.family-plan.group',
          'thread.conversation-scope.group',
          input.channel === 'email' ? 'route.group-email-no-cli' : 'route.group-cli-boundary',
        ]))
      } else {
        expect(admitted).toEqual(expect.arrayContaining([
          'core.unverified-external', 'thread.conversation-scope.unverified',
        ]))
      }
    }
  })
})

describe('prompt capability gates', () => {
  const directBase: AssistantSystemPromptInput = { ...PROMPT_ROUTE_INPUTS['direct-linq'] }
  const groupBase: AssistantSystemPromptInput = { ...PROMPT_ROUTE_INPUTS['group-linq'] }
  type Gate = {
    name: string
    base: AssistantSystemPromptInput
    on: Partial<AssistantSystemPromptInput>
    off: Partial<AssistantSystemPromptInput>
    onOnly: readonly AssistantPromptBlockId[]
    offOnly?: readonly AssistantPromptBlockId[]
  }
  const GATES: Gate[] = [
    { name: 'polls', base: directBase, on: { assistantPollsAvailable: true }, off: { assistantPollsAvailable: false }, onOnly: ['route.native-polls'] },
    { name: 'group polls', base: groupBase, on: { assistantPollsAvailable: true }, off: { assistantPollsAvailable: false }, onOnly: ['route.native-polls'] },
    { name: 'labs', base: directBase, on: { assistantHostedLabsAvailable: true }, off: { assistantHostedLabsAvailable: false }, onOnly: ['route.labs'] },
    { name: 'android app', base: directBase, on: { assistantAndroidAppAvailable: true }, off: { assistantAndroidAppAvailable: false }, onOnly: ['route.android-health-connect-relay'] },
    { name: 'onboarding', base: directBase, on: { onboardingGuidance: true }, off: { onboardingGuidance: false }, onOnly: ['thread.onboarding'] },
    { name: 'hosted automation', base: directBase, on: { assistantHostedAutomationAvailable: true }, off: { assistantHostedAutomationAvailable: false }, onOnly: ['route.automation'], offOnly: ['route.automation.unavailable'] },
    { name: 'group hosted automation', base: groupBase, on: { assistantHostedAutomationAvailable: true }, off: { assistantHostedAutomationAvailable: false }, onOnly: ['route.automation'], offOnly: ['route.automation.unavailable'] },
    { name: 'hosted runtime', base: directBase, on: { hostedRuntime: true }, off: { hostedRuntime: false }, onOnly: ['route.low-usage', 'route.late-child-results', 'route.non-blocking-delegation', 'turn.ordinary-inbound'] },
    { name: 'ordinary inbound turn', base: directBase, on: { ordinaryInboundTurn: true }, off: { ordinaryInboundTurn: false }, onOnly: ['route.non-blocking-delegation', 'turn.ordinary-inbound'] },
    { name: 'direct style settings', base: directBase, on: { assistantStyleSettingsAvailable: true }, off: { assistantStyleSettingsAvailable: false }, onOnly: ['route.style-settings.direct'] },
    { name: 'group style settings', base: groupBase, on: { assistantStyleSettingsAvailable: true }, off: { assistantStyleSettingsAvailable: false }, onOnly: ['route.style-settings.group'] },
    { name: 'persona', base: directBase, on: { assistantPersona: 'classic' }, off: { assistantPersona: null }, onOnly: ['thread.persona'] },
    { name: 'personality dials', base: directBase, on: { assistantPersonality: { humor: 5 } }, off: { assistantPersonality: null }, onOnly: ['thread.personality-dials'] },
    { name: 'scheduled occurrence', base: directBase, on: { scheduledOccurrenceAt: '2026-11-10T13:00:00.000Z' }, off: { scheduledOccurrenceAt: null }, onOnly: ['turn.scheduled-occurrence', 'turn.execution-context', 'turn.delivery-decision-contract'] },
    { name: 'CLI contract', base: directBase, on: { assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT }, off: { assistantCliContract: null }, onOnly: ['route.cli-contract'] },
    { name: 'injected context', base: directBase, on: { assistantDynamicContextPrompts: ['Gate context.'] }, off: { assistantDynamicContextPrompts: [] }, onOnly: ['turn.injected-context'] },
    { name: 'product base URL', base: directBase, on: { murphProductBaseUrl: 'https://murph.example.test' }, off: { murphProductBaseUrl: null }, onOnly: ['thread.product-base-url'] },
    { name: 'current instant', base: directBase, on: { currentInstant: '2026-11-10T15:00:00.000Z' }, off: {}, onOnly: ['turn.current-time'] },
    { name: 'group tool surface', base: groupBase, on: { assistantHostedGroupToolSurface: 'families' }, off: { assistantHostedGroupToolSurface: 'none' }, onOnly: ['route.hosted-groups'] },
    { name: 'private group consult', base: directBase, on: { assistantHostedGroupToolSurface: 'families' }, off: { assistantHostedGroupToolSurface: 'none' }, onOnly: ['route.hosted-groups.private-consult'] },
  ]

  it.each(GATES.map((gate) => [gate.name, gate] as const))('%s admits only its own blocks', (_name, gate) => {
    const on = ids(render({ ...gate.base, ...gate.on }))
    const off = ids(render({ ...gate.base, ...gate.off }))
    expect(on.filter((id) => !off.includes(id)).sort()).toEqual([...gate.onOnly].sort())
    expect(off.filter((id) => !on.includes(id)).sort()).toEqual([...(gate.offOnly ?? [])].sort())
  })

  it('keeps group email off the CLI, skills and automation changes', () => {
    const email = ids(render({ ...HOSTED_ROUTE_BASE, channel: 'email', conversationScope: 'group' }))
    for (const id of ['route.cli-guidance', 'route.skill-router', 'route.health-commons-tools', 'route.automation', 'route.group-cli-boundary'] as const) {
      expect(email).not.toContain(id)
    }
    expect(email).toEqual(expect.arrayContaining([
      'route.group-email-no-cli', 'route.group-email-health', 'route.automation.group-email', 'route.low-usage.group-email',
    ]))
  })

  it('keeps injected turn context out of the cacheable layers', () => {
    const marker = 'Injected-context marker 7f3a.'
    const layers = render({ ...directBase, assistantDynamicContextPrompts: [marker] })
    expect(layers.dynamicTurnContextPrompt).toContain(marker)
    for (const text of [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt]) {
      expect(text).not.toContain(marker)
    }
    const unverified = render({ ...directBase, conversationScope: 'unverified-external', assistantDynamicContextPrompts: [marker] })
    expect(unverified.prompt).not.toContain(marker)
  })
})
