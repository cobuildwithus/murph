import { describe, expect, it } from "vitest";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeOpenAiModel,
} from "../src/deploy-smoke-live-model.ts";

describe("deploy live model turn smoke", () => {
  it("uses the nano model for the bounded live deploy smoke", () => {
    expect(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL).toBe("gpt-5.4-nano");
  });

  it("reads only the top-level OpenAI Responses model", () => {
    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({
        input: "anything Codex emits",
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        stream: true,
      }),
    )).toBe(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL);

    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({ model: "gpt-smoke-mismatch" }),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeOpenAiModel(
      JSON.stringify({ model: ` ${DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL} ` }),
    )).toBe(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL);
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
