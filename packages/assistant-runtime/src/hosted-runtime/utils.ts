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
