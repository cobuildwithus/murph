import { HOSTED_ASSISTANT_PRODUCT_MODELS } from "@murphai/hosted-execution/assistant-model";
import { describe, expect, it } from "vitest";

import {
  DEPLOY_MODEL_ADMISSION_PROBES,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  readDeployLiveModelTurnSmokeCodexOutputText,
  readDeployLiveModelTurnSmokeRequest,
} from "../src/deploy-smoke-live-model.ts";

describe("deploy live model turn smoke", () => {
  it("exercises each foreground model and both scheduled Flex targets", () => {
    for (const model of HOSTED_ASSISTANT_PRODUCT_MODELS) {
      expect(DEPLOY_MODEL_ADMISSION_PROBES.filter(probe => probe.model === model && probe.serviceTier !== "flex").map(probe => probe.serviceTier))
        .toEqual(["default", "priority"]);
    }
    expect(DEPLOY_MODEL_ADMISSION_PROBES.filter(probe => probe.serviceTier === "flex").map(probe => probe.model).sort())
      .toEqual(["gpt-6.1-sol", "gpt-6.1-terra"]);
  });

  it("uses Luna for the bounded live deploy smoke", () => {
    expect(DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL).toBe("gpt-6-luna");
  });

  it("reads only the top-level OpenAI Responses model", () => {
    expect(readDeployLiveModelTurnSmokeRequest(
      JSON.stringify({
        input: "anything Codex emits",
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        stream: true,
      }),
    )).toMatchObject({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL, serviceTier: "default" });

    expect(readDeployLiveModelTurnSmokeRequest(
      JSON.stringify({ model: "gpt-6.2-sol" }),
    )).toBeNull();
    expect(readDeployLiveModelTurnSmokeRequest(
      JSON.stringify({ model: ` ${DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL} ` }),
    )).toMatchObject({ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL, serviceTier: "default" });
    expect(readDeployLiveModelTurnSmokeRequest("{}")).toBeNull();
    expect(readDeployLiveModelTurnSmokeRequest("not json")).toBeNull();
  });

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("admits %s only with a native web.run request", model => {
    const tools = [{ type: "namespace", name: "web", tools: [{ type: "function", name: "run", parameters: { type: "object" } }] }];
    for (const body of [{ model, tools }, { model, input: [{ type: "additional_tools", tools }] }]) {
      expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify(body))).toMatchObject({ model, serviceTier: "default", web: true, image: false });
    }
    for (const body of [{ model }, { model, input: "web.run" }, { model, tools: [{ name: "web.run" }] },
      { model: "unconfigured", tools }, { model, tools: [{ ...tools[0], tools: [] }] }]) {
      expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify(body))).toBeNull();
    }
  });

  it("reads the actual Responses tier and image instead of trusting container metadata", () => {
    const wire = { model: "gpt-6.1-terra", tools: [{ type: "namespace", name: "web", tools: [{ type: "function", name: "run", parameters: {} }] }], input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] }] };
    for (const serviceTier of ["flex", "priority"]) {
      expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify({ ...wire, service_tier: serviceTier })))
        .toMatchObject({ serviceTier, image: true });
    }
    expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify({ ...wire, model: "gpt-6.2-sol", service_tier: "flex" }))).toBeNull();
    expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify({ ...wire, model: "gpt-6.1-sol", service_tier: "priority" }))).toBeNull();
    expect(readDeployLiveModelTurnSmokeRequest(JSON.stringify({ ...wire, service_tier: "bogus" }))).toBeNull();
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
