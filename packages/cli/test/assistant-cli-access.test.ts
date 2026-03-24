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
  })

  assert.match(guidance, /raw Healthy Bob CLI/u)
  assert.match(guidance, /vault-cli <command> --help/u)
  assert.match(guidance, /vault-cli <command> --schema --format json/u)
  assert.match(guidance, /vault-cli --llms/u)
  assert.match(guidance, /vault-cli --llms-full/u)
  assert.match(guidance, /broad CLI discovery/u)
  assert.match(guidance, /meal photo, audio note, or a text-only description/u)
  assert.match(guidance, /vault-cli meal add/u)
  assert.match(guidance, /no longer requires a photo/u)
  assert.match(guidance, /meals, snacks, and drinks/u)
  assert.match(guidance, /Older food logs may still live/u)
  assert.match(guidance, /healthybob/u)
})
