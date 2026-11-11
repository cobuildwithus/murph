import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { initializeVault } from '@murphai/core';
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

it('accepts a recap show through the production hosted Linux sandbox', async () => {
  if (process.env[containerFlag] !== '1') {
    const image = `murph-recap-files-proof:${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
    try {
      await exec('docker', ['build', '--platform', 'linux/amd64', '-f', path.join(root, 'Dockerfile.cloudflare-hosted-runner'), '-t', image, path.join(root, 'apps/cloudflare')], { maxBuffer: 16 * 1024 * 1024 });
      const running = exec('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined',
        '--user', `${process.getuid!()}:${process.getgid!()}`, '--mount', `type=bind,source=${root},target=/workspace`, '--workdir', '/workspace', '-e', `${containerFlag}=1`, '--entrypoint', 'node', image,
        '/workspace/node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--config', 'apps/cloudflare/vitest.e2e.config.ts', 'apps/cloudflare/test/hosted-local-recap-files-e2e.test.ts'], { maxBuffer: 16 * 1024 * 1024 });
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
  const relativeRoot = `.runtime/tmp/recap/${createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`;
  const command = `cat ${relativeRoot}/inputs/writing-guide.md ${relativeRoot}/inputs/game.json ${relativeRoot}/inputs/chat.jsonl`;
  const fixture = await createHostedRecapFixture(gameId);
  const draftPath = `${relativeRoot}/drafts/show.json`;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const draftCommand = (revised: boolean) => {
    const story = structuredClone(fixture.story);
    if (revised) story.pages[3]!.blocks[0]!.text = 'Mission control found the missing sock';
    const draft = { story, files: fixture.receipts.map(receipt => ({ slot: receipt.mediaType === 'image/jpeg' ? 'scene-0' : 'song', receipt })) };
    return buildAssistantProviderShellCommandCall(`printf '%s' ${quote(JSON.stringify(draft))} > ${draftPath}`);
  };
  const confinement = [
    `if cat private.json; then exit 21; fi`,
    `if cat .runtime/tmp/recap/sibling/inputs/private.json; then exit 22; fi`,
    `if printf forbidden >> ${relativeRoot}/inputs/game.json; then exit 23; fi`,
    ...['drafts', 'media', 'previews'].map(area => `printf allowed > ${relativeRoot}/${area}/permission-probe.txt || exit 24`),
    'test -z "${ELEVENLABS_API_KEY+x}" || exit 26',
    'printf RECAP_CONFINEMENT_OK',
  ].join('\n');
  const responses: HostedLocalAssistantProviderScriptedResponse[] = [
    buildAssistantProviderMurphToolCall('read_game', {}),
    buildAssistantProviderShellCommandCall(command),
    buildAssistantProviderShellCommandCall(confinement),
    buildAssistantProviderMurphToolCall('generate_image', { output: 'file', operationId: 'cover', outputFormat: 'jpeg',
      prompt: fixture.story.pages[0]!.blocks[1]!.scene!.prompt, referenceImageRefs: fixture.material.references.filter(ref => ref.kind === 'profile').map(ref => ref.id) }),
    buildAssistantProviderMurphToolCall('generate_song', { output: 'file', operationId: 'song', durationSeconds: 20, prompt: 'Warm acoustic pop about a synthetic laundry space mission.' }),
    { deriveResponse: () => draftCommand(false) },
    buildAssistantProviderMurphToolCall('preview_recap', { draftPath }),
    { deriveResponse: () => draftCommand(true) },
    buildAssistantProviderMurphToolCall('preview_recap', { draftPath }),
    buildAssistantProviderShellCommandCall(`for file in ${relativeRoot}/previews/*/page-01.png; do head -c 8 "$file" >/dev/null || exit 25; done; printf RECAP_PREVIEW_READ_OK`),
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
    await writeFile(path.join(vault, 'private.json'), 'unrelated synthetic data');
    await mkdir(path.join(vault, '.runtime/tmp/recap/sibling/inputs'), { recursive: true });
    await writeFile(path.join(vault, '.runtime/tmp/recap/sibling/inputs/private.json'), 'other synthetic generation');
    await writeFile(path.join(home, 'config.toml'), [
      'model = "gpt-6.1-sol"', 'model_provider = "hosted-openai"', 'approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'allow_login_shell = false',
      `model_catalog_json = "/usr/local/share/murph/codex-model-catalog.openai-flex.json"`,
      '[model_providers.hosted-openai]', 'name = "Synthetic loopback"', `base_url = "http://127.0.0.1:${address.port}/v1"`, 'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"', 'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
      ...buildMurphHostedPermissionProfileTomlLines(),
    ].join('\n'));
    const target = createAssistantModelTarget({ approvalPolicy: 'never', codexCommand: '/usr/local/bin/codex', codexHome: home, model: 'gpt-6.1-sol', modelProvider: 'hosted-openai', provider: 'codex-cli', reasoningEffort: 'low', sandbox: 'workspace-write' });
    if (!target) throw new Error('Expected synthetic target.');
    const scope = { gameId, eventId, pairFingerprint: '0123456789abcdef0123456789abcdef', show: true as const };

    // The real hosted runtime restores the vault at process cwd. The planner
    // must see that environment; a plain macOS vault cwd cannot reproduce it.
    const result = await sendAssistantNotificationLocal({ channel: 'linq', deliveryTarget: 'synthetic-room', deliveryIdempotencyKey: eventId,
      deliveryDispatchMode: 'queue-only', threadId: 'synthetic-room', threadIsDirect: false,
      executionContext: { hosted: { defaultTarget: target, gameRecapScope: scope, providerFetch: fixture.providerFetch, groupTool: { request: fixture.control }, memberId: 'synthetic-room', userEnvKeys: [] } },
      instructions: 'Read the synthetic recap inputs, generate file media, preview, revise, then submit the show.', responsePolicy: { kind: 'require_game_recap', ...scope },
      turnEnvironment: { currentWorkingDirectory: vault, env: { PATH: process.env.PATH, HOME: home, MURPH_HOSTED_RUNTIME_PROCESS: '1', OPENAI_API_KEY: 'synthetic-only', ELEVENLABS_API_KEY: 'synthetic-only' } },
      vault, workingDirectory: vault,
    });
    expect(await readFile(path.join(vault, relativeRoot, 'inputs/writing-guide.md'), 'utf8')).toContain('recap');
    expect([...observed].some(output => output.includes('Process exited with code 0') && output.includes(gameId))).toBe(true);
    expect([...observed].some(output => output.includes('RECAP_CONFINEMENT_OK') && output.includes('Process exited with code 0'))).toBe(true);
    expect([...observed].some(output => output.includes('RECAP_PREVIEW_READ_OK') && output.includes('Process exited with code 0'))).toBe(true);
    expect(fixture.receipts).toHaveLength(2);
    expect(fixture.providerCalls.map(call => call.kind)).toEqual(['image', 'song']);
    expect(fixture.phases).toEqual(['prepare', 'accept']);
    expect(fixture.saved).toHaveLength(1);
    const intents = await listAssistantOutboxIntents(vault);
    expect(result.decision.kind).toBe('send_message');
    expect(intents).toHaveLength(1);
    expect(intents[0]!.message).toBe(`${fixture.story.chatLine}\nWatch the recap: https://recaps.murph.test/recap/${gameId}`);
    expect(intents[0]!.media ?? []).toEqual([]);
    const previews = (await readdir(path.join(vault, relativeRoot, 'previews'), { withFileTypes: true })).filter(entry => entry.isDirectory());
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      const png = await readFile(path.join(vault, relativeRoot, 'previews', preview.name, 'page-01.png'));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    process.stdout.write(`Synthetic Linux recap accepted: inputs read; confinement preserved; image + song files; 2 preview drafts; 1 chat line/link; 0 chat media.\n`);
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
