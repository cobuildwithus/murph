import assert from "node:assert/strict";

import { afterEach, expect, test, vi } from "vitest";

import type {
  AssistantChannelActivityHandle,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import type { HostedRuntimeLatencyTraceRequest } from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({ startLinqTypingIndicator: vi.fn() }));
vi.mock("@murphai/assistant-engine/assistant-channel-adapters", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/assistant-engine/assistant-channel-adapters")>(),
  startLinqTypingIndicator: mocks.startLinqTypingIndicator,
}));

import {
  createHostedAssistantChannelTypingDependencies,
  startHostedLinqAttachmentTyping,
} from "../src/hosted-runtime/channel-activity.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await drainMicrotasks();
  vi.useRealTimers();
  mocks.startLinqTypingIndicator.mockReset();
});

test("one preparation handle hands off its accepted time, refresh budget and cancellation", async () => {
  const fixture = createFixture("handoff");
  const preparation = new AbortController();
  const turn = new AbortController();
  cleanups.push(() => turn.abort());
  const cancel = startHostedLinqAttachmentTyping({ ...fixture.input, signal: preparation.signal });
  assert.ok(cancel);
  cleanups.push(cancel);
  await drainMicrotasks();
  const accepted = fixture.events.find(isAcceptance);
  assert.ok(accepted);
  assert.deepEqual(accepted.assistantInputIds, ["input_handoff"]);

  // A duplicate import cannot create or acquire a second loop.
  assert.equal(startHostedLinqAttachmentTyping(fixture.input), null);
  const handle = await fixture.typing(turn.signal).startLinqTyping?.({ target: fixture.context.target! });
  assert.ok(handle);
  cleanups.push(() => handle.stop({ providerStop: false }));
  assert.equal(handle.acceptedAt, accepted.at);
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledOnce();
  const dependencies = mocks.startLinqTypingIndicator.mock.calls[0]?.[1];
  assert.equal(dependencies.maxSessionMs, 5 * 60_000);
  assert.equal(dependencies.refreshMs, 45_000);
  assert.equal(dependencies.fetchImplementation, fixture.input.providerFetch);

  preparation.abort();
  cancel();
  await drainMicrotasks();
  assert.equal(dependencies.signal.aborted, false);
  expect(fixture.stop).not.toHaveBeenCalled();
  turn.abort();
  await drainMicrotasks();
  assert.equal(dependencies.signal.aborted, true);
  expect(fixture.stop).toHaveBeenCalledOnce();
});

test("delivery releases a taken handle without a late importer cancellation stopping the provider", async () => {
  const fixture = createFixture("delivered");
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  const handle = await fixture.typing().startLinqTyping?.({ target: fixture.context.target! });
  assert.ok(handle);
  await handle.stop({ providerStop: false });
  cancel();
  await drainMicrotasks();
  expect(fixture.stop).toHaveBeenCalledExactlyOnceWith({ providerStop: false });
  assert.equal(fixture.events.some(isAcceptance), false); // Taken before provider acceptance.
});

test.each(["cancel", "abort"])("%s before pending acceptance cleans up the late handle without acceptance", async (kind) => {
  const fixture = createFixture(`late_${kind}`);
  const pending = createDeferred<AssistantChannelActivityHandle>();
  mocks.startLinqTypingIndicator.mockReturnValue(pending.promise);
  const controller = new AbortController();
  const cancel = startHostedLinqAttachmentTyping({ ...fixture.input, signal: controller.signal });
  assert.ok(cancel);
  cleanups.push(cancel);
  await drainMicrotasks();
  assert.equal(fixture.events.some(isAcceptance), false);
  if (kind === "abort") controller.abort();
  else cancel();
  await drainMicrotasks();
  assert.equal(mocks.startLinqTypingIndicator.mock.calls[0]?.[1].signal.aborted, true);
  pending.resolve(fixture.handle);
  await drainMicrotasks();
  expect(fixture.stop).toHaveBeenCalledOnce();
  assert.equal(fixture.events.some(isAcceptance), false);
});

test("a pending handoff leaves acceptance observation to the turn, not the old importer", async () => {
  const fixture = createFixture("pending_handoff");
  const pending = createDeferred<AssistantChannelActivityHandle>();
  mocks.startLinqTypingIndicator.mockReturnValue(pending.promise);
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  const handlePromise = fixture.typing().startLinqTyping?.({ target: fixture.context.target! });
  pending.resolve(fixture.handle);
  const handle = await handlePromise;
  assert.ok(handle);
  await handle.stop({ providerStop: false });
  await drainMicrotasks();
  assert.equal(fixture.events.some(isAcceptance), false);
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledOnce();
});

test.each(["failed", "unconfigured"])("%s start releases the claim without inventing acceptance", async (kind) => {
  const fixture = createFixture(`start_${kind}`);
  if (kind === "failed") mocks.startLinqTypingIndicator.mockRejectedValue(new Error("synthetic start failure"));
  else mocks.startLinqTypingIndicator.mockResolvedValue(undefined);
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  await drainMicrotasks();
  assert.equal(fixture.events.some(isAcceptance), false);
  mocks.startLinqTypingIndicator.mockResolvedValue(fixture.handle);
  const retry = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(retry);
  cleanups.push(retry);
  await drainMicrotasks();
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(2);
  assert.equal(fixture.events.filter(isAcceptance).length, 1);
});

test("handoff still validates the exact context and the same invocation's provider authority", async () => {
  const fixture = createFixture("authority");
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  const typing = fixture.typing();
  assert.equal(await typing.startLinqTyping?.({ target: "other_chat" }), undefined);
  assert.equal(await typing.startLinqTyping?.({ target: fixture.context.target!, replyToMessageId: "other_message" }), undefined);
  assert.equal(await typing.startLinqTyping?.({ target: fixture.context.target!, targetKind: "participant" }), undefined);
  const otherAuthority = createHostedAssistantChannelTypingDependencies({
    ...fixture.input, providerFetch: vi.fn<typeof fetch>(), linqDeliveryContexts: [fixture.context],
  });
  assert.equal(await otherAuthority.startLinqTyping?.({ target: fixture.context.target! }), undefined);
  const handle = await typing.startLinqTyping?.({ target: fixture.context.target! });
  assert.ok(handle);
  await handle.stop({ providerStop: false });
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledOnce();
});

test("ineligible, mismatched, aborted and unconfigured preparation never starts typing", () => {
  const fixture = createFixture("ineligible");
  const authority = {
    accountLookupKey: "synthetic_account", channel: "linq" as const,
    containerMemberId: "synthetic_member", threadId: "other_chat",
  };
  for (const context of [
    null,
    { ...fixture.context, target: null },
    { ...fixture.context, threadIsDirect: false },
    { ...fixture.context, threadIsDirect: null },
    { ...fixture.context, routeAuthority: authority },
  ]) {
    assert.equal(startHostedLinqAttachmentTyping({ ...fixture.input, linqDeliveryContext: context }), null);
  }
  assert.equal(startHostedLinqAttachmentTyping({ ...fixture.input, providerFetch: null }), null);
  assert.equal(startHostedLinqAttachmentTyping({ ...fixture.input, signal: AbortSignal.abort() }), null);
  expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
});

test("authenticated group preparation uses the existing auto-reply authority rule", async () => {
  const fixture = createFixture("group");
  fixture.context.threadIsDirect = false;
  fixture.context.routeAuthority = {
    accountLookupKey: "synthetic_account", channel: "linq",
    containerMemberId: "synthetic_member", threadId: fixture.context.target!,
  };
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  await drainMicrotasks();
  assert.equal(fixture.events.filter(isAcceptance).length, 1);
});

test("an active turn suppresses preparation and a full session retains the existing cooldown", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-01T00:00:00.000Z") });
  const fixture = createFixture("cooldown");
  const active = await fixture.typing().startLinqTyping?.({ target: fixture.context.target! });
  assert.ok(active);
  assert.equal(startHostedLinqAttachmentTyping(fixture.input), null);
  await active.stop({ providerStop: false });
  const cancel = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(cancel);
  cleanups.push(cancel);
  const taken = await fixture.typing().startLinqTyping?.({ target: fixture.context.target! });
  assert.ok(taken);
  vi.setSystemTime(Date.now() + 5 * 60_000);
  await taken.stop({ providerStop: false });
  assert.equal(startHostedLinqAttachmentTyping(fixture.input), null);
  vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
  const next = startHostedLinqAttachmentTyping(fixture.input);
  assert.ok(next);
  cleanups.push(next);
  expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(3);
});

function createFixture(name: string) {
  const context: HostedAssistantLinqDeliveryContext = {
    directRecipientPhoneNumber: null, fromPhoneNumber: null,
    replyToMessageId: `message_${name}`, routeAuthority: null, service: null,
    target: `chat_${name}`, threadIsDirect: true,
  };
  const events: HostedRuntimeLatencyTraceRequest["event"][] = [];
  const stop = vi.fn(async () => {});
  const handle: AssistantChannelActivityHandle = { isActive: () => true, stop };
  mocks.startLinqTypingIndicator.mockResolvedValue(handle);
  const input = {
    forwardedEnv: {}, userEnv: {}, providerFetch: vi.fn<typeof fetch>(),
    linqDeliveryContext: context,
    latencyTraceContext: {
      assistantInputIds: [`input_${name}`], runtimeAttemptId: `attempt_${name}`,
      source: "linq" as const,
      latencyTracePort: { async record(request: HostedRuntimeLatencyTraceRequest) {
        events.push(request.event);
        return { matchedCount: 1, recorded: true, unmatchedCount: 0 };
      } },
    },
  };
  return {
    context, events, handle, input, stop,
    typing: (signal?: AbortSignal) => createHostedAssistantChannelTypingDependencies({
      ...input, signal, linqDeliveryContexts: [context],
    }),
  };
}

function isAcceptance(event: HostedRuntimeLatencyTraceRequest["event"]): event is Extract<
  HostedRuntimeLatencyTraceRequest["event"], { type: "assistant_milestone" }
> {
  return event.type === "assistant_milestone" && event.milestone === "linq_typing_accepted";
}

async function drainMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
