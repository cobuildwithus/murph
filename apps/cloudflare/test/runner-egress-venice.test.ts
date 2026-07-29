import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedVeniceResponsesRequestBody,
  isAllowedHostedVeniceRequest,
} from "../src/runner-egress-venice.ts";

const MODEL_ENV = {
  HOSTED_VENICE_LUNA_MODEL: "qwen3-4b",
  HOSTED_VENICE_TERRA_MODEL: "zai-org-glm-4.7",
  HOSTED_VENICE_SOL_MODEL: "qwen3-vl-235b-a22b",
};

function encodeJson(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

test("Venice egress keeps Murph product models and rewrites only the upstream model id", () => {
  const body = buildHostedVeniceResponsesRequestBody({
    body: encodeJson({
      input: "hello",
      model: "gpt-5.6-terra",
      stream: true,
    }),
    env: MODEL_ENV,
  });
  assert.ok(body);
  assert.deepEqual(JSON.parse(body), {
    input: "hello",
    model:
      "zai-org-glm-4.7:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false",
    stream: true,
  });
});

test("Venice egress fails closed for unknown product models and missing mappings", () => {
  assert.equal(buildHostedVeniceResponsesRequestBody({
    body: encodeJson({ model: "other" }),
    env: MODEL_ENV,
  }), null);
  assert.throws(() => buildHostedVeniceResponsesRequestBody({
    body: encodeJson({ model: "gpt-5.6-sol" }),
    env: {},
  }), /HOSTED_VENICE_SOL_MODEL/u);
});

test("Venice egress admits only Codex Responses POST endpoints", () => {
  assert.equal(isAllowedHostedVeniceRequest("POST", "/responses"), true);
  assert.equal(isAllowedHostedVeniceRequest("POST", "/responses/compact"), true);
  assert.equal(isAllowedHostedVeniceRequest("GET", "/responses"), false);
  assert.equal(isAllowedHostedVeniceRequest("POST", "/chat/completions"), false);
});
