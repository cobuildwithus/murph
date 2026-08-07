export class HostedAssistantAskCompletionPreemptedError extends Error {
  readonly code = "ASSISTANT_ASK_COMPLETION_PREEMPTED";

  constructor(options?: ErrorOptions) {
    super("Assistant ask completion yielded to foreground input.", options);
    this.name = "HostedAssistantAskCompletionPreemptedError";
  }
}

export function isHostedAssistantAskCompletionPreemptedError(
  error: unknown,
): error is HostedAssistantAskCompletionPreemptedError {
  return error instanceof HostedAssistantAskCompletionPreemptedError;
}
