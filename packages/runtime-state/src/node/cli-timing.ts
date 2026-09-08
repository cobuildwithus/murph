import { AsyncLocalStorage } from "node:async_hooks";
import { createSocket, type Socket } from "node:dgram";
import {
  CLI_TIMING_ENDPOINT_ENV, addCliPhaseSample, cliTimingCommand, CLI_TIMING_MAX_REPORT_BYTES, CLI_TIMING_MAX_SPANS,
  emptyCliTiming, incrementCliTimingDrop, mergeCliTiming, normalizeCliTiming,
  type CliPhaseTiming, type CliTiming, type CliTimingOutcome, type CliTimingPhase,
} from "../cli-timing.ts";

export { CLI_TIMING_ENDPOINT_ENV } from "../cli-timing.ts";
interface Collection {
  report: CliTiming;
  publish: (report: CliTiming) => void;
  closed: boolean;
  openInvocations: number;
}
interface Invocation {
  command: string;
  phases: CliPhaseTiming[];
  started: bigint;
  dispatchEnded: bigint | null;
  dispatchStarted: boolean;
  outcome: CliTimingOutcome;
  closed: boolean;
  actionEnded: boolean;
  spans: number;
  activeSpans: number;
  collection: Collection;
}
const invocations = new AsyncLocalStorage<Invocation>();
const noop = () => {};
const elapsedUs = (start: bigint) => Number((process.hrtime.bigint() - start) / 1_000n);

/** Inclusive spans, summed per fixed name. Overlapping/nested spans are NOT additive.
 * No samples from another invocation, completed scope, or unawaited late work escape.
 */
export function startCliPhase(phase: CliTimingPhase): () => void {
  const invocation = invocations.getStore();
  if (!invocation || invocation.closed || invocation.collection.closed) return noop;
  if (invocation.spans >= CLI_TIMING_MAX_SPANS) {
    invocation.collection.report.droppedSpans = incrementCliTimingDrop(invocation.collection.report.droppedSpans);
    return noop;
  }
  invocation.spans += 1;
  invocation.activeSpans += 1;
  const started = process.hrtime.bigint();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    invocation.activeSpans -= 1;
    if (invocation.closed || invocation.collection.closed) return;
    if (!addCliPhaseSample(invocation.phases, phase, elapsedUs(started))) {
      invocation.collection.report.droppedSpans = incrementCliTimingDrop(invocation.collection.report.droppedSpans);
    }
  };
}
export async function timeCliPhase<T>(phase: CliTimingPhase, run: () => Promise<T>): Promise<T> {
  const end = startCliPhase(phase);
  try { return await run(); } finally { end(); }
}

/** Called only with Incur's resolved registered path, never argv/display text. */
export async function timeCliDispatch(command: string, next: () => Promise<void>): Promise<void> {
  const invocation = invocations.getStore();
  if (!invocation || invocation.closed || invocation.collection.closed) { await next(); return; }
  const first = !invocation.dispatchStarted;
  invocation.command = first ? cliTimingCommand(command) : "other";
  invocation.dispatchStarted = true;
  if (first) addCliPhaseSample(invocation.phases, "setup", elapsedUs(invocation.started));
  const end = startCliPhase("dispatch");
  try { await next(); }
  catch (error) { invocation.outcome = "error"; throw error; }
  finally { end(); invocation.dispatchEnded = process.hrtime.bigint(); }
}

/** Exported entrypoints own scopes; batch's existing recursive action calls get
 * separate scopes but share one bounded subprocess report. No authority is moved
 * from the CLI's vault-context AsyncLocalStorage into this diagnostic context.
 */
export async function withCliTiming<T>(
  run: () => Promise<T>,
  publish?: (report: CliTiming) => void,
): Promise<T> {
  const parent = invocations.getStore();
  const inherited = parent && !parent.closed && !parent.collection.closed ? parent.collection : null;
  const sender = inherited?.publish ?? publish ?? createCliTimingSender();
  if (!sender) return await run();
  const collection = inherited ?? { report: emptyCliTiming(), publish: sender,
    closed: false, openInvocations: 0 };
  collection.openInvocations += 1;
  const invocation: Invocation = { command: "other", phases: [], started: process.hrtime.bigint(),
    dispatchEnded: null, dispatchStarted: false, outcome: "unknown", closed: false, actionEnded: false,
    spans: 0, activeSpans: 0, collection };
  return await invocations.run(invocation, async () => {
    try {
      const result = await run();
      if (invocation.outcome !== "error") invocation.outcome = "ok";
      return result;
    } catch (error) {
      // bin.ts treats broken pipes specially; do not reinterpret them here.
      invocation.outcome = isBrokenPipe(error) ? "unknown" : "error";
      throw error;
    } finally {
      finishInvocation(invocation);
      if (!inherited) publishCollection(collection);
    }
  });
}

// Incur may call process.exit before an outer finally executes. Observe the
// authoritative code, then delegate unchanged; unflushed datagrams can be lost.
export function isCliTimingActive(): boolean {
  const invocation = invocations.getStore();
  return !!invocation && !invocation.closed && !invocation.collection.closed;
}
export function noteCliTimingExit(code: number, terminating: boolean): void {
  const invocation = invocations.getStore();
  if (!invocation || invocation.closed || invocation.collection.closed) return;
  invocation.outcome = code === 0 ? "ok" : "error";
  if (!terminating) return;
  finishInvocation(invocation);
  publishCollection(invocation.collection);
}
function publishCollection(collection: Collection): void {
  if (collection.closed) return;
  collection.closed = true;
  collection.report.droppedCalls = incrementCliTimingDrop(
    collection.report.droppedCalls, collection.openInvocations);
  collection.report.reportCount = 1;
  try { collection.publish(collection.report); } catch { /* Diagnostic-only sink. */ }
}
/** End the action separately from entrypoint teardown; not pure serialization. */
export function finishCliTimingAction(): void {
  const invocation = invocations.getStore();
  if (invocation && !invocation.closed && !invocation.collection.closed) finishAction(invocation);
}
function finishAction(invocation: Invocation): void {
  if (invocation.actionEnded) return;
  invocation.actionEnded = true;
  if (invocation.dispatchEnded !== null) {
    addCliPhaseSample(invocation.phases, "post-dispatch", elapsedUs(invocation.dispatchEnded));
  } else if (!invocation.dispatchStarted) {
    addCliPhaseSample(invocation.phases, "unattributed", elapsedUs(invocation.started));
  }
}
function isBrokenPipe(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE";
}
function finishInvocation(invocation: Invocation): void {
  if (invocation.closed) return;
  invocation.collection.openInvocations -= 1;
  if (invocation.collection.closed) { invocation.closed = true; return; }
  finishAction(invocation);
  addCliPhaseSample(invocation.phases, "total", elapsedUs(invocation.started));
  invocation.closed = true;
  invocation.collection.report.droppedSpans = incrementCliTimingDrop(
    invocation.collection.report.droppedSpans, invocation.activeSpans);
  if (invocation.command === "batch") {
    // Inclusive parent time is deliberately NOT a second set of child samples.
    invocation.collection.report.batchContainers = incrementCliTimingDrop(invocation.collection.report.batchContainers);
    return;
  }
  mergeCliTiming(invocation.collection.report, { ...emptyCliTiming(), commands: [{
    command: invocation.command, outcome: invocation.outcome, calls: 1,
    phases: invocation.phases,
  }] });
}

/** One loopback datagram per naturally completed subprocess; no await, filesystem,
 * result-channel output, retry or keepalive. Bind early so normal final sends can
 * reach the kernel before process exit. Missing/failed transport is a no-op.
 */
function createCliTimingSender(): ((report: CliTiming) => void) | null {
  const endpoint = process.env[CLI_TIMING_ENDPOINT_ENV];
  const match = endpoint?.match(/^(\d{1,5}):([a-f0-9]{32})$/u);
  if (!match || Number(match[1]) < 49_152 || Number(match[1]) > 65_535) return null;
  const startedUs = Number(process.hrtime.bigint() / 1_000n);
  let socket: Socket;
  try {
    socket = createSocket("udp4");
    socket.unref();
    socket.on("error", () => { try { socket.close(); } catch {} });
    socket.bind(0, "127.0.0.1");
  } catch { return null; }
  let sent = false;
  return (source) => {
    if (sent) return;
    sent = true;
    try {
      const timing = normalizeCliTiming(source);
      if (!timing) { socket.close(); return; }
      const endedUs = Number(process.hrtime.bigint() / 1_000n);
      const encode = () => JSON.stringify({ key: match[2], startedUs, endedUs, timing });
      let data = encode();
      while (Buffer.byteLength(data) > CLI_TIMING_MAX_REPORT_BYTES && timing.commands.length > 0) {
        timing.droppedCalls = incrementCliTimingDrop(timing.droppedCalls, timing.commands.pop()!.calls);
        data = encode();
      }
      socket.send(data, Number(match[1]), "127.0.0.1", () => {
        try { socket.close(); } catch {}
      });
    } catch { try { socket.close(); } catch {} }
  };
}
