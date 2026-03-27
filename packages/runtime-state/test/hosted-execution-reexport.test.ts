import { describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_DISPATCH_PATH as hostedExecutionDispatchPath,
  HOSTED_EXECUTION_SIGNATURE_HEADER as hostedExecutionSignatureHeader,
  HOSTED_EXECUTION_TIMESTAMP_HEADER as hostedExecutionTimestampHeader,
  buildHostedExecutionUserRunPath as buildHostedExecutionUserRunPathFromHostedExecution,
} from "@healthybob/hosted-execution";
import {
  HOSTED_EXECUTION_DISPATCH_PATH as runtimeStateDispatchPath,
  HOSTED_EXECUTION_SIGNATURE_HEADER as runtimeStateSignatureHeader,
  HOSTED_EXECUTION_TIMESTAMP_HEADER as runtimeStateTimestampHeader,
  buildHostedExecutionUserRunPath as buildHostedExecutionUserRunPathFromRuntimeState,
} from "@healthybob/runtime-state";

describe("@healthybob/runtime-state hosted-execution compatibility", () => {
  it("re-exports hosted execution runtime helpers and constants", () => {
    expect(runtimeStateSignatureHeader).toBe(hostedExecutionSignatureHeader);
    expect(runtimeStateTimestampHeader).toBe(hostedExecutionTimestampHeader);
    expect(runtimeStateDispatchPath).toBe(hostedExecutionDispatchPath);
    expect(buildHostedExecutionUserRunPathFromRuntimeState("member/123")).toBe(
      buildHostedExecutionUserRunPathFromHostedExecution("member/123"),
    );
    expect(buildHostedExecutionUserRunPathFromRuntimeState("member/123")).toBe(
      "/internal/users/member%2F123/run",
    );
  });
});
