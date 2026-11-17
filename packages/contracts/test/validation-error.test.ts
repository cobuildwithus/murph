import { describe, expect, it } from "vitest";
import { ContractValidationError } from "../src/validation-error.ts";

describe("contract validation errors", () => {
  it("reports its own identity without a native error base", () => {
    const cause = new Error("Synthetic cause.");
    const error = new ContractValidationError("Invalid value.", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.name).toBe("ContractValidationError");
    expect(error.constructor.name).toBe("ContractValidationError");
    expect(error.message).toBe("Invalid value.");
    expect(error.cause).toBe(cause);
  });
});
