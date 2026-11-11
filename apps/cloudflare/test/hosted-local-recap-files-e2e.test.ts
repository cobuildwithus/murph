import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { initializeVault } from '@murphai/core';
import { createHostedAssistantTurnEnvironment } from '@murphai/assistant-runtime/hosted-invocation-testkit';
import { sendAssistantNotificationLocal } from '@murphai/assistant-engine/assistant-service';
import { stopWarmCodexAppServer } from '@murphai/assistant-engine/assistant-codex';
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend';
import { buildMurphHostedPermissionProfileTomlLines } from '@murphai/hosted-execution/assistant-permissions';
import { listAssistantOutboxIntents } from '@murphai/assistant-engine/assistant-outbox';
import { createHostedRecapFixture } from './helpers/recap-show-fixture.js';
import { buildAssistantProviderMurphToolCall, buildAssistantProviderShellCommandCall, startAssistantProviderStubServer, readHostedLocalAssistantProviderToolOutputs, type HostedLocalAssistantProviderScriptedResponse } from './helpers/hosted-local-e2e-support.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const exec = promisify(execFile);
const containerFlag = 'MURPH_RECAP_CONTAINER_PROOF';

it.each([false, true])('accepts a recap show through the production hosted Linux sandbox (mediaFails=%s)', async mediaFails => {
  if (process.env[containerFlag] !== '1') {
    const image = `murph-recap-files-proof:${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
    try {
      await exec('docker', ['build', '--platform', 'linux/amd64', '-f', path.join(root, 'Dockerfile.cloudflare-hosted-runner'), '-t', image, path.join(root, 'apps/cloudflare')], { maxBuffer: 16 * 1024 * 1024 });
      const running = exec('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined',
        '--mount', `type=bind,source=${root},target=/workspace`, '--workdir', '/workspace', '-e', `${containerFlag}=1`, '--entrypoint', 'node', image,
        '/workspace/node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--config', 'apps/cloudflare/vitest.e2e.config.ts', 'apps/cloudflare/test/hosted-local-recap-files-e2e.test.ts', '-t', `mediaFails=${mediaFails}`], { maxBuffer: 16 * 1024 * 1024 });
      running.child.stdout?.pipe(process.stdout);
      running.child.stderr?.pipe(process.stderr);
      await running;
    } catch (error) {
      if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
        process.stdout.write(String(error.stdout)); process.stderr.write(String(error.stderr));
      }
      throw error;
    } finally { await exec('docker', ['image', 'rm', image]).catch(() => {}); }
    return;
  }
  expect(process.platform).toBe('linux');
  expect(process.arch).toBe('x64');
  const vault = await mkdtemp(path.join(tmpdir(), 'recap-linux-vault-'));
  const home = await mkdtemp(path.join(tmpdir(), 'recap-linux-codex-'));
  const eventId = 'game-recap:synthetic-linux';
  const gameId = 'synthetic-linux';
  const relativeRoot = `tmp/recap/${createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`;
  const command = `printf NORMAL_GROUP_WORKSPACE_OK; pwd`;
  const fixture = await createHostedRecapFixture(gameId, mediaFails);
  const draftPath = `${relativeRoot}/drafts/show.json`;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const draftCommand = () => {
    const story = structuredClone(fixture.story);
    if (mediaFails) delete story.song;
    const draft = { story, files: fixture.files.map(file => ({ ...file, path: `${relativeRoot}/${file.path}` })) };
    return buildAssistantProviderShellCommandCall(`printf '%s' ${quote(JSON.stringify(draft))} > ${draftPath}`);
  };
  const confinement = [
    ...['drafts', 'media'].map(area => `printf allowed > ${relativeRoot}/${area}/permission-probe.txt || exit 24`),
    'test -z "${ELEVENLABS_API_KEY+x}" || exit 26',
    'test -z "${OPENAI_API_KEY+x}" || exit 27',
    'printf NORMAL_GROUP_SECRETS_ABSENT',
  ].join('\n');
  const responses: HostedLocalAssistantProviderScriptedResponse[] = [
    buildAssistantProviderMurphToolCall('read_game', {}),
    buildAssistantProviderShellCommandCall(command),
    buildAssistantProviderShellCommandCall(confinement),
    buildAssistantProviderMurphToolCall('generate_image', { output: 'file', outputFormat: 'jpeg',
      prompt: fixture.story.pages[0]!.blocks[1]!.scene!.prompt, referenceImageRefs: fixture.material.references.filter(ref => ref.kind === 'profile').map(ref => ref.id) }),
    buildAssistantProviderMurphToolCall('generate_song', { output: 'file', durationSeconds: 20, prompt: 'Warm acoustic pop about a synthetic laundry space mission.' }),
    { deriveResponse: () => draftCommand() },
    buildAssistantProviderMurphToolCall('write_recap', { draftPath }),
    'Synthetic recap submitted.',
  ];
  const observed = new Set<string>();
  const server = await startAssistantProviderStubServer({ responseState: { queuedResponses: responses }, maxResponsesApiRequestBodies: 20,
    onRequest: request => {
      for (const output of readHostedLocalAssistantProviderToolOutputs(request)) {
        if (observed.has(output)) continue;
        observed.add(output);
        process.stdout.write(`Synthetic tool output: ${output}\n`);
      }
    } });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback provider.');
  const originalCwd = process.cwd();
  try {
    process.chdir(vault);
    await initializeVault({ vaultRoot: vault, timezone: 'UTC' });
    await mkdir(path.join(vault, 'games'), { recursive: true });
    await writeFile(path.join(vault, 'games/lore-0123456789abcdef0123456789abcdef.md'), '# Synthetic game lore\n');
    await writeFile(path.join(home, 'config.toml'), [
      'model = "gpt-6.1-sol"', 'model_provider = "hosted-openai"', 'approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'allow_login_shell = false',
      `model_catalog_json = "/usr/local/share/murph/codex-model-catalog.openai-flex.json"`,
      '[model_providers.hosted-openai]', 'name = "Synthetic loopback"', `base_url = "http://127.0.0.1:${address.port}/v1"`, 'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"', 'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
      ...buildMurphHostedPermissionProfileTomlLines(),
    ].join('\n'));
    const target = createAssistantModelTarget({ approvalPolicy: 'never', codexCommand: '/usr/local/bin/codex', codexHome: home, model: 'gpt-6.1-sol', modelProvider: 'hosted-openai', provider: 'codex-cli', reasoningEffort: 'low', sandbox: 'workspace-write' });
    if (!target) throw new Error('Expected synthetic target.');
    const scope = { gameId, eventId, pairFingerprint: '0123456789abcdef0123456789abcdef', show: true as const };

    // Use the same environment builder as ordinary hosted notifications.
    const result = await sendAssistantNotificationLocal({ channel: 'linq', deliveryTarget: 'synthetic-room', deliveryIdempotencyKey: eventId,
      deliveryDispatchMode: 'queue-only', threadId: 'synthetic-room', threadIsDirect: false,
      executionContext: { hosted: { defaultTarget: target, gameRecapScope: scope, providerFetch: fixture.providerFetch, groupTool: { request: fixture.control }, memberId: 'synthetic-room', userEnvKeys: [] } },
      instructions: 'Read the synthetic recap inputs, generate file media, then submit the show.', responsePolicy: { kind: 'require_game_recap', ...scope },
      turnEnvironment: createHostedAssistantTurnEnvironment({ operatorHomeRoot: home, vaultRoot: vault,
        runtimeEnv: { PATH: process.env.PATH ?? '', OPENAI_API_KEY: 'synthetic-only', ELEVENLABS_API_KEY: 'synthetic-only' } }),
      vault, workingDirectory: vault,
    });
    expect([...observed].some(output => output.includes(gameId) && output.includes('The laundry basket supervises.'))).toBe(true);
    expect([...observed].some(output => output.includes('NORMAL_GROUP_WORKSPACE_OK') && output.includes('Process exited with code 0'))).toBe(true);
    expect([...observed].some(output => output.includes('NORMAL_GROUP_SECRETS_ABSENT') && output.includes('Process exited with code 0'))).toBe(true);
    expect(fixture.files).toHaveLength(mediaFails ? 0 : 2);
    if (mediaFails) expect(fixture.saved[0]?.song).toBeUndefined();
    expect(fixture.providerCalls.map(call => call.kind)).toEqual(['image', 'song']);
    expect(fixture.saved).toHaveLength(1);
    const intents = await listAssistantOutboxIntents(vault);
    expect(result.decision.kind).toBe('send_message');
    expect(intents).toHaveLength(1);
    expect(intents[0]!.message).toBe(`${fixture.story.chatLine}\nWatch the recap: https://recaps.murph.test/recap/synthetic-game`);
    expect(intents[0]!.media ?? []).toEqual([]);
    process.stdout.write(`Synthetic Linux recap accepted: inputs read; normal group profile; secrets absent; ${mediaFails ? 'text/photo show' : 'image + song files'}; 1 chat line/link; 0 chat media.\n`);
  } catch (error) {
    process.stdout.write(`Synthetic Linux command: ${command}\nSynthetic Linux tool outputs: ${JSON.stringify([...observed])}\n`);
    throw error;
  } finally {
    await stopWarmCodexAppServer();
    process.chdir(originalCwd);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(vault, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
  }
}, 600_000);
