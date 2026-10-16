import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

import { buildHostedCodexBehaviorTomlLines } from '@murphai/hosted-execution/codex-behavior'
import { canonicalAdapterArgs, inspectCanonicalCodex } from './support/canonical-codex-inspection.js'
import { canonicalCodexLauncher } from './support/canonical-codex-launcher.js'

const execFileAsync = promisify(execFile)

it.each(['direct', 'adapter'] as const)('executes the launcher with shared hosted behavior and literal config arguments (%s)', async (shape) => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-codex-launcher-'))
  try {
    const capture = path.join(root, 'capture')
    const launcher = path.join(root, 'launcher')
    await writeFile(capture, `#!${process.execPath}\nprocess.stdout.write(process.argv.includes('--help') ? '--ignore-user-config' : JSON.stringify(process.argv.slice(2)))\n`, { mode: 0o700 })
    const syntheticRoot = "/fixture/install with 'quote'/$literal"
    await writeFile(launcher, canonicalCodexLauncher({ PATH: '/fixture/bin', HOME: '/fixture/home' }, [syntheticRoot]), { mode: 0o700 })
    const inputArgs = shape === 'adapter' ? canonicalAdapterArgs() : ['app-server']
    const { stdout } = await execFileAsync(launcher, inputArgs, {
      env: { MURPH_CANONICAL_JOURNEY_CODEX: capture }, timeout: 10_000,
    })
    const args: string[] = JSON.parse(stdout)
    expect(args.slice(-2)).toEqual(['app-server', '--ignore-user-config'])
    expect(args.slice(-(inputArgs.length + 1))).toEqual([...inputArgs, '--ignore-user-config'])
    const overrides = args.slice(0, -(inputArgs.length + 1)).filter((_, index) => index % 2 === 1)
    const features = overrides.find((value) => value.startsWith('features='))!
    expect(features).toContain('plugins = false')
    expect(features).toContain('memories = false')
    expect(features).toContain('"multi_agent_v2".enabled = true')
    expect(features).toContain('"multi_agent_v2".expose_spawn_agent_model_overrides = false')
    // Composed values are taken from the actual production owner, including its
    // delegation instructions, rather than the former benchmark approximation.
    for (const line of buildHostedCodexBehaviorTomlLines({ exposeSpawnAgentModelOverrides: false })) {
      if (line.startsWith('usage_hint_text = ') || line.startsWith('subagent_developer_instructions = ')) {
        expect(features).toContain(line)
      }
    }
    expect(overrides).toContain('skills={include_instructions = false,"bundled".enabled = false}')
    expect(overrides).toContain('memories={use_memories = false,generate_memories = false}')
    expect(overrides).toContain('default_permissions="murph-member-workspace"')
    expect(overrides).toContain('notify=[]')
    expect(overrides).toContain('features.apply_patch_freeform=false')
    expect(overrides).toContain('allow_login_shell=false')
    expect(overrides.some((value) => value.startsWith('model_provider='))).toBe(false)
    const permissions = overrides.find((value) => value.startsWith('permissions='))!
    expect(permissions).toContain(`${JSON.stringify(syntheticRoot)} = "read"`)
    expect(permissions).toContain(`${JSON.stringify(`${syntheticRoot}/**/.env`)} = "deny"`)
    expect(permissions).toContain('"murph-member-workspace"."filesystem".":workspace_roots"."bank/automations" = "read"')
    expect(permissions).toContain('"murph-group-read"."network".enabled = false')
    expect(permissions).not.toContain(`${JSON.stringify(syntheticRoot)} = "write"`)
    expect(overrides.find((value) => value.startsWith('shell_environment_policy='))).toBe(
      'shell_environment_policy={inherit="all",ignore_default_excludes=false,exclude=[],include_only=["HOME","MURPH_ASSISTANT_SKILLS_ROOT","MURPH_HEALTH_COMMONS_PACKAGE_ROOT","PATH"],set={PATH="/fixture/bin"}}',
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('loads the composed overrides with real Codex and masks conflicting synthetic feature preferences', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-codex-config-'))
  try {
    await writeFile(path.join(root, 'config.toml'), [
      'notify = ["synthetic-hook-must-not-run"]',
      'web_search = "live"',
      '[features]', 'plugins = true', 'memories = true', 'apply_patch_freeform = true',
    ].join('\n'))
    const launcher = path.join(root, 'launcher')
    const env = { HOME: root, CODEX_HOME: root, PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) }
    await writeFile(launcher, canonicalCodexLauncher(env, []), { mode: 0o700 })
    const codex = path.resolve(import.meta.dirname, '../node_modules/.bin/codex')
    const { stdout } = await execFileAsync(launcher, ['features', 'list'], {
      env: { ...env, MURPH_CANONICAL_JOURNEY_CODEX: codex }, timeout: 15_000,
    })
    for (const feature of ['plugins', 'memories', 'apply_patch_freeform']) {
      expect(stdout).toMatch(new RegExp(`^${feature}\\s+[^\\n]*false$`, 'm'))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'darwin')('executes local install reads while denying install writes and credential files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-codex-sandbox-'))
  try {
    const install = path.join(root, 'install')
    const vault = path.join(root, 'vault')
    await mkdir(install)
    await mkdir(vault)
    await writeFile(path.join(install, 'SKILL.md'), 'synthetic installed skill')
    await writeFile(path.join(install, '.env'), 'SYNTHETIC_ONLY=unavailable')
    const launcher = path.join(root, 'launcher')
    const env = { HOME: root, CODEX_HOME: root, PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) }
    await writeFile(launcher, canonicalCodexLauncher(env, [install, path.dirname(path.dirname(process.execPath)), '/System/Library/OpenSSL']), { mode: 0o700 })
    const script = [
      'const fs = require("node:fs"), assert = require("node:assert/strict"), path = require("node:path");',
      'const install = process.argv[1];',
      'assert.equal(fs.readFileSync(path.join(install, "SKILL.md"), "utf8"), "synthetic installed skill");',
      'assert.throws(() => fs.writeFileSync(path.join(install, "SKILL.md"), "forbidden"));',
      'assert.throws(() => fs.readFileSync(path.join(install, ".env")));',
      'fs.writeFileSync("canonical-write.txt", "allowed");',
      'process.stdout.write("sandbox-boundaries-pass");',
    ].join('\n')
    const { stdout } = await execFileAsync(launcher, ['sandbox', '-P', 'murph-member-workspace', '-C', vault, '--', process.execPath, '-e', script, install], {
      env: { ...env, MURPH_CANONICAL_JOURNEY_CODEX: path.resolve(import.meta.dirname, '../node_modules/.bin/codex') }, timeout: 15_000,
    })
    expect(stdout).toBe('sandbox-boundaries-pass')
  } finally { await rm(root, { recursive: true, force: true }) }
})


it.each(['direct', 'adapter'] as const)('rejects an unpatched app-server before starting a journey (%s)', async (shape) => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-codex-capability-'))
  try {
    const launcher = path.join(root, 'launcher')
    const codex = path.join(root, 'codex')
    await writeFile(codex, '#!/bin/sh\nif [ "$2" = "--help" ]; then exit 0; fi\nprintf "unexpected-start"\n', { mode: 0o700 })
    await writeFile(launcher, canonicalCodexLauncher({}, []), { mode: 0o700 })
    await expect(execFileAsync(launcher, shape === 'adapter' ? canonicalAdapterArgs() : ['app-server'], {
      env: { MURPH_CANONICAL_JOURNEY_CODEX: codex }, timeout: 10_000,
    })).rejects.toMatchObject({
      code: 64,
      stdout: '',
      stderr: 'Canonical journeys require the Murph native patch; select its binary with --codex-command.\n',
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(!process.env.MURPH_TEST_CODEX_COMMAND)('isolates synthetic personal inputs through the adapter launch shape with the selected native artifact', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-codex-isolation-'))
  const workspace = path.join(root, 'workspace')
  const global = path.join(root, 'AGENTS.override.md')
  const project = path.join(workspace, 'AGENTS.md')
  const auth = '{"OPENAI_API_KEY":"synthetic-test-key"}'
  try {
    await mkdir(workspace)
    await writeFile(global, 'SYNTHETIC_GLOBAL_INSTRUCTIONS')
    await writeFile(project, 'SYNTHETIC_PROJECT_INSTRUCTIONS')
    await writeFile(path.join(root, 'auth.json'), auth)
    await writeFile(path.join(root, 'config.toml'), [
      'default_permissions = "murph-member-workspace"',
      'developer_instructions = "SYNTHETIC_PERSONAL_DEVELOPER"',
      '[permissions.murph-member-workspace.filesystem]',
      '"/synthetic-extra-read" = "read"',
    ].join('\n'))
    const launcher = path.join(root, 'launcher')
    const env = { HOME: root, CODEX_HOME: root, PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) }
    await writeFile(launcher, canonicalCodexLauncher(env, []), { mode: 0o700 })
    const inspected = await inspectCanonicalCodex({
      command: launcher, cwd: workspace,
      env: { ...env, MURPH_CANONICAL_JOURNEY_CODEX: process.env.MURPH_TEST_CODEX_COMMAND },
      threadParams: { modelProvider: 'synthetic', config: {
        'model_providers.synthetic': { name: 'Synthetic', base_url: 'http://127.0.0.1:1/v1', wire_api: 'responses' },
      } },
    })
    expect(JSON.stringify(inspected.config)).not.toContain('SYNTHETIC_PERSONAL_DEVELOPER')
    expect(JSON.stringify(inspected.config)).not.toContain('/synthetic-extra-read')
    expect(inspected.account).toMatchObject({ account: { type: 'apiKey' } })
    expect(await readFile(path.join(root, 'auth.json'), 'utf8')).toBe(auth)
    const canonicalSources = await Promise.all(inspected.instructionSources.map((source) => realpath(source)))
    expect(canonicalSources).toContain(await realpath(project))
    expect(canonicalSources).not.toContain(await realpath(global))
  } finally { await rm(root, { recursive: true, force: true }) }
})
