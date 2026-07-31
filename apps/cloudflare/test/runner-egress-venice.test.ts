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
const MURPH_NAMESPACE_TOOLS = [{
  name: "murph",
  tools: [
    { name: "connected_apps_manage" },
    { name: "send_progress_update" },
  ],
  type: "namespace",
}];

function encodeJson(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

test("Venice egress keeps ordinary Responses tools and rewrites only the upstream model id", () => {
  const standardInput = [{
    content: [{ text: "Hello.", type: "input_text" }],
    role: "user",
    type: "message",
  }];
  const body = buildHostedVeniceResponsesRequestBody({
    body: encodeJson({
      input: standardInput,
      model: "gpt-5.6-terra",
      stream: true,
      tools: MURPH_NAMESPACE_TOOLS,
    }),
    env: MODEL_ENV,
  });
  assert.ok(body);
  assert.deepEqual(JSON.parse(body), {
    input: standardInput,
    model:
      "zai-org-glm-4.7:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false",
    stream: true,
    tools: MURPH_NAMESPACE_TOOLS,
  });
});

test("Venice egress restores Codex Responses Lite tools to the standard top-level field", () => {
  const standardInput = [
    {
      content: [{ text: "Use the Murph tools when needed.", type: "input_text" }],
      role: "developer",
      type: "message",
    },
    {
      content: [{ text: "Show my connected apps.", type: "input_text" }],
      role: "user",
      type: "message",
    },
  ];
  for (const topLevelTools of [undefined, null] as const) {
    const body = buildHostedVeniceResponsesRequestBody({
      body: encodeJson({
        input: [
          {
            role: "developer",
            tools: MURPH_NAMESPACE_TOOLS,
            type: "additional_tools",
          },
          ...standardInput,
        ],
        model: "gpt-5.6-terra",
        parallel_tool_calls: false,
        stream: true,
        tool_choice: "auto",
        tools: topLevelTools,
      }),
      env: MODEL_ENV,
    });
    assert.ok(body);
    assert.deepEqual(JSON.parse(body), {
      input: standardInput,
      model:
        "zai-org-glm-4.7:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false",
      parallel_tool_calls: false,
      stream: true,
      tool_choice: "auto",
      tools: MURPH_NAMESPACE_TOOLS,
    });
  }
});

test("Venice egress fails closed for malformed or conflicting Responses Lite tools", () => {
  const additionalTools = {
    role: "developer",
    tools: MURPH_NAMESPACE_TOOLS,
    type: "additional_tools",
  };
  const invalidRequests = [
    {
      input: [additionalTools],
      label: "populated top-level tools",
      tools: MURPH_NAMESPACE_TOOLS,
    },
    {
      input: [additionalTools, additionalTools],
      label: "multiple additional_tools items",
      tools: null,
    },
    {
      input: [{ ...additionalTools, tools: { type: "namespace" } }],
      label: "non-array additional tools",
      tools: null,
    },
    {
      input: [{ ...additionalTools, role: "user" }],
      label: "non-developer additional tools",
      tools: null,
    },
    {
      input: [{ ...additionalTools, id: "item_123" }],
      label: "identified additional_tools item",
      tools: null,
    },
    {
      input: [{ ...additionalTools, scope: "turn" }],
      label: "unknown additional_tools metadata",
      tools: null,
    },
    {
      input: [{ ...additionalTools, tools: ["murph"] }],
      label: "non-object tool definition",
      tools: null,
    },
  ];

  for (const { label, ...request } of invalidRequests) {
    assert.equal(buildHostedVeniceResponsesRequestBody({
      body: encodeJson({
        ...request,
        model: "gpt-5.6-terra",
      }),
      env: MODEL_ENV,
    }), null, label);
  }
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
