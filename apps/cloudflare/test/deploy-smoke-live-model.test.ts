import { describe, expect, it } from "vitest";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeOpenAiRequest,
} from "../src/deploy-smoke-live-model.ts";

function createDeploySmokeOpenAiRequestBody(input: {
  background?: boolean;
  model?: string;
  prompt?: string;
  reasoningEffort?: string;
  store?: boolean;
  stream?: boolean;
  textVerbosity?: string;
} = {}): Record<string, unknown> {
  return {
    input: [
      {
        content: [
          {
            text: "Deploy smoke context.",
            type: "input_text",
          },
        ],
        role: "developer",
        type: "message",
      },
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
    ],
    ...(input.background === undefined ? {} : { background: input.background }),
    model: input.model ?? DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
    reasoning: {
      effort: input.reasoningEffort ?? "low",
    },
    store: input.store ?? false,
    stream: input.stream ?? true,
    text: {
      verbosity: input.textVerbosity ?? "low",
    },
    tools: [],
  };
}

describe("deploy live model turn smoke", () => {
  it("accepts only the narrow Codex Responses request shape used by the smoke", () => {
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody()),
    )).toEqual({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL });

    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ prompt: "Do something else." })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ model: "gpt-5.5" })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ store: true })),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiRequest(
      JSON.stringify(createDeploySmokeOpenAiRequestBody({ background: true })),
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
