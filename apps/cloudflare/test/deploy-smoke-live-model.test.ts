import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeOpenAiRequest,
} from "../src/deploy-smoke-live-model.ts";
import {
  HOSTED_DEPLOY_SMOKE_OPENAI_REQUEST_MAX_BODY_BYTES,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-egress-intercept.ts";

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
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const pinnedCodexBin = path.join(
  repoRoot,
  "packages/assistant-engine/node_modules/.bin/codex",
);

interface CapturedPinnedCodexSmokeOpenAiRequest {
  authorization: string | null;
  method: string;
  pathname: string;
  rawBody: string;
  rawBodyByteLength: number;
  stdout: string;
}

function createDeploySmokeOpenAiRequestBody(input: {
  background?: boolean;
  clientMetadata?: Record<string, unknown>;
  extraInput?: boolean;
  extraReasoning?: Record<string, unknown>;
  extraText?: Record<string, unknown>;
  extraTopLevel?: Record<string, unknown>;
  include?: string[];
  instructions?: string;
  maxOutputTokens?: number;
  model?: string;
  parallelToolCalls?: boolean;
  prompt?: string;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  reasoningEffort?: string;
  store?: boolean;
  stream?: boolean;
  toolChoice?: string;
  tools?: Record<string, unknown>[];
  trailingInput?: boolean;
  textVerbosity?: string;
} = {}): Record<string, unknown> {
  return {
    client_metadata: input.clientMetadata ?? {
      "x-codex-installation-id": "deploy-smoke-test-installation",
    },
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
    ...(input.promptCacheRetention === undefined
      ? {}
      : { prompt_cache_retention: input.promptCacheRetention }),
    ...(input.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: input.maxOutputTokens }),
    reasoning: {
      effort: input.reasoningEffort ?? "low",
      ...(input.extraReasoning ?? {}),
    },
    store: input.store ?? false,
    stream: input.stream ?? true,
    text: {
      verbosity: input.textVerbosity ?? "low",
      ...(input.extraText ?? {}),
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
      search_content_types: ["text", "image"],
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
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        include: ["reasoning.encrypted_content", "unexpected.output"],
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ parallelToolCalls: false })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        promptCacheKey: "",
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        promptCacheKey: "deploy smoke test",
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        promptCacheRetention: "24h",
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ maxOutputTokens: 32 })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraTopLevel: { max_output_tokens: 8192 },
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        clientMetadata: { smoke: "live" },
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraTopLevel: { metadata: { smoke: "live" } },
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraTopLevel: { previous_response_id: "resp_previous" },
      })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ store: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ background: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ background: false })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ extraInput: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ toolChoice: "none" })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
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
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        tools: createDeploySmokeOpenAiRequestTools().map((tool, index) =>
          index === 0 ? { ...tool, unexpected: true } : tool
        ),
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
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
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraReasoning: { summary: "auto" },
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ textVerbosity: "medium" })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({
        extraText: { format: { type: "json_object" } },
      })),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
  });

  it("accepts the pinned Codex exec smoke Responses request contract", async () => {
    const request = await capturePinnedCodexSmokeOpenAiRequest();

    expect(request.method).toBe("POST");
    expect(request.pathname).toBe("/v1/responses");
    expect(request.authorization).toBe(`Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`);
    expect(request.rawBodyByteLength).toBeGreaterThan(0);
    expect(request.rawBodyByteLength).toBeLessThanOrEqual(
      HOSTED_DEPLOY_SMOKE_OPENAI_REQUEST_MAX_BODY_BYTES,
    );
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      request.rawBody,
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });
    expect(readDeployLiveModelTurnSmokeCodexOutputText(request.stdout)).toBe(
      DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
    );
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

  it("reads supported Codex JSONL assistant message variants as smoke output", () => {
    const stdout = [
      JSON.stringify({
        method: "item/completed",
        params: {
          item: {
            message: "NOT YET",
            type: "assistant_message",
          },
        },
      }),
      JSON.stringify({
        data: {
          item: {
            content: [
              {
                text: " OK ",
                type: "output_text",
              },
            ],
            type: "assistant.message",
          },
        },
        event: "item.completed",
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

async function capturePinnedCodexSmokeOpenAiRequest(): Promise<CapturedPinnedCodexSmokeOpenAiRequest> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "deploy-smoke-codex-shape-"));
  const codexHome = path.join(workspaceRoot, "codex-home");
  const smokeVaultRoot = path.join(workspaceRoot, "vault");
  let childProcess: ReturnType<typeof spawn> | null = null;
  const capturedRequests: CapturedPinnedCodexSmokeOpenAiRequest[] = [];
  let stdout = "";
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      capturedRequests.push({
        authorization: request.headers.authorization ?? null,
        method: request.method ?? "",
        pathname: url.pathname,
        rawBody: body,
        rawBodyByteLength: Buffer.byteLength(body, "utf8"),
        stdout: "",
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(createPinnedCodexSmokeResponseStreamBody());
    });
  });

  try {
    await mkdir(codexHome, { mode: 0o700, recursive: true });
    await mkdir(smokeVaultRoot, { mode: 0o700, recursive: true });
    await writeFile(
      path.join(smokeVaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        formatVersion: 1,
        timezone: "UTC",
        title: "Deploy Smoke Codex Shape",
        vaultId: "vault_deploy_smoke_shape",
      })}\n`,
      { mode: 0o600 },
    );
    await writeFile(path.join(smokeVaultRoot, "CORE.md"), "# Deploy Smoke Codex Shape\n", {
      mode: 0o600,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the local Responses stub to listen on a TCP port.");
    }

    await writeFile(
      path.join(codexHome, "config.toml"),
      [
        `model = ${JSON.stringify(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL)}`,
        'model_provider = "local-deploy-smoke"',
        'model_reasoning_effort = "low"',
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
        "check_for_update_on_startup = false",
        "",
        "[features]",
        "plugins = false",
        "",
        '[model_providers."local-deploy-smoke"]',
        'name = "OpenAI"',
        `base_url = ${JSON.stringify(`http://127.0.0.1:${address.port}/v1`)}`,
        'env_key = "OPENAI_API_KEY"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        "request_max_retries = 0",
        "stream_max_retries = 0",
        "",
        "[skills]",
        "include_instructions = false",
        "",
        "[skills.bundled]",
        "enabled = false",
        "",
        "[history]",
        'persistence = "none"',
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    childProcess = spawn(pinnedCodexBin, [
      "exec",
      "--json",
      "--skip-git-repo-check",
      DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
    ], {
      cwd: smokeVaultRoot,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    childProcess.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    childProcess.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timedOut = await waitForChildCloseOrTimeout(childProcess, 15_000);
    if (timedOut) {
      throw new Error("Timed out waiting for pinned Codex smoke request capture.");
    }
    const capturedRequest = capturedRequests[0];
    if (!capturedRequest) {
      throw new Error(`Pinned Codex did not send a Responses request. stderr=${stderr}`);
    }

    return {
      authorization: capturedRequest.authorization,
      method: capturedRequest.method,
      pathname: capturedRequest.pathname,
      rawBody: capturedRequest.rawBody,
      rawBodyByteLength: capturedRequest.rawBodyByteLength,
      stdout,
    };
  } finally {
    childProcess?.kill("SIGTERM");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch(() => undefined);
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

function createPinnedCodexSmokeResponseStreamBody(): string {
  const outputPart = {
    annotations: [],
    text: DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
    type: "output_text",
  };
  const outputItem = {
    content: [outputPart],
    id: "msg_deploy_smoke_shape",
    role: "assistant",
    status: "completed",
    type: "message",
  };
  const response = {
    id: "resp_deploy_smoke_shape",
    model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
    object: "response",
    output: [outputItem],
    status: "completed",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    },
  };
  return [
    createPinnedCodexSmokeResponseEvent("response.created", {
      response: { ...response, status: "in_progress" },
    }),
    createPinnedCodexSmokeResponseEvent("response.in_progress", {
      response: { ...response, status: "in_progress" },
    }),
    createPinnedCodexSmokeResponseEvent("response.output_item.added", {
      item: {
        content: [],
        id: outputItem.id,
        role: outputItem.role,
        status: "in_progress",
        type: outputItem.type,
      },
      output_index: 0,
    }),
    createPinnedCodexSmokeResponseEvent("response.content_part.added", {
      content_index: 0,
      item_id: outputItem.id,
      output_index: 0,
      part: {
        annotations: [],
        text: "",
        type: "output_text",
      },
    }),
    createPinnedCodexSmokeResponseEvent("response.output_text.delta", {
      content_index: 0,
      delta: DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
      item_id: outputItem.id,
      output_index: 0,
    }),
    createPinnedCodexSmokeResponseEvent("response.output_text.done", {
      content_index: 0,
      item_id: outputItem.id,
      output_index: 0,
      text: DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
    }),
    createPinnedCodexSmokeResponseEvent("response.content_part.done", {
      content_index: 0,
      item_id: outputItem.id,
      output_index: 0,
      part: outputPart,
    }),
    createPinnedCodexSmokeResponseEvent("response.output_item.done", {
      item: outputItem,
      output_index: 0,
    }),
    createPinnedCodexSmokeResponseEvent("response.completed", {
      response,
    }),
    "data: [DONE]\n",
    "",
  ].join("\n");
}

function createPinnedCodexSmokeResponseEvent(
  type: string,
  data: Record<string, unknown>,
): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n`;
}

async function waitForChildCloseOrTimeout(
  childProcess: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      childProcess.kill("SIGTERM");
      resolve(true);
    }, timeoutMs);
    childProcess.once("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}
