import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import type { HostedRuntimeGroupToolRequest, HostedGameToolResponse } from '@murphai/hosted-execution/runtime-control';
import { buildAssistantProviderMurphToolCall, buildAssistantProviderShellCommandCall, startAssistantProviderStubServer, type HostedLocalAssistantProviderScriptedResponse } from './helpers/hosted-local-e2e-support.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const exec = promisify(execFile);
const containerFlag = 'MURPH_RECAP_CONTAINER_PROOF';

it('reads recap inputs through the production hosted Linux sandbox', async () => {
  if (process.env[containerFlag] !== '1') {
    const image = `murph-recap-files-proof:${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
    try {
      await exec('docker', ['build', '--platform', 'linux/amd64', '-f', path.join(root, 'Dockerfile.cloudflare-hosted-runner'), '-t', image, path.join(root, 'apps/cloudflare')], { maxBuffer: 16 * 1024 * 1024 });
      const result = await exec('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined',
        '--user', `${process.getuid!()}:${process.getgid!()}`, '--mount', `type=bind,source=${root},target=/workspace`, '--workdir', '/workspace', '-e', `${containerFlag}=1`, '--entrypoint', 'node', image,
        '/workspace/node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--config', 'apps/cloudflare/vitest.e2e.config.ts', 'apps/cloudflare/test/hosted-local-recap-files-e2e.test.ts'], { maxBuffer: 16 * 1024 * 1024 });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
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
  const responses: HostedLocalAssistantProviderScriptedResponse[] = [buildAssistantProviderMurphToolCall('read_game', {}), buildAssistantProviderShellCommandCall(command), 'Synthetic recap file probe complete.'];
  const observed: string[] = [];
  const server = await startAssistantProviderStubServer({ responseState: { queuedResponses: responses }, maxResponsesApiRequestBodies: 5, onRequest: request => { if (request.url === '/v1/responses') observed.push(request.body); } });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback provider.');
  const control = async (request: HostedRuntimeGroupToolRequest): Promise<HostedGameToolResponse> => {
    if (request.action !== 'read_game') throw new Error('Unexpected synthetic command.');
    const kind = request.recapRead?.kind;
    const recapGame = kind === 'recover' ? { recovered: false }
      : kind === 'admit' ? { admitted: true, runId: request.recapRead?.kind === 'admit' ? request.recapRead.runId : '', token: 'a'.repeat(64), deadline: new Date(Date.now() + 120_000).toISOString() }
      : kind === 'end' ? { ended: true }
      : kind === 'transcript' ? { messages: [], next: null, through: '0', since: '2026-11-01T00:00:00Z', until: '2026-11-04T00:00:00Z', retainedSince: '2026-11-01T00:00:00Z', incomplete: false }
      : { pendingRecapUsages: [], material: { game: { id: gameId, maxPlayers: 2, recapShow: true }, players: ['Player A', 'Player B'], entries: [], result: [{ memberId: 'synthetic-a', name: 'Player A', score: 3 }, { memberId: 'synthetic-b', name: 'Player B', score: 2 }], references: [], startedAt: '2026-11-01T00:00:00Z', settledAt: '2026-11-04T00:00:00Z' } };
    return { action: 'read_game', result: { status: 'ok', recapGame } };
  };
  const originalCwd = process.cwd();
  try {
    process.chdir(vault);
    await initializeVault({ vaultRoot: vault, timezone: 'UTC' });
    await mkdir(path.join(vault, 'games'), { recursive: true });
    await writeFile(path.join(vault, 'games/lore-0123456789abcdef0123456789abcdef.md'), '# Synthetic game lore\n');
    await writeFile(path.join(home, 'config.toml'), [
      'model = "gpt-6.1-sol"', 'model_provider = "synthetic"', 'approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'allow_login_shell = false',
      `model_catalog_json = "/usr/local/share/murph/codex-model-catalog.openai-flex.json"`,
      '[model_providers.synthetic]', 'name = "Synthetic loopback"', `base_url = "http://127.0.0.1:${address.port}/v1"`, 'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"', 'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
      ...buildMurphHostedPermissionProfileTomlLines(),
    ].join('\n'));
    const target = createAssistantModelTarget({ approvalPolicy: 'never', codexCommand: '/usr/local/bin/codex', codexHome: home, model: 'gpt-6.1-sol', modelProvider: 'synthetic', provider: 'codex-cli', reasoningEffort: 'low', sandbox: 'workspace-write' });
    if (!target) throw new Error('Expected synthetic target.');
    const scope = { gameId, eventId, pairFingerprint: '0123456789abcdef0123456789abcdef', show: true as const };
    const events: unknown[] = [];
    // The real hosted runtime restores the vault at process cwd. The planner
    // must see that environment; a plain macOS vault cwd cannot reproduce it.
    await sendAssistantNotificationLocal({ channel: 'linq', deliveryTarget: 'synthetic-room', deliveryIdempotencyKey: eventId,
      deliveryDispatchMode: 'queue-only', threadId: 'synthetic-room', threadIsDirect: false,
      executionContext: { hosted: { defaultTarget: target, gameRecapScope: scope, groupTool: { request: control }, memberId: 'synthetic-room', userEnvKeys: [] } },
      instructions: 'Read the synthetic recap inputs.', responsePolicy: { kind: 'require_game_recap', ...scope },
      turnEnvironment: { currentWorkingDirectory: vault, env: { PATH: process.env.PATH, HOME: home, MURPH_HOSTED_RUNTIME_PROCESS: '1', OPENAI_API_KEY: 'synthetic-only' } },
      vault, workingDirectory: vault, onTraceEvent: event => events.push(event.rawEvent),
    }).catch(error => { process.stdout.write(`recap probe completion: ${error instanceof Error ? error.message : 'failed'}\n`); });
    expect(await readFile(path.join(vault, relativeRoot, 'inputs/writing-guide.md'), 'utf8')).toContain('recap');
    process.stdout.write(`Synthetic Linux command: ${command}\n`);
    const outputs = observed.flatMap(body => {
      const parsed = JSON.parse(body);
      return (parsed.input ?? []).filter((item: { type?: string }) => item.type === 'function_call_output' || item.type === 'custom_tool_call_output');
    });
    process.stdout.write(`Synthetic Linux tool outputs: ${JSON.stringify(outputs)}\n`);
    expect(outputs.some(output => JSON.stringify(output).includes('Process exited with code 0'))).toBe(true);
  } finally {
    await stopWarmCodexAppServer();
    process.chdir(originalCwd);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(vault, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
  }
}, 600_000);
