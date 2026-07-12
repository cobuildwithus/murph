import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli, SyncSkills } from 'incur'
import { test } from 'vitest'
import fullVaultCli from '../src/index.js'
import { VAULT_CLI_SKILL_HASH } from '../src/vault-cli-skill-hash.generated.js'
import { createVaultCliShell } from '../src/vault-cli-shell.js'

test('generated skill hash matches the fully registered Vault CLI tree', () => {
  assert.match(VAULT_CLI_SKILL_HASH, /^[a-f0-9]{16}$/u)
  assert.equal(Cli.skillHash(fullVaultCli), VAULT_CLI_SKILL_HASH)
})

test('canonical skill hash avoids partial-tree false positives and preserves structural staleness warnings', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-incur-skill-hash-'))
  const previousXdgDataHome = process.env.XDG_DATA_HOME
  const commandName = 'murph-incur-skill-hash-test'
  const dataHome = path.join(tempRoot, 'data')

  try {
    process.env.XDG_DATA_HOME = dataHome
    const fullCli = createVaultCliShell(commandName)
    fullCli.command('ping', {
      aliases: ['p'],
      run() {
        return 'pong'
      },
    })
    const fullSkillHash = Cli.skillHash(fullCli)
    const fullCommands = Cli.toCommands.get(fullCli)
    assert.ok(fullCommands)
    const rootCommand = Cli.toRootDefinition.get(fullCli)
    await SyncSkills.sync(commandName, fullCommands, {
      cwd: tempRoot,
      global: false,
      ...(rootCommand === undefined ? {} : { rootCommand }),
    })
    assert.equal(SyncSkills.readHash(commandName), fullSkillHash)

    const currentCli = createProbeCli(commandName, fullSkillHash)
    assert.notEqual(Cli.skillHash(currentCli), fullSkillHash)
    const currentOutput = await serveProbe(currentCli)
    assert.doesNotMatch(currentOutput, /Skills are out of date:/u)

    const staleSkillHash = `${fullSkillHash.slice(0, -1)}${
      fullSkillHash.endsWith('0') ? '1' : '0'
    }`
    const staleCli = createProbeCli(commandName, staleSkillHash)
    const staleOutput = await serveProbe(staleCli)
    assert.match(staleOutput, /Skills are out of date:/u)
  } finally {
    if (previousXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = previousXdgDataHome
    }
    await rm(tempRoot, { force: true, recursive: true })
  }
})

function createProbeCli(commandName: string, expectedSkillHash: string): Cli.Cli {
  const cli = createVaultCliShell(commandName, { expectedSkillHash })
  cli.command('ping', {
    run() {
      return 'pong'
    },
  })
  return cli
}

async function serveProbe(cli: Cli.Cli): Promise<string> {
  const stdout: string[] = []
  let exitCode: number | undefined

  await cli.serve(['ping'], {
    exit(code) {
      exitCode = code
    },
    stdout(output) {
      stdout.push(output)
    },
  })

  assert.equal(exitCode, undefined)
  return stdout.join('')
}
