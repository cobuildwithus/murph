import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  class MockWorkflowNotFoundError extends Error {}
  const close = vi.fn(async () => undefined);
  const connection = { close, kind: "connection" };
  const terminate = vi.fn(async () => undefined);
  const getHandle = vi.fn(() => ({ terminate }));

  return {
    clientConstructor: vi.fn(function Client(
      this: { options?: unknown; workflow?: unknown },
      options: unknown,
    ) {
      this.options = options;
      this.workflow = { getHandle };
    }),
    close,
    connect: vi.fn(async () => connection),
    connection,
    getHandle,
    terminate,
    WorkflowNotFoundError: MockWorkflowNotFoundError,
  };
});

vi.mock("@temporalio/client", () => ({
  Client: mocks.clientConstructor,
  Connection: {
    connect: mocks.connect,
  },
  WorkflowNotFoundError: mocks.WorkflowNotFoundError,
}));

import {
  HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS,
  terminateHostedUserRuntimeWorkflowBestEffort,
} from "@/src/lib/hosted-orchestration/workflow-termination";

describe("hosted runtime workflow termination", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.close.mockReset();
    mocks.close.mockResolvedValue(undefined);
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue(mocks.connection);
    mocks.clientConstructor.mockClear();
    mocks.getHandle.mockClear();
    mocks.terminate.mockReset();
    mocks.terminate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips termination when Temporal is not configured", async () => {
    await expect(terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: "member_test",
    })).resolves.toEqual({
      configured: false,
      errorCode: null,
      notFound: null,
      terminated: false,
    });

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.getHandle).not.toHaveBeenCalled();
  });

  it("terminates the per-user workflow with a bounded reason", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    vi.stubEnv("HOSTED_TEMPORAL_NAMESPACE", "hosted-runtime");

    await expect(terminateHostedUserRuntimeWorkflowBestEffort({
      reason: " account-deleted ",
      userId: "member_test",
    })).resolves.toEqual({
      configured: true,
      errorCode: null,
      notFound: false,
      terminated: true,
    });

    expect(mocks.connect).toHaveBeenCalledWith({
      address: "temporal.example.test:7233",
      connectTimeout: HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS,
      tls: false,
    });
    expect(mocks.clientConstructor).toHaveBeenCalledWith({
      connection: mocks.connection,
      namespace: "hosted-runtime",
    });
    expect(mocks.getHandle).toHaveBeenCalledWith("hosted-user-runtime:member_test");
    expect(mocks.terminate).toHaveBeenCalledWith("account-deleted");
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("treats an already-missing workflow as a successful cleanup", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    mocks.terminate.mockRejectedValue(new mocks.WorkflowNotFoundError(
      "workflow missing",
    ));

    await expect(terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: "member_test",
    })).resolves.toEqual({
      configured: true,
      errorCode: null,
      notFound: true,
      terminated: true,
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("does not block the best-effort result on connection close", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    mocks.close.mockReturnValue(new Promise(() => undefined));

    await expect(terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: "member_test",
    })).resolves.toEqual({
      configured: true,
      errorCode: null,
      notFound: false,
      terminated: true,
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("reports termination failures without throwing from the best-effort path", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error(
      "transport unavailable for hosted-user-runtime:member_test user member_test account-deleted",
    );
    error.name = "TemporalTransportError";
    mocks.terminate.mockRejectedValue(error);

    try {
      await expect(terminateHostedUserRuntimeWorkflowBestEffort({
        reason: "account-deleted",
        userId: "member_test",
      })).resolves.toEqual({
        configured: true,
        errorCode: "TemporalTransportError",
        notFound: null,
        terminated: false,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted runtime workflow termination failed.",
        expect.objectContaining({
          errorCode: "TemporalTransportError",
          errorMessage:
            "transport unavailable for hosted-user-runtime:<redacted-id> user member_<redacted-id> account-deleted",
          operationMessage: "Hosted runtime workflow termination failed.",
        }),
      );
      const loggedMessage = JSON.stringify(consoleError.mock.calls[0]?.[1]);
      expect(loggedMessage).not.toContain("hosted-user-runtime:member_test");
      expect(loggedMessage).not.toContain("member_test");
      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("redacts unsafe failure names before logging or returning them", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("transport unavailable");
    error.name = "hosted-user-runtime:member_test account-deleted";
    mocks.terminate.mockRejectedValue(error);

    try {
      await expect(terminateHostedUserRuntimeWorkflowBestEffort({
        reason: "account-deleted",
        userId: "member_test",
      })).resolves.toEqual({
        configured: true,
        errorCode: "UnknownError",
        notFound: null,
        terminated: false,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted runtime workflow termination failed.",
        expect.objectContaining({
          errorCode: "UnknownError",
          errorMessage: "transport unavailable",
          operationMessage: "Hosted runtime workflow termination failed.",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("times out when Temporal connect does not resolve", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    mocks.connect.mockReturnValue(new Promise(() => undefined));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = terminateHostedUserRuntimeWorkflowBestEffort({
        reason: "account-deleted",
        userId: "member_test",
      });
      await vi.advanceTimersByTimeAsync(HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS);

      await expect(result).resolves.toEqual({
        configured: true,
        errorCode: "HostedRuntimeWorkflowTerminationTimeoutError",
        notFound: null,
        terminated: false,
      });
      expect(mocks.clientConstructor).not.toHaveBeenCalled();
      expect(mocks.close).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted runtime workflow termination failed.",
        expect.objectContaining({
          errorCode: "HostedRuntimeWorkflowTerminationTimeoutError",
          errorMessage: "Hosted runtime workflow termination timed out.",
          operationMessage: "Hosted runtime workflow termination failed.",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("closes a connection that resolves after the termination timeout wins", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const connectResolver: {
      current?: (connection: typeof mocks.connection) => void;
    } = {};
    mocks.connect.mockReturnValue(new Promise((resolve) => {
      connectResolver.current = resolve;
    }));

    try {
      const result = terminateHostedUserRuntimeWorkflowBestEffort({
        reason: "account-deleted",
        userId: "member_test",
      });
      await vi.advanceTimersByTimeAsync(HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS);

      await expect(result).resolves.toEqual({
        configured: true,
        errorCode: "HostedRuntimeWorkflowTerminationTimeoutError",
        notFound: null,
        terminated: false,
      });
      expect(mocks.close).not.toHaveBeenCalled();

      if (!connectResolver.current) {
        throw new Error("Connection resolver was not captured.");
      }
      connectResolver.current(mocks.connection);
      await Promise.resolve();

      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("times out and closes the connection when Temporal terminate does not resolve", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    mocks.terminate.mockReturnValue(new Promise(() => undefined));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = terminateHostedUserRuntimeWorkflowBestEffort({
        reason: "account-deleted",
        userId: "member_test",
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS);

      await expect(result).resolves.toEqual({
        configured: true,
        errorCode: "HostedRuntimeWorkflowTerminationTimeoutError",
        notFound: null,
        terminated: false,
      });
      expect(mocks.close).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted runtime workflow termination failed.",
        expect.objectContaining({
          errorCode: "HostedRuntimeWorkflowTerminationTimeoutError",
          errorMessage: "Hosted runtime workflow termination timed out.",
          operationMessage: "Hosted runtime workflow termination failed.",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
