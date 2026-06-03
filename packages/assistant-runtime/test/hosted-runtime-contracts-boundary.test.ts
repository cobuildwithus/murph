import { test } from "vitest";

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type RootHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime").HostedExpectedCodexRootProcess;

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type ContractsHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime/hosted-runtime-contracts").HostedExpectedCodexRootProcess;

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type WorkerContractsHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime/hosted-runtime-worker-contracts").HostedExpectedCodexRootProcess;

test("HostedExpectedCodexRootProcess stays off assistant-runtime entrypoints", () => {
  // The architecture assertion is enforced by the @ts-expect-error sentinels above.
});
