import { describe, expect, it } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { isRequestInputError, parseInput, RequestInputError, RequestBodyTooLargeError } from "../src/request-input.ts";
import { requireString } from "../src/parsers/assertions.ts";

describe("request input boundary", () => {
  it("identifies a body limit without inspecting its message", () => {
    const error = new RequestBodyTooLargeError(8);
    expect(error.message).toBe("Request body exceeded 8 bytes.");
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect(new RangeError(error.message)).not.toBeInstanceOf(RequestBodyTooLargeError);
    expect(() => parseInput(null, () => { throw error; })).toThrow(error);
  });

  it("returns the parser result unchanged and invokes it once", () => {
    const value = { ok: true };
    let calls = 0;
    expect(parseInput(value, (input) => {
      calls += 1;
      expect(input).toBe(value);
      return value;
    })).toBe(value);
    expect(calls).toBe(1);
  });

  it("translates only neutral validation failures and retains their cause", () => {
    const cause = new ContractValidationError("Invalid shape.");
    expect(() => parseInput(null, () => { throw cause; })).toThrowError(
      expect.objectContaining({ name: "RequestInputError", message: cause.message, cause }),
    );
    expect(() => parseInput(null, (value) => requireString(value, "input")))
      .toThrow(RequestInputError);
    expect(isRequestInputError(new RequestInputError("Invalid shape."))).toBe(true);
    expect(new RequestInputError("Invalid shape.")).not.toBeInstanceOf(TypeError);
    expect(isRequestInputError(cause)).toBe(false);
    expect(isRequestInputError({ name: "RequestInputError" })).toBe(false);
  });

  it.each([
    new TypeError("Parser bug"), new RangeError("Parser bug"),
    new ReferenceError("Parser bug"), new URIError("Parser bug"),
    new SyntaxError("Parser bug"), new Error("Parser bug"), null, "failure",
    new RequestInputError("Already rejected"),
  ])("rethrows other failures unchanged: %s", (failure) => {
    let caught: unknown = Symbol("not thrown");
    try {
      parseInput(null, () => { throw failure; });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });
});
