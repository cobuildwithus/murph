import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import {
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '@murphai/assistant-engine'

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
  assert.match(guidance, /matching local CLI command directly/u)
  assert.match(guidance, /prefer `--format json`/u)
  assert.match(guidance, /do not run recursive assistant or delivery commands/u)
  assert.match(guidance, /`assistant deliver`/u)
  assert.match(guidance, /inspect the one needed command/u)
  assert.match(guidance, /vault-cli <command> --schema --format json/u)
  assert.match(guidance, /targeted `vault-cli <command> --help`/u)
  assert.match(guidance, /Avoid dumping broad CLI manifests/u)
  assert.doesNotMatch(guidance, /vault-cli --llms-full/u)
})

test('buildAssistantCliGuidanceText omits provider-bound tool guidance', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  })

  assert.doesNotMatch(guidance, /bound assistant tools/u)
  assert.match(guidance, /Use the matching local CLI command directly/u)
})
