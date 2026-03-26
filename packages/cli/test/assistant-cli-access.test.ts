import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import {
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '../src/assistant-cli-access.js'

test('resolveAssistantCliAccessContext prepends the Healthy Bob shim directory to PATH once', () => {
  const homeRoot = path.join('/tmp', 'healthybob-assistant-cli-access-home')
  const userBinDirectory = path.join(homeRoot, '.local', 'bin')
  const access = resolveAssistantCliAccessContext({
    HOME: homeRoot,
    PATH: `${userBinDirectory}${path.delimiter}/opt/homebrew/bin`,
  })

  assert.equal(access.rawCommand, 'vault-cli')
  assert.equal(access.setupCommand, 'healthybob')
  assert.equal(
    access.env.PATH,
    `${userBinDirectory}${path.delimiter}/opt/homebrew/bin`,
  )
})

test('buildAssistantCliGuidanceText tells the assistant to escalate from help to schema to llms discovery', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'healthybob',
  }, {
    supportsDirectCliExecution: true,
  })

  assert.match(guidance, /Direct Healthy Bob CLI execution is available in this session/u)
  assert.match(guidance, /vault-cli <command> --help/u)
  assert.match(guidance, /vault-cli <command> --schema --format json/u)
  assert.match(guidance, /vault-cli --llms/u)
  assert.match(guidance, /vault-cli --llms-full/u)
  assert.match(guidance, /broad CLI discovery/u)
  assert.match(guidance, /healthybob chat/u)
  assert.match(guidance, /healthybob run/u)
  assert.match(guidance, /meal photo, audio note, or a text-only description/u)
  assert.match(guidance, /vault-cli meal add/u)
  assert.match(guidance, /Log the meal without asking whether they want it logged first/u)
  assert.match(guidance, /no longer requires a photo/u)
  assert.match(guidance, /meals, snacks, and drinks/u)
  assert.match(guidance, /same detailed meal more than once/u)
  assert.match(guidance, /acai bowl with basically the same components/u)
  assert.match(guidance, /where it is from or what the specific version is/u)
  assert.match(guidance, /add it as a food for future reuse/u)
  assert.match(guidance, /two separate logs like "I ate steak" are not enough/u)
  assert.match(guidance, /Do not silently create the food record unless the user clearly asks/u)
  assert.match(guidance, /Older food logs may still live/u)
  assert.match(
    guidance,
    /describe what you found in user-facing terms such as meal log, journal entry, or note/u,
  )
  assert.match(guidance, /research on a complex topic/u)
  assert.match(guidance, /vault-cli research <prompt>/u)
  assert.match(guidance, /review:gpt --deep-research --send --wait/u)
  assert.match(guidance, /10 to 60 minutes/u)
  assert.match(guidance, /long-running operation/u)
  assert.match(guidance, /defaults the overall timeout to 40m/u)
  assert.match(guidance, /`--timeout` is the normal knob/u)
  assert.match(guidance, /`--wait-timeout` is the advanced override/u)
  assert.match(guidance, /vault-cli deepthink <prompt>/u)
  assert.match(guidance, /healthybob/u)
})

test('buildAssistantCliGuidanceText falls back to exact command suggestions when the provider path is prompt-only', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'healthybob',
  }, {
    supportsDirectCliExecution: false,
  })

  assert.match(
    guidance,
    /does not expose direct CLI execution/u,
  )
  assert.match(
    guidance,
    /give them the exact `vault-cli \.\.\.` command to run or switch to a Codex-backed Healthy Bob chat session/u,
  )
  assert.match(
    guidance,
    /instead of pretending you already ran it/u,
  )
})
