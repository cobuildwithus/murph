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
  assert.equal(
    access.env.PATH,
    `${userBinDirectory}${path.delimiter}/opt/homebrew/bin`,
  )
})

test('buildAssistantCliGuidanceText keeps only non-duplicative CLI guidance', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
  })

  assert.match(guidance, /canonical Murph CLI/u)
  assert.doesNotMatch(guidance, /setup entrypoint/u)
  assert.doesNotMatch(guidance, /`chat`|`run`|`assistant ask`|`assistant deliver`/u)
  assert.match(guidance, /matching local CLI command directly/u)
  assert.match(guidance, /prefer `--format json`/u)
  assert.match(guidance, /do not start another assistant process/u)
  assert.doesNotMatch(guidance, /vault-cli <command> --help/u)
  assert.doesNotMatch(guidance, /vault-cli <command> --schema --format json/u)
  assert.doesNotMatch(guidance, /vault-cli --llms-full/u)
})

test('buildAssistantCliGuidanceText omits provider-bound tool guidance', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
  })

  assert.doesNotMatch(guidance, /bound assistant tools/u)
  assert.match(guidance, /Use the matching local CLI command directly/u)
})
