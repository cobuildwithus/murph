import assert from "node:assert/strict";
import { test } from "vitest";
import { buildProviderApiError } from "../src/providers/provider-api-error.ts";

test("Junction API failures retain status and retry policy without raw bodies", () => {
  const error = buildProviderApiError("JUNCTION_API_FAILED", "Request failed.", new Response(null, { status: 429 }), '{"private":"synthetic-private-body"}');
  assert.equal(error.httpStatus, 429);
  assert.equal(error.retryable, true);
  assert.equal(error.details?.status, 429);
  assert.equal(JSON.stringify(error.details).includes("synthetic-private-body"), false);
});
