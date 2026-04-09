import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import {
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '@murphai/assistant-engine/assistant-cli-access'

test('resolveAssistantCliAccessContext prepends the Murph shim directory to PATH once', () => {
  const homeRoot = path.join('/tmp', 'murph-assistant-cli-access-home')
  const userBinDirectory = path.join(homeRoot, '.local', 'bin')
  const access = resolveAssistantCliAccessContext({
    HOME: homeRoot,
    PATH: `${userBinDirectory}${path.delimiter}/opt/homebrew/bin`,
  })

  assert.equal(access.rawCommand, 'vault-cli')
  assert.equal(access.setupCommand, 'murph')
  assert.equal(
    access.env.PATH,
    `${userBinDirectory}${path.delimiter}/opt/homebrew/bin`,
  )
})

test('buildAssistantCliGuidanceText keeps only non-duplicative CLI guidance', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  })

  assert.match(guidance, /canonical Murph CLI/u)
  assert.match(guidance, /setup entrypoint/u)
  assert.match(guidance, /same top-level `chat` and `run` aliases/u)
  assert.match(guidance, /Do not edit canonical vault files directly/u)
  assert.match(guidance, /matching canonical CLI command/u)
  assert.doesNotMatch(guidance, /vault-cli <command> --help/u)
  assert.doesNotMatch(guidance, /vault-cli <command> --schema --format json/u)
  assert.doesNotMatch(guidance, /vault-cli --llms-full/u)
})

test('buildAssistantCliGuidanceText falls back to exact command suggestions when the provider path is prompt-only', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  })

  assert.match(
    guidance,
    /Prefer the bound assistant tools when they are available/u,
  )
  assert.match(
    guidance,
    /Otherwise use the matching canonical CLI command/u,
  )
})
