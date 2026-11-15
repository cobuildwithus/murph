import { describe, expect, it } from "vitest";
import { ContractValidationError, getErrorName } from "../src/validation-error.ts";

describe("semantic error names", () => {
  it.each([
    [new ContractValidationError("Invalid value."), "ContractValidationError"],
    [new TypeError("Invalid value."), "TypeError"],
    [new Error("Invalid value."), "Error"],
  ])("preserves the meaning of %s", (error, name) => {
    expect(getErrorName(error)).toBe(name);
  });

  it("does not depend on the migration base or name", () => {
    const prototype = Object.getPrototypeOf(ContractValidationError.prototype);
    const error = new ContractValidationError("Invalid value.");
    Object.defineProperty(error, "name", { value: "ContractValidationError" });
    try {
      Object.setPrototypeOf(ContractValidationError.prototype, Error.prototype);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(getErrorName(error)).toBe("ContractValidationError");
    } finally {
      Object.setPrototypeOf(ContractValidationError.prototype, prototype);
    }
  });
});
