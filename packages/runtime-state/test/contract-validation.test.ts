import { expect, it } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { parseHostedExecutionBundleRef } from "../src/hosted-bundle-ref.ts";

it("keeps parser validation neutral until the request boundary translates it", () => {
  expect(() => parseHostedExecutionBundleRef({})).toThrow(ContractValidationError);
  expect(() => parseInput({}, parseHostedExecutionBundleRef)).toThrow(RequestInputError);
  expect(() => parseInput({}, parseHostedExecutionBundleRef)).toThrow(
    expect.objectContaining({ cause: expect.any(ContractValidationError) }),
  );
});
