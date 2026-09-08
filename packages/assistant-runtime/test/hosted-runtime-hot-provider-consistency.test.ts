import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
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
import { test } from 'vitest';
import type { HostedMailboxItem } from '@murphai/hosted-execution/runtime-control';
import { runHostedWorkspaceRuntimeJobInProcess } from '../src/hosted-runtime.ts';
import type { RuntimeWakeSignal } from '../src/hosted-runtime/runtime-wake.ts';

test.each([
  { provider: 'openai' as const, providerAllowed: true, handoff: false },
  { provider: 'venice' as const, providerAllowed: false, handoff: true },
  { provider: 'unavailable' as const, providerAllowed: false, handoff: false },
])('checks the $provider provider once after importing a hot conversation wake', async ({ provider, providerAllowed, handoff }) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hot-provider-probe-'));
  const idleWaitStarted = createDeferred<void>();
  const providerReached = createDeferred<void>();
  const mailboxItems: HostedMailboxItem[] = [];
  const phases: string[] = [];
  let phaseCount = 0;
  let providerReads = 0;
  let gatedInputId: string | null = null;
  let providerEntryCount = 0;
  let checkpointInputStatus: string | null = null;
  let notifyWait: ((value: { notifiedAtEpochMs: number }) => void) | null = null;
  const wakeSignal: RuntimeWakeSignal = {
    consumePending: () => null,
    notify: () => notifyWait?.({ notifiedAtEpochMs: Date.now() }),
    wait(signal) {
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (notifyWait === complete) notifyWait = null;
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        const complete = (value: { notifiedAtEpochMs: number }) => {
          signal?.removeEventListener('abort', abort);
          if (notifyWait === complete) notifyWait = null;
          resolve(value);
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (phaseCount > 0) {
          notifyWait = complete;
          idleWaitStarted.resolve();
        }
      });
    },
  };
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const job = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: {
        attemptId: 'attempt_synthetic_hot_provider_probe',
        idleCheckpointDelayMs: 500,
        leaseGeneration: '7',
        userId: TEST_USER_ID,
        workspaceVersion: '0',
      },
    }), {
      async createCheckpointSnapshot() {
        if (gatedInputId !== null) {
          checkpointInputStatus = (await readAssistantInputEvent({
            inputId: gatedInputId,
            vault: vaultRoot,
          }))?.projection.status ?? null;
        }
        return { snapshotRef: createBundleRef({
          hash: 'f'.repeat(64),
          key: 'users/bundles/member-synthetic/hot-provider-probe.bundle.json',
          size: 512,
        }) };
      },
      async importItem(input) {
        phases.push('import');
        gatedInputId = await stagePendingLinqAssistantInputForMailboxItem({
          item: input.item,
          vaultRoot,
        });
        return { status: 'imported', assistantInputId: gatedInputId };
      },
      platform: createPlatform({
        assistantConfigurationToolPort: {
          async request() {
            providerReads += 1;
            phases.push('provider.read');
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (provider === 'unavailable') throw new Error('Synthetic control plane unavailable');
            return {
              action: 'read',
              result: {
                availableModels: ['gpt-5.6-terra'],
                availableProviders: ['openai', 'venice'],
                availableReasoningEfforts: ['low'],
                configurationAvailable: true,
                dormantSolPreference: false,
                model: 'gpt-5.6-terra',
                provider,
                reasoningEffort: 'low',
                solAvailable: false,
              },
            };
          },
        },
        mailboxPort: createMailboxPort({ events: [], items: mailboxItems }),
        workspacePort: createWorkspacePort({
          checkpointRequests: [], events: [],
          workspace: createWorkspaceState({ version: '0' }),
        }),
      }),
      runtimeWakeSignal: wakeSignal,
      async runAssistantPhase(input) {
        phaseCount += 1;
        if (gatedInputId !== null) {
          try {
            const release = await input.beforeProviderAcceptedInputs?.({
              turnId: 'turn_synthetic_hot_provider_probe',
              acceptedInputs: [{ id: gatedInputId, source: 'assistant-input' }],
            });
            phases.push('provider.entry');
            providerEntryCount += 1;
            await release?.();
          } catch (error) {
            assert.equal(error instanceof Error ? error.name : null, 'AssistantActiveTurnInputUnavailableError');
            phases.push('provider.deferred');
          }
          providerReached.resolve();
        }
        return {
          checkpointReason: 'assistant_runtime_commit',
          ...(gatedInputId !== null && !providerAllowed
            ? { nextWakeAt: new Date(Date.now() + 30_000).toISOString(), nextWakeReason: 'assistant' }
            : {}),
          progressed: true,
        };
      },
      vaultRoot,
    });
    await withRealTimeout(idleWaitStarted.promise, 3000, () => 'Idle wait unavailable');
    mailboxItems.push(createMailboxItem({ id: 'mailbox_synthetic_hot_provider_probe', laneSeq: '1' }));
    const startedAt = performance.now();
    wakeSignal.notify();
    await withRealTimeout(providerReached.promise, 3000, () => JSON.stringify({ phases, providerReads }));
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.equal(providerReads, 1);
    assert.equal(providerEntryCount, providerAllowed ? 1 : 0);
    assert.deepEqual(phases, ['import', 'provider.read', providerAllowed ? 'provider.entry' : 'provider.deferred']);
    assert.ok(elapsedMs >= 100);
    const result = await withRealTimeout(job, 3000, () => 'Runtime did not settle');
    if (handoff) assert.equal(result.immediateRecheckRequested, true);
    assert.equal(checkpointInputStatus, 'pending');
    if (!providerAllowed) {
      assert.equal(result.status, 'scheduled');
      assert.equal(result.nextWakeReason, 'assistant');
    }
  } finally {
    await removeTempRoot(vaultRoot);
  }
});
