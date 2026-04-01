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

test('buildAssistantCliGuidanceText tells the assistant to escalate from help to schema to llms discovery', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  }, {
    supportsDirectCliExecution: true,
  })

  assert.match(guidance, /Direct Murph CLI execution is available in this session/u)
  assert.match(guidance, /vault-cli <command> --help/u)
  assert.match(guidance, /vault-cli <command> --schema --format json/u)
  assert.match(guidance, /vault-cli --llms/u)
  assert.match(guidance, /vault-cli --llms-full/u)
  assert.match(guidance, /broad CLI discovery/u)
  assert.match(guidance, /Do not edit canonical vault files such as `vault\.json`, `CORE\.md`, `ledger\/\*\*`, `bank\/\*\*`, or `raw\/\*\*` directly/u)
  assert.match(guidance, /use the matching `vault-cli` write surface/u)
  assert.match(guidance, /assistant self-target list/u)
  assert.match(guidance, /assistant self-target show <channel>/u)
  assert.match(guidance, /phone number, Telegram chat\/thread, email address, or AgentMail identity/u)
  assert.match(guidance, /ask the user explicitly for the missing details instead of guessing/u)
  assert.match(guidance, /assistant self-target set <channel>/u)
  assert.match(guidance, /murph chat/u)
  assert.match(guidance, /murph run/u)
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
  assert.match(guidance, /meal or drink as recurring or already known/u)
  assert.match(guidance, /"my morning drink", "usual", "same as always", or "autologged"/u)
  assert.match(guidance, /inspect remembered foods and their recurring schedule before creating a fresh meal or reusable food/u)
  assert.match(guidance, /vault-cli food list/u)
  assert.match(guidance, /vault-cli food show <id>/u)
  assert.match(guidance, /already auto-logs daily/u)
  assert.match(guidance, /prefer updating the existing remembered food instead of inventing a separate one-off/u)
  assert.match(guidance, /If two saved items plausibly match/u)
  assert.match(guidance, /ask a short disambiguating question instead of guessing/u)
  assert.match(guidance, /If the user says they are at a specific restaurant/u)
  assert.match(guidance, /look up the menu on the web before logging the meal when feasible/u)
  assert.match(guidance, /not just before creating a reusable food/u)
  assert.match(guidance, /Prefer the restaurant menu or official restaurant page/u)
  assert.match(guidance, /actual dish name, ingredients, sides, sauces, and modifiers/u)
  assert.match(guidance, /If the menu is not available in the current session/u)
  assert.match(guidance, /already gave a reasonably complete description/u)
  assert.match(guidance, /without interrogating them for every side or modifier/u)
  assert.match(guidance, /log as much useful structure as you can in one pass/u)
  assert.match(guidance, /protein source, shared versus full portions, piece counts/u)
  assert.match(guidance, /Ask a short follow-up only when the first description is too sparse/u)
  assert.match(guidance, /bare dish name without enough context/u)
  assert.match(guidance, /approximate grams, ounces, or per-item breakdowns/u)
  assert.match(guidance, /estimates explicit and conservative/u)
  assert.match(guidance, /specific branded or packaged item as a reusable food/u)
  assert.match(guidance, /look up the ingredients on the web before creating the food record/u)
  assert.match(guidance, /Prefer the official product page when possible/u)
  assert.match(guidance, /reputable retailer or product listing/u)
  assert.match(guidance, /If you cannot verify the ingredients online/u)
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
  assert.match(guidance, /murph/u)
})

test('buildAssistantCliGuidanceText falls back to exact command suggestions when the provider path is prompt-only', () => {
  const guidance = buildAssistantCliGuidanceText({
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  }, {
    supportsDirectCliExecution: false,
  })

  assert.match(
    guidance,
    /does not expose direct CLI execution/u,
  )
  assert.match(
    guidance,
    /give them the exact `vault-cli \.\.\.` command to run or switch to a Codex-backed Murph chat session/u,
  )
  assert.match(
    guidance,
    /instead of pretending you already ran it/u,
  )
})
