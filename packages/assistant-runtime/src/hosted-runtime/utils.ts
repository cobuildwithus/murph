import {
  createRuntimeTimerSyntheticWake,
  type HostedRuntimeEvent,
  type HostedRuntimeDrainRequest,
} from "@murphai/hosted-execution";

export interface HostedWakeEnvelope {
  wake?: HostedRuntimeEvent;
  runDrain?: HostedRuntimeDrainRequest | null;
}

type HostedWakeSubject = HostedRuntimeEvent | HostedWakeEnvelope;

export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

export function resolveHostedWake(
  subject: HostedWakeSubject,
): HostedRuntimeEvent {
  if ("kind" in subject) {
    return subject;
  }

  if (subject.wake) {
    return subject.wake;
  }

  if (subject.runDrain) {
    const [firstEvent] = subject.runDrain.events;
    return firstEvent?.wake ?? createRuntimeTimerSyntheticWake(subject.runDrain);
  }

  throw new TypeError("Hosted wake input must include wake or runDrain.");
}

export function computeHostedRunElapsedMs(
  run: { startedAt?: string | null } | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}
