import type { HostedExecutionWake } from "@murphai/hosted-execution";

export interface HostedWakeEnvelope {
  wake?: HostedExecutionWake;
}

type HostedWakeSubject = HostedExecutionWake | HostedWakeEnvelope;

export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

export function resolveHostedWake(
  subject: HostedWakeSubject,
): HostedExecutionWake {
  if ("kind" in subject) {
    return subject;
  }

  if (subject.wake) {
    return subject.wake;
  }

  throw new TypeError("Hosted wake input must include wake.");
}
