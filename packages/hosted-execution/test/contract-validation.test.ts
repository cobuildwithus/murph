import { expect, it } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError } from "../src/request-input.ts";
import { parseHostedClinicalRecordsIdentifier } from "../src/clinical-records-boundary.ts";

it("keeps parser validation neutral until the request boundary translates it", () => {
  expect(() => parseHostedClinicalRecordsIdentifier(null)).toThrow(ContractValidationError);
  expect(() => parseInput(null, parseHostedClinicalRecordsIdentifier)).toThrow(RequestInputError);
  expect(() => parseInput(null, parseHostedClinicalRecordsIdentifier)).toThrow(
    expect.objectContaining({ cause: expect.any(ContractValidationError) }),
  );
});
