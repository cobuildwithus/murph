import { describe, expect, it } from "vitest";

import { HOSTED_ASSISTANT_PRODUCT_MODELS } from "@murphai/hosted-execution/assistant-model";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODELS,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeModel,
  readDeployLiveModelTurnSmokeOpenAiModel,
} from "../src/deploy-smoke-live-model.ts";

describe("deploy live model turn smoke", () => {
  it("smokes every model a member can be routed to", () => {
    expect(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODELS).toEqual(HOSTED_ASSISTANT_PRODUCT_MODELS);
    expect(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODELS).toEqual(expect.arrayContaining([
      "gpt-6.2-sol",
      "gpt-6.2-astra",
    ]));
    expect(readDeployLiveModelTurnSmokeModel(" gpt-6.2-astra ")).toBe("gpt-6.2-astra");
    expect(readDeployLiveModelTurnSmokeModel("gpt-synthetic-unlisted")).toBeNull();
    expect(readDeployLiveModelTurnSmokeModel(null)).toBeNull();
  });

  it("reads only a top-level OpenAI Responses product model", () => {
    for (const model of DEPLOY_LIVE_MODEL_TURN_SMOKE_MODELS) {
      expect(readDeployLiveModelTurnSmokeOpenAiModel(
        JSON.stringify({
          input: "anything Codex emits",
          model,
          stream: true,
        }),
      )).toBe(model);
    }

    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({ model: "gpt-synthetic-unlisted" }),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({ input: [{ model: "gpt-6.2-sol" }] }),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({ model: " gpt-6-luna " }),
    )).toBe("gpt-6-luna");
    expect(readDeployLiveModelTurnSmokeOpenAiModel("{}")).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiModel("not json")).toBeNull();
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
