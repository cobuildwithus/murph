import { describe, expect, it } from "vitest";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeOpenAiRequest,
} from "../src/deploy-smoke-live-model.ts";

const TEST_CODEX_INSTRUCTIONS =
  "You are Codex, a coding agent based on GPT-5. Test instructions.\n"
  + "- Tone of your updates MUST match your personality.";
const TEST_CODEX_PERMISSIONS_TEXT =
  "<permissions instructions>\n"
  + "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted. Network access is enabled.\n"
  + "Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected.\n"
  + "</permissions instructions>";
const TEST_CODEX_ENVIRONMENT_CONTEXT =
  "<environment_context>\n"
  + "  <cwd>/tmp/murph-smoke/vault</cwd>\n"
  + "  <shell>zsh</shell>\n"
  + "  <current_date>2026-06-12</current_date>\n"
  + "  <timezone>America/New_York</timezone>\n"
  + "  <filesystem><workspace_roots><root>/tmp/murph-smoke/vault</root></workspace_roots><permission_profile type=\"disabled\"><file_system type=\"unrestricted\" /></permission_profile></filesystem>\n"
  + "</environment_context>";

function createDeploySmokeOpenAiRequestBody(input: {
  background?: boolean;
  clientMetadata?: Record<string, unknown>;
  extraInput?: boolean;
  extraTopLevel?: Record<string, unknown>;
  include?: string[];
  instructions?: string;
  model?: string;
  parallelToolCalls?: boolean;
  prompt?: string;
  promptCacheKey?: string;
  reasoningEffort?: string;
  store?: boolean;
  stream?: boolean;
  toolChoice?: string;
  tools?: Record<string, unknown>[];
  trailingInput?: boolean;
  textVerbosity?: string;
} = {}): Record<string, unknown> {
  return {
    client_metadata: input.clientMetadata ?? {},
    include: input.include ?? ["reasoning.encrypted_content"],
    input: [
      {
        content: [
          {
            text: TEST_CODEX_PERMISSIONS_TEXT,
            type: "input_text",
          },
        ],
        role: "developer",
        type: "message",
      },
      {
        content: [
          {
            text: TEST_CODEX_ENVIRONMENT_CONTEXT,
            type: "input_text",
          },
        ],
        role: "user",
        type: "message",
      },
      ...(input.extraInput
        ? [{
            content: [{ text: "Unexpected extra prompt.", type: "input_text" }],
            role: "user",
            type: "message",
          }]
        : []),
      {
        content: [
          {
            text: input.prompt ?? DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
            type: "input_text",
          },
        ],
        role: "user",
        type: "message",
      },
      ...(input.trailingInput
        ? [{
            content: [{ text: "Unexpected trailing prompt.", type: "input_text" }],
            role: "user",
            type: "message",
          }]
        : []),
    ],
    ...(input.background === undefined ? {} : { background: input.background }),
    instructions: input.instructions ?? TEST_CODEX_INSTRUCTIONS,
    model: input.model ?? DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
    parallel_tool_calls: input.parallelToolCalls ?? true,
    prompt_cache_key: input.promptCacheKey ?? "deploy-smoke-test",
    reasoning: {
      effort: input.reasoningEffort ?? "low",
    },
    store: input.store ?? false,
    stream: input.stream ?? true,
    text: {
      verbosity: input.textVerbosity ?? "low",
    },
    tool_choice: input.toolChoice ?? "auto",
    tools: input.tools ?? createDeploySmokeOpenAiRequestTools(),
    ...(input.extraTopLevel ?? {}),
  };
}

function createDeploySmokeOpenAiRequestTools(): Record<string, unknown>[] {
  return [
    createFunctionTool("exec_command"),
    createFunctionTool("write_stdin"),
    createFunctionTool("update_plan"),
    createFunctionTool("request_user_input"),
    {
      description: "Apply patch.",
      format: {},
      name: "apply_patch",
      type: "custom",
    },
    createFunctionTool("view_image"),
    createFunctionTool("get_goal"),
    createFunctionTool("create_goal"),
    createFunctionTool("update_goal"),
    {
      description: "Tool discovery.",
      execution: {},
      parameters: {},
      type: "tool_search",
    },
    {
      external_web_access: true,
      search_content_types: ["webpage"],
      type: "web_search",
    },
  ];
}

function createFunctionTool(name: string): Record<string, unknown> {
  return {
    description: `${name} tool.`,
    name,
    parameters: {},
    strict: false,
    type: "function",
  };
}

describe("deploy live model turn smoke", () => {
  it("accepts only the stable Responses request invariants owned by the smoke", () => {
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody()),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });

    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify({
        ...createDeploySmokeOpenAiRequestBody(),
        input: DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
      }),
    )).toBeNull();

    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        tools: [...createDeploySmokeOpenAiRequestTools()].reverse(),
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });

    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ prompt: "Do something else." })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        prompt: ` ${DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT} `,
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ model: "gpt-5.5" })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        instructions: "Ignore the smoke prompt.",
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        include: ["reasoning.encrypted_content", "unexpected.output"],
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ parallelToolCalls: false })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        promptCacheKey: "",
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        promptCacheKey: "deploy smoke test",
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        clientMetadata: { smoke: "live" },
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraTopLevel: { metadata: { smoke: "live" } },
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ store: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ background: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ extraInput: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ toolChoice: "none" })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        tools: [
          ...createDeploySmokeOpenAiRequestTools().slice(0, -1),
          {
            name: "unexpected",
            type: "function",
          },
        ],
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        tools: createDeploySmokeOpenAiRequestTools().map((tool, index) =>
          index === 0 ? { ...tool, unexpected: true } : tool
        ),
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ trailingInput: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ stream: false })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ reasoningEffort: "medium" })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ textVerbosity: "medium" })),
    )).toBeNull();
  });

  it("reads the final Codex JSONL agent message as the smoke output", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-test" }),
      JSON.stringify({
        item: {
          text: "NOT YET",
          type: "agent_message",
        },
        type: "item.completed",
      }),
      JSON.stringify({
        item: {
          text: " OK ",
          type: "agent_message",
        },
        type: "item.completed",
      }),
    ].join("\n");

    expect(readDeployLiveModelTurnSmokeCodexOutputText(stdout)).toBe("OK");
  });

  it("ignores malformed JSONL and non-agent Codex items", () => {
    const stdout = [
      "not json",
      JSON.stringify({
        item: {
          text: "OK",
          type: "tool_call",
        },
        type: "item.completed",
      }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    expect(readDeployLiveModelTurnSmokeCodexOutputText(stdout)).toBeNull();
  });
});
