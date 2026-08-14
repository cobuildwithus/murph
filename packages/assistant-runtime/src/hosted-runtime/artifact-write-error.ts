export class HostedRuntimeArtifactWriteError extends Error {
  readonly retryable: boolean;

  constructor(input: { cause: unknown; retryable: boolean }) {
    super(
      input.cause instanceof Error
        ? input.cause.message
        : "Hosted runtime artifact write failed.",
      { cause: input.cause },
    );
    this.name = "HostedRuntimeArtifactWriteError";
    this.retryable = input.retryable;
  }
}
