import { describe, expect, it } from "vitest";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { classifyPublicRouteError } from "../src/worker/errors.ts";

describe("public route errors", () => {
  it.each([
    new RequestInputError("Invalid shape."), new TypeError("Invalid shape."),
    new RangeError("Invalid shape."), new URIError("Invalid shape."),
  ])("preserves the invalid-request envelope for %s", (error) => {
    expect(classifyPublicRouteError(error)).toEqual({ error: "Invalid request.", status: 400 });
  });

  it("preserves JSON and server failure classification", () => {
    expect(classifyPublicRouteError(new SyntaxError())).toEqual({ error: "Invalid JSON.", status: 400 });
    expect(classifyPublicRouteError(new ReferenceError())).toEqual({ error: "Internal error.", status: 500 });
  });
});
