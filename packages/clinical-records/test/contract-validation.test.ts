import { expect, it } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { countClinicalFhirPageResources } from "../src/index.ts";

it("keeps parser validation neutral until the request boundary translates it", () => {
  expect(() => countClinicalFhirPageResources("{")).toThrow(ContractValidationError);
  expect(() => parseInput("{", (value) => countClinicalFhirPageResources(String(value)))).toThrow(RequestInputError);
  expect(() => parseInput("{", (value) => countClinicalFhirPageResources(String(value)))).toThrow(
    expect.objectContaining({ cause: expect.any(ContractValidationError) }),
  );
});
