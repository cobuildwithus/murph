import { expect, it } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { parseHostedExecutionDeviceSyncRuntimeApplyRequest } from "../src/hosted-runtime.ts";

it("keeps parser validation neutral until the request boundary translates it", () => {
  expect(() => parseHostedExecutionDeviceSyncRuntimeApplyRequest(null)).toThrow(ContractValidationError);
  expect(() => parseInput(null, parseHostedExecutionDeviceSyncRuntimeApplyRequest)).toThrow(RequestInputError);
  expect(() => parseInput(null, parseHostedExecutionDeviceSyncRuntimeApplyRequest)).toThrow(
    expect.objectContaining({ cause: expect.any(ContractValidationError) }),
  );
});
