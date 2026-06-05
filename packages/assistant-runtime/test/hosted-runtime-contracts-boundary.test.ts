import { expect, test } from "vitest";

import * as assistantRuntime from "@murphai/assistant-runtime";
import * as hostedRuntimeContracts from "@murphai/assistant-runtime/hosted-runtime-contracts";
import * as hostedRuntimeWorkerContracts from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

const assistantRuntimeEntrypoints: ReadonlyArray<[string, object]> = [
  ["@murphai/assistant-runtime", assistantRuntime],
  ["@murphai/assistant-runtime/hosted-runtime-contracts", hostedRuntimeContracts],
  ["@murphai/assistant-runtime/hosted-runtime-worker-contracts", hostedRuntimeWorkerContracts],
];

const codexLifecycleHookNames = [
  "snapshotExpectedCodexRootProcess",
  "stopWarmCodexAppServer",
] as const;

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type RootHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime").HostedExpectedCodexRootProcess;

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type ContractsHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime/hosted-runtime-contracts").HostedExpectedCodexRootProcess;

// @ts-expect-error HostedExpectedCodexRootProcess must stay on @murphai/hosted-execution/runtime-control.
type WorkerContractsHostedExpectedCodexRootProcess = import("@murphai/assistant-runtime/hosted-runtime-worker-contracts").HostedExpectedCodexRootProcess;

test("HostedExpectedCodexRootProcess stays off assistant-runtime entrypoints", () => {
  // The architecture assertion is enforced by the @ts-expect-error sentinels above.
});

test("Codex lifecycle hooks stay off assistant-runtime entrypoints", () => {
  for (const [entrypointName, entrypoint] of assistantRuntimeEntrypoints) {
    for (const hookName of codexLifecycleHookNames) {
      expect(Object.hasOwn(entrypoint, hookName), `${entrypointName} must not export ${hookName}`)
        .toBe(false);
    }
  }
});
