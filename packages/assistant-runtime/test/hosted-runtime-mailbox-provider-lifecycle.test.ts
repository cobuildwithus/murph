import {
  TEST_NOW,
  createSnapshotFixtureRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  stagePendingLinqAssistantInputForMailboxItem,
  withRealTimeout,
} from './hosted-runtime-workspace-entrypoint.harness.ts';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeVault } from '@murphai/core';
import { readAssistantInputEvent } from '@murphai/assistant-engine';
import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from '@murphai/runtime-state/node';
import type {
  HostedRuntimeAssistantConfigurationControlRequest,
} from '@murphai/hosted-execution/runtime-control';
import { test, vi } from 'vitest';
import { runHostedWorkspaceRuntimeJobInProcess } from '../src/hosted-runtime.ts';
import {
  createCoalescingRuntimeWakeSignal,
} from '../src/hosted-runtime/runtime-wake.ts';

test.each(['openai', 'venice'] as const)(
  'uses an empty initial mailbox provider fact for already-staged input: %s',
  async (provider) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-provider-restored-input-'));
    const events: string[] = [];
    const settingsRequest = vi.fn(async () => {
      throw new Error('Provider admission must not fetch assistant settings.');
    });
    let providerEntries = 0;
    let assistantPhases = 0;
    try {
      const { artifactBytesByHash, pendingInputId, workspace } =
        await createStagedProviderWorkspace(vaultRoot);
      assert.equal((await readAssistantInputEvent({
        inputId: pendingInputId, vault: vaultRoot,
      }))?.projection.status, 'pending');

      const result = await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        {
          async importItem() { throw new Error('Empty mailbox must not import an item.'); },
          async createCheckpointSnapshot() {
            assert.ok(workspace.snapshotRef);
            return { snapshotRef: workspace.snapshotRef };
          },
          platform: createPlatform({
            artifactBytesByHash,
            assistantConfigurationToolPort: { request: settingsRequest },
            mailboxPort: createMailboxPort({ assistantProvider: provider, events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [], events, workspace,
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhases += 1;
            const beforeProvider = input.beforeProviderAcceptedInputs;
            assert.ok(beforeProvider);
            assert.equal((await readAssistantInputEvent({
              inputId: pendingInputId, vault: vaultRoot,
            }))?.projection.status, 'pending');
            if (provider === 'venice') {
              await assert.rejects(async () => await beforeProvider({
                acceptedInputs: [{ id: pendingInputId, source: 'assistant-input' }],
                turnId: 'turn_restored_provider_handoff',
              }), { name: 'AssistantActiveTurnInputUnavailableError' });
              return {
                checkpointReason: 'assistant_runtime_commit',
                nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
                nextWakeReason: 'assistant',
                progressed: true,
              };
            }
            // Continuations reuse the fact observed by the mailbox owner.
            // No subsequent settings request is needed at either boundary.
            for (let ordinal = 0; ordinal < 2; ordinal += 1) {
              const release = await beforeProvider({
                acceptedInputs: [{ id: pendingInputId, source: 'assistant-input' }],
                turnId: `turn_restored_provider_${ordinal}`,
              });
              providerEntries += 1;
              await release?.();
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      ), 3000, () => 'Restored provider lifecycle did not settle');

      assert.ok(events.includes('mailbox.fetch'));
      assert.equal(settingsRequest.mock.calls.length, 0);
      assert.equal(assistantPhases, 1);
      assert.equal(providerEntries, provider === 'openai' ? 2 : 0);
      if (provider === 'venice') assert.equal(result.immediateRecheckRequested, true);
      // A provider handoff cannot consume the staged input. It remains durable
      // even though the current mailbox fetch contains no items to reimport.
      assert.equal((await readAssistantInputEvent({
        inputId: pendingInputId, vault: vaultRoot,
      }))?.projection.status, 'pending');
    } finally {
      await removeTempRoot(vaultRoot);
    }
  },
);

test('an empty settings-only hot wake hands off without another assistant turn or settings read', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-provider-empty-hot-wake-'));
  const idleWaitStarted = createDeferred<void>();
  const wakeSignal = createCoalescingRuntimeWakeSignal();
  const settingsRequest = vi.fn(async () => {
    throw new Error('An empty mailbox response must carry provider consistency.');
  });
  let provider: 'openai' | 'venice' = 'openai';
  let assistantPhases = 0;
  const events: string[] = [];
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const job = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { idleCheckpointDelayMs: 500 },
    }), {
      async importItem() { throw new Error('Settings-only wake must not import an item.'); },
      async createCheckpointSnapshot() {
        return { snapshotRef: createSnapshotFixtureRef({
          hash: 'b'.repeat(64),
          size: 512,
        }) };
      },
      platform: createPlatform({
        assistantConfigurationToolPort: { request: settingsRequest },
        mailboxPort: createMailboxPort({
          get assistantProvider() { return provider; },
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests: [], events, workspace: createWorkspaceState(),
        }),
      }),
      runtimeWakeSignal: {
        ...wakeSignal,
        wait(signal) {
          if (assistantPhases > 0) idleWaitStarted.resolve();
          return wakeSignal.wait(signal);
        },
      },
      async runAssistantPhase() {
        assistantPhases += 1;
        return { checkpointReason: 'assistant_runtime_commit', progressed: true };
      },
      vaultRoot,
    });

    await withRealTimeout(idleWaitStarted.promise, 3000, () => 'Hot runtime did not enter idle wait');
    const fetchesBeforeWake = events.filter((event) => event === 'mailbox.fetch').length;
    provider = 'venice';
    wakeSignal.notify();
    const result = await withRealTimeout(job, 3000, () => 'Settings-only wake did not hand off');

    assert.ok(events.filter((event) => event === 'mailbox.fetch').length > fetchesBeforeWake);
    assert.equal(assistantPhases, 1);
    assert.equal(settingsRequest.mock.calls.length, 0);
    assert.equal(result.immediateRecheckRequested, true);
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

test('an acknowledged provider update blocks the next boundary without rereading settings', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-provider-acknowledged-update-'));
  const settingsRequest = vi.fn(async (request: HostedRuntimeAssistantConfigurationControlRequest) => {
    assert.equal(request.action, 'update', 'Provider admission attempted an unnecessary settings read');
    return {
      action: 'update' as const,
      result: {
        appliesAt: 'next_turn' as const,
        availableModels: ['gpt-5.6-terra' as const],
        availableProviders: ['openai' as const, 'venice' as const],
        availableReasoningEfforts: ['low' as const],
        configurationAvailable: true,
        dormantSolPreference: false,
        model: 'gpt-5.6-terra' as const,
        provider: 'venice' as const,
        reasoningEffort: 'low' as const,
        requiredPlan: null,
        solAvailable: false,
        status: 'updated' as const,
      },
    };
  });
  let providerEntries = 0;
  try {
    const { artifactBytesByHash, pendingInputId, workspace } =
      await createStagedProviderWorkspace(vaultRoot);
    const result = await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput(),
      {
        async importItem() { throw new Error('Empty mailbox must not import an item.'); },
        async createCheckpointSnapshot() {
          assert.ok(workspace.snapshotRef);
          return { snapshotRef: workspace.snapshotRef };
        },
        platform: createPlatform({
          artifactBytesByHash,
          assistantConfigurationToolPort: { request: settingsRequest },
          mailboxPort: createMailboxPort({ assistantProvider: 'openai', events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [], events: [], workspace,
          }),
        }),
        async runAssistantPhase(input) {
          const beforeProvider = input.beforeProviderAcceptedInputs;
          assert.ok(beforeProvider);
          const accepted = {
            acceptedInputs: [{ id: pendingInputId, source: 'assistant-input' as const }],
            turnId: 'turn_acknowledged_provider_update',
          };
          const release = await beforeProvider(accepted);
          providerEntries += 1;
          await release?.();
          const configuration = input.runtime.platform.assistantConfigurationToolPort;
          assert.ok(configuration);
          await configuration.request({
            action: 'update', assistantInputId: pendingInputId, provider: 'venice',
          });
          await assert.rejects(async () => await beforeProvider(accepted), {
            name: 'AssistantActiveTurnInputUnavailableError',
          });
          return { checkpointReason: 'assistant_runtime_commit', progressed: true };
        },
        vaultRoot,
      },
    ), 3000, () => 'Acknowledged provider update did not hand off');

    assert.equal(providerEntries, 1);
    assert.equal(settingsRequest.mock.calls.length, 1);
    assert.equal(result.immediateRecheckRequested, true);
    assert.equal((await readAssistantInputEvent({
      inputId: pendingInputId, vault: vaultRoot,
    }))?.projection.status, 'pending');
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

async function createStagedProviderWorkspace(vaultRoot: string) {
  await initializeVault({ createdAt: TEST_NOW, vaultRoot });
  const pendingInputId = await stagePendingLinqAssistantInputForMailboxItem({
    item: createMailboxItem({ id: 'mailbox_staged_provider_input', laneSeq: '1' }),
    vaultRoot,
  });
  const base = await snapshotHostedBundleRoots({
    kind: 'vault', roots: [{ root: vaultRoot, rootKey: 'vault' }],
  });
  assert.ok(base);
  const baseHash = sha256HostedBundleHex(base);
  return {
    artifactBytesByHash: new Map([
      [baseHash, base],
    ]),
    pendingInputId,
    workspace: createWorkspaceState({
      snapshotRef: createSnapshotFixtureRef({
        hash: baseHash,
        size: base.byteLength,
      }),
    }),
  };
}
