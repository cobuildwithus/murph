import { afterEach, expect, it, vi } from 'vitest';
import {
  cancelHostedLinqInputTyping, createHostedAssistantChannelTypingDependencies, startHostedLinqInputTyping,
} from '../src/hosted-runtime/channel-activity.ts';
import type { HostedAssistantLinqDeliveryContext } from '../src/hosted-runtime/linq-delivery-context.ts';

let sequence = 0;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());
function fixture(covered: boolean | Promise<boolean>) {
  const target = `synthetic-typing-${++sequence}`;
  const context: HostedAssistantLinqDeliveryContext = {
    target, service: 'iMessage', threadIsDirect: true, replyToMessageId: 'message-later',
    directRecipientPhoneNumber: null, fromPhoneNumber: null, routeAuthority: null,
  };
  let visible = false;
  const providerFetch = vi.fn<typeof fetch>(async (_url, init) => {
    visible = init?.method === 'POST';
    return new Response(null, { status: 204 });
  });
  const read = vi.fn(async () => ({ ackCovered: await covered }));
  const input = {
    forwardedEnv: { LINQ_API_TOKEN: 'synthetic-token' }, userEnv: {}, providerFetch,
    effectsPort: { assertLinqRecentInboundEngagement: read },
  };
  return { input, context, read, providerFetch, visible: () => visible,
    take: () => createHostedAssistantChannelTypingDependencies({ ...input, linqDeliveryContexts: [context] })
      .startLinqTyping!({ target }),
    prepare: (signal?: AbortSignal) => startHostedLinqInputTyping({ ...input, signal,
      inputId: target, runtimeAttemptId: target, linqDeliveryContext: context }),
  };
}

it.each([true, false])('attachment preparation shares its decision and release after handoff (covered=%s)', async covered => {
  vi.useFakeTimers();
  const f = fixture(covered);
  const cancel = f.prepare();
  await vi.advanceTimersByTimeAsync(500);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.visible()).toBe(!covered);
  await vi.advanceTimersByTimeAsync(10_000);
  const handle = await f.take();
  expect(handle).toBeDefined();
  cancel?.(); // importer cancellation cannot revoke a handed-off turn
  handle?.release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.visible()).toBe(true);
  expect(f.providerFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(f.read).toHaveBeenCalledTimes(1);
  await handle?.stop();
  expect(f.visible()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the preparation deadline across handoff and no additional provider requests', async () => {
  vi.useFakeTimers();
  const f = fixture(true);
  f.prepare();
  await vi.advanceTimersByTimeAsync(20_000);
  const handle = await f.take();
  await vi.advanceTimersByTimeAsync(9999);
  expect(f.visible()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.visible()).toBe(true);
  expect(f.read).toHaveBeenCalledTimes(1);
  await handle?.stop();
});

it.each([0, 500, 1500])('cancels preparation at %d without a surviving timer or late restart', async at => {
  vi.useFakeTimers();
  const coverage = deferred<boolean>();
  const f = fixture(coverage.promise);
  const controller = new AbortController();
  f.prepare(controller.signal);
  if (at > 500) coverage.resolve(true);
  await vi.advanceTimersByTimeAsync(at);
  controller.abort();
  await cancelHostedLinqInputTyping({ runtimeAttemptId: f.context.target });
  coverage.resolve(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.providerFetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops after handoff while coverage is pending and cannot restart after terminal delivery', async () => {
  vi.useFakeTimers();
  const coverage = deferred<boolean>();
  const f = fixture(coverage.promise);
  f.prepare();
  await vi.advanceTimersByTimeAsync(500);
  const handle = await f.take();
  await handle?.stop({ providerStop: false });
  coverage.resolve(true);
  handle?.release?.();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.providerFetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('late provider acceptance cannot clear a successor chat claim', async () => {
  vi.useFakeTimers();
  const f = fixture(true);
  const acceptance = deferred<Response>();
  f.providerFetch.mockImplementationOnce(() => acceptance.promise);
  const old = await f.take();
  old?.release?.();
  await vi.advanceTimersByTimeAsync(0);
  await old?.stop({ providerStop: false });
  // The existing claim expiry permits a successor; the old provider call remains pending.
  vi.setSystemTime(Date.now() + 16 * 60_000);
  const successor = await f.take();
  successor?.release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.visible()).toBe(true);
  acceptance.resolve(new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.providerFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  expect(f.visible()).toBe(true);
  await successor?.stop();
  expect(f.visible()).toBe(false);
});

it('aborting a pending foreground POST preserves its handle for eventual provider cleanup', async () => {
  vi.useFakeTimers();
  const f = fixture(true);
  const acceptance = deferred<Response>();
  f.providerFetch.mockImplementationOnce(async (_url, init) => {
    const response = await acceptance.promise;
    expect(init?.signal?.aborted).not.toBe(true);
    return response;
  });
  const controller = new AbortController();
  const handle = await createHostedAssistantChannelTypingDependencies({ ...f.input,
    linqDeliveryContexts: [f.context], signal: controller.signal,
  }).startLinqTyping!({ target: f.context.target! });
  handle?.release?.();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  acceptance.resolve(new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.providerFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
