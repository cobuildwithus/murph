import assert from 'node:assert/strict'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { runRawCli } from './cli-test-helpers.js'

test('show help uses id selectors except for journal date keys', async () => {
  const providerShowHelp = await runRawCli(['provider', 'show', '--help'])
  const foodShowHelp = await runRawCli(['food', 'show', '--help'])
  const recipeShowHelp = await runRawCli(['recipe', 'show', '--help'])
  const eventShowHelp = await runRawCli(['event', 'show', '--help'])
  const samplesShowHelp = await runRawCli(['samples', 'show', '--help'])
  const auditShowHelp = await runRawCli(['audit', 'show', '--help'])
  const experimentShowHelp = await runRawCli(['experiment', 'show', '--help'])
  const intakeShowHelp = await runRawCli(['intake', 'show', '--help'])
  const journalShowHelp = await runRawCli(['journal', 'show', '--help'])

  assert.match(providerShowHelp, /Usage: vault-cli provider show <id> \[options\]/u)
  assert.match(foodShowHelp, /Usage: vault-cli food show <id> \[options\]/u)
  assert.match(recipeShowHelp, /Usage: vault-cli recipe show <id> \[options\]/u)
  assert.match(eventShowHelp, /Usage: vault-cli event show <id> \[options\]/u)
  assert.match(samplesShowHelp, /Usage: vault-cli samples show <id> \[options\]/u)
  assert.match(auditShowHelp, /Usage: vault-cli audit show <id> \[options\]/u)
  assert.match(experimentShowHelp, /Usage: vault-cli experiment show <id> \[options\]/u)
  assert.match(intakeShowHelp, /Usage: vault-cli intake show <id> \[options\]/u)
  assert.match(journalShowHelp, /Usage: vault-cli journal show <date> \[options\]/u)
})
