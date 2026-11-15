import * as observability from "@murphai/hosted-execution";
import { describe, expect, it, vi } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { parseJsonInput, readJsonObject, readOptionalJsonObject } from "../src/json.ts";
import { classifyPublicRouteError, mapWorkerRouteError } from "../src/worker/errors.ts";

describe("public route errors", () => {
  it("preserves explicit input rejections", () => {
    expect(classifyPublicRouteError(new RequestInputError("Invalid shape.")))
      .toEqual({ error: "Invalid request.", status: 400 });
    expect(classifyPublicRouteError(new RequestBodyTooLargeError(8)))
      .toEqual({ error: "Invalid request.", status: 400 });
  });

  it.each([
    new ContractValidationError("Invalid shape."), new TypeError("Invalid shape."),
    new RangeError("Invalid shape."), new URIError("Invalid shape."),
    new SyntaxError(), new ReferenceError(),
  ])("treats an unmarked error as a server failure: %s", error => {
    expect(classifyPublicRouteError(error)).toEqual({ error: "Internal error.", status: 500 });
  });

  it("preserves Invalid JSON only when the reader rejects JSON bytes", () => {
    expect(() => parseJsonInput("{")).toThrow(RequestInputError);
    try { parseJsonInput("{"); } catch (error) {
      expect(classifyPublicRouteError(error)).toEqual({ error: "Invalid JSON.", status: 400 });
    }
  });

  it.each([readJsonObject, readOptionalJsonObject])("marks JSON object reader input failures", async read => {
    for (const [body, message] of [["{", "Invalid JSON."], ["[]", "Invalid request."]]) {
      const error = await read(new Request("https://example.test/input", { method: "POST", body }))
        .then(() => { throw new Error("Expected rejection."); }, error => error);
      expect(classifyPublicRouteError(error)).toEqual({ error: message, status: 400 });
    }
  });
});

it.each([new ContractValidationError("Synthetic validation failure."), new TypeError("Synthetic bug.")])("logs unmarked validation distinctly: %s", error => {
  const log = vi.spyOn(observability, "emitHostedExecutionStructuredLog");
  try {
    expect(mapWorkerRouteError(new Request("https://example.test/input"), error).status).toBe(500);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ error, level: "error" }));
    expect(observability.readHostedExecutionSafeErrorName(error)).toBe(error.name);
  } finally { log.mockRestore(); }
});
