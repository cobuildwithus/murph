import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import {
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '@murphai/assistant-core/assistant-cli-access'

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

test('buildAssistantCliGuidanceText keeps CLI guidance brief and Incur-first', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  })

  assert.match(guidance, /canonical Murph CLI/u)
  assert.match(guidance, /setup entrypoint/u)
  assert.match(guidance, /same top-level `chat` and `run` aliases/u)
  assert.match(guidance, /vault-cli <command> --help/u)
  assert.match(guidance, /vault-cli <command> --schema --format json/u)
  assert.match(guidance, /vault-cli --llms/u)
  assert.match(guidance, /vault-cli --llms-full/u)
  assert.match(guidance, /Do not guess command syntax from this prompt or from memory/u)
  assert.match(guidance, /Do not edit canonical vault files directly/u)
  assert.match(guidance, /matching `vault-cli` write surface/u)
})

test('buildAssistantCliGuidanceText falls back to exact command suggestions when the provider path is prompt-only', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  })

  assert.match(
    guidance,
    /prefer the bound assistant tools first and otherwise map the request onto the canonical CLI surface instead of improvising from raw files/u,
  )
  assert.match(
    guidance,
    /instead of pretending it already ran/u,
  )
})
