import {
  buildHostedExecutionDispatchFromWake,
  buildHostedExecutionWakeFromDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

export interface HostedDispatchEnvelope {
  dispatch?: HostedExecutionDispatchRequest;
  wake?: HostedExecutionWake;
}

type HostedDispatchSubject =
  | HostedExecutionDispatchRequest
  | HostedExecutionWake
  | HostedDispatchEnvelope;

export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

export function resolveHostedDispatch(
  subject: HostedDispatchSubject,
): HostedExecutionDispatchRequest {
  if ("event" in subject) {
    return subject;
  }

  if ("kind" in subject) {
    return buildHostedExecutionDispatchFromWake(subject);
  }

  if (subject.dispatch) {
    return subject.dispatch;
  }

  if (subject.wake) {
    return buildHostedExecutionDispatchFromWake(subject.wake);
  }

  throw new TypeError("Hosted dispatch input must include dispatch or wake.");
}

export function resolveHostedWake(
  subject: HostedDispatchSubject,
): HostedExecutionWake {
  if ("kind" in subject) {
    return subject;
  }

  if ("event" in subject) {
    return buildHostedExecutionWakeFromDispatch(subject);
  }

  if (subject.wake) {
    return subject.wake;
  }

  if (subject.dispatch) {
    return buildHostedExecutionWakeFromDispatch(subject.dispatch);
  }

  throw new TypeError("Hosted dispatch input must include dispatch or wake.");
}
