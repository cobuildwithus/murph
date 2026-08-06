import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedVeniceResponsesRequestBody,
  isAllowedHostedVeniceRequest,
} from "../src/runner-egress-venice.ts";

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

test("Venice egress keeps ordinary Responses tools and cache controls unchanged", () => {
  const standardInput = [
    {
      content: [{ text: "Ordinary developer input.", type: "input_text" }],
      role: "developer",
      type: "message",
    },
    {
      content: [{ text: "Hello.", type: "input_text" }],
      role: "user",
      type: "message",
    },
  ];
  const body = buildHostedVeniceResponsesRequestBody({
    body: encodeJson({
      input: standardInput,
      model: "gpt-5.6-terra",
      stream: true,
      tools: MURPH_NAMESPACE_TOOLS,
    }),
    pathnameSuffix: "/responses",
  });
  assert.ok(body);
  assert.deepEqual(JSON.parse(body), {
    input: standardInput,
    model:
      "openai-gpt-56-terra:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false",
    stream: true,
    tools: MURPH_NAMESPACE_TOOLS,
  });
});

test("Venice egress derives every priced provider model from the shared contract", () => {
  const cases = [
    ["gpt-5.6-luna", "openai-gpt-56-luna"],
    ["gpt-5.6-terra", "openai-gpt-56-terra"],
    ["gpt-5.6-sol", "openai-gpt-56-sol"],
  ] as const;

  for (const [productModel, providerModel] of cases) {
    const body = buildHostedVeniceResponsesRequestBody({
      body: encodeJson({ model: productModel }),
      pathnameSuffix: "/responses",
    });
    assert.ok(body);
    assert.equal(
      JSON.parse(body).model,
      `${providerModel}:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false`,
    );
  }
});

test("Venice egress restores Codex Responses Lite tools to the standard top-level field", () => {
  const standardInput = [
    {
      content: [{ text: "Stable base instructions.", type: "input_text" }],
      role: "developer",
      type: "message",
    },
    {
      content: [
        { text: "Stable workspace context.", type: "input_text" },
        { text: "Stable project instructions.", type: "input_text" },
      ],
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
      pathnameSuffix: "/responses",
    });
    assert.ok(body);
    assert.deepEqual(JSON.parse(body), {
      input: [
        {
          content: [{ text: "Stable base instructions.", type: "input_text" }],
          role: "developer",
          type: "message",
        },
        {
          role: "developer",
          type: "message",
          content: [
            { text: "Stable workspace context.", type: "input_text" },
            {
              prompt_cache_breakpoint: { mode: "explicit" },
              text: "Stable project instructions.",
              type: "input_text",
            },
          ],
        },
        {
          content: [{ text: "Show my connected apps.", type: "input_text" }],
          role: "user",
          type: "message",
        },
      ],
      model:
        "openai-gpt-56-terra:include_venice_system_prompt=false&enable_web_search=off&enable_web_scraping=false",
      parallel_tool_calls: false,
      stream: true,
      tool_choice: "auto",
      tools: MURPH_NAMESPACE_TOOLS,
    });
  }
});

test("Venice egress keeps the marked developer prefix stable when the conversation tail changes", () => {
  const build = (tail: string) => {
    const body = buildHostedVeniceResponsesRequestBody({
      body: encodeJson({
        input: [
          {
            role: "developer",
            tools: MURPH_NAMESPACE_TOOLS,
            type: "additional_tools",
          },
          {
            content: [{ text: "Stable base instructions.", type: "input_text" }],
            role: "developer",
            type: "message",
          },
          {
            content: [{ text: "Stable workspace context.", type: "input_text" }],
            role: "developer",
            type: "message",
          },
          {
            content: [{ text: tail, type: "input_text" }],
            role: "user",
            type: "message",
          },
        ],
        model: "gpt-5.6-sol",
        prompt_cache_key: "stable-session-key",
      }),
      pathnameSuffix: "/responses",
    });
    assert.ok(body);
    return JSON.parse(body) as {
      input: unknown[];
      prompt_cache_key: string;
      prompt_cache_options?: unknown;
    };
  };

  const first = build("First changing turn.");
  const second = build("Second changing turn.");
  assert.deepEqual(first.input.slice(0, 2), second.input.slice(0, 2));
  assert.notDeepEqual(first.input[2], second.input[2]);
  assert.equal(first.prompt_cache_key, "stable-session-key");
  assert.equal(second.prompt_cache_key, "stable-session-key");
  assert.equal(first.prompt_cache_options, undefined);
  assert.equal(second.prompt_cache_options, undefined);
  assert.deepEqual(first.input[1], {
    content: [{
      prompt_cache_breakpoint: { mode: "explicit" },
      text: "Stable workspace context.",
      type: "input_text",
    }],
    role: "developer",
    type: "message",
  });
});

test("Venice egress preserves caller-owned cache controls without adding a second breakpoint", () => {
  const callerBreakpoint = { mode: "explicit" };
  const input = [
    {
      role: "developer",
      tools: MURPH_NAMESPACE_TOOLS,
      type: "additional_tools",
    },
    {
      content: [{
        prompt_cache_breakpoint: callerBreakpoint,
        text: "Caller-marked stable instructions.",
        type: "input_text",
      }],
      role: "developer",
      type: "message",
    },
    {
      content: [{ text: "Additional developer context.", type: "input_text" }],
      role: "developer",
      type: "message",
    },
  ];
  const promptCacheOptions = { mode: "explicit", ttl: "30m" };
  const body = buildHostedVeniceResponsesRequestBody({
    body: encodeJson({
      input,
      model: "gpt-5.6-sol",
      prompt_cache_options: promptCacheOptions,
    }),
    pathnameSuffix: "/responses",
  });
  assert.ok(body);
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed.prompt_cache_options, promptCacheOptions);
  assert.deepEqual(parsed.input, input.slice(1));
});

test("Venice egress leaves compact-request caching unchanged", () => {
  const developerMessage = {
    content: [{ text: "Stable instructions.", type: "input_text" }],
    role: "developer",
    type: "message",
  };
  const body = buildHostedVeniceResponsesRequestBody({
    body: encodeJson({
      input: [
        {
          role: "developer",
          tools: MURPH_NAMESPACE_TOOLS,
          type: "additional_tools",
        },
        developerMessage,
      ],
      model: "gpt-5.6-sol",
    }),
    pathnameSuffix: "/responses/compact",
  });
  assert.ok(body);
  assert.deepEqual(JSON.parse(body).input, [developerMessage]);
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
      pathnameSuffix: "/responses",
    }), null, label);
  }
});

test("Venice egress fails closed for unknown product models", () => {
  assert.equal(buildHostedVeniceResponsesRequestBody({
    body: encodeJson({ model: "other" }),
    pathnameSuffix: "/responses",
  }), null);
});

test("Venice egress rejects unknown endpoint paths", () => {
  assert.equal(buildHostedVeniceResponsesRequestBody({
    body: encodeJson({ model: "gpt-5.6-sol" }),
    pathnameSuffix: "/chat/completions",
  }), null);
});

test("Venice egress admits only Codex Responses POST endpoints", () => {
  assert.equal(isAllowedHostedVeniceRequest("POST", "/responses"), true);
  assert.equal(isAllowedHostedVeniceRequest("POST", "/responses/compact"), true);
  assert.equal(isAllowedHostedVeniceRequest("GET", "/responses"), false);
  assert.equal(isAllowedHostedVeniceRequest("POST", "/chat/completions"), false);
});
