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
  "stopWarmCodexAppServer",
] as const;

test("Codex lifecycle hooks stay off assistant-runtime entrypoints", () => {
  for (const [entrypointName, entrypoint] of assistantRuntimeEntrypoints) {
    for (const hookName of codexLifecycleHookNames) {
      expect(Object.hasOwn(entrypoint, hookName), `${entrypointName} must not export ${hookName}`)
        .toBe(false);
    }
  }
});
