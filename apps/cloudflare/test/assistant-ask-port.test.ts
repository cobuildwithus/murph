import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
} from "@murphai/hosted-execution/routes";
import { createHostedRuntimeAssistantAskPort } from "../src/runtime-platform/assistant-ask-port.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  startHostedWebControlStub,
  type HostedWebControlStub,
} from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;

afterEach(async () => {
  await webControl?.stop();
  webControl = null;
});

describe("Hosted Assistant Ask control-plane port", () => {
  it("allowlists only the exact POST control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
    })).toEqual({
      allowed: true,
      operation: "assistant_ask",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("forwards the opaque request id with cancellation over signed HTTP and parses the bounded response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "prepare",
          disclosure: { permissionText: "Share calendar availability." },
          question: "What is today's workout?",
          status: "ready",
          targetLabel: "100 Club",
        },
      }),
    });
    const signal = new AbortController().signal;
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-group-runtime",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: webControl.transport,
    });
    const request = {
      action: "prepare" as const,
      requestId: "aask_req_one",
    };

    await expect(port.request(request, { signal })).resolves.toEqual({
      action: "prepare",
      disclosure: { permissionText: "Share calendar availability." },
      question: "What is today's workout?",
      status: "ready",
      targetLabel: "100 Club",
    });

    expect(webControl.observedRequests).toHaveLength(1);
    expect(webControl.observedRequests[0]).toMatchObject({
      body: JSON.stringify(request),
      keyId: "v1",
      method: "POST",
      url: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
      userId: "member-group-runtime",
    });
  });

  it("rejects an invalid Web response instead of widening the port", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "prepare",
          question: "unbounded",
          status: "unexpected",
          targetLabel: null,
        },
      }),
    });
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-group-runtime",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: webControl.transport,
    });

    await expect(port.request({
      action: "prepare",
      requestId: "aask_req_one",
    })).rejects.toThrow("Hosted Assistant Ask control returned invalid JSON.");
  });
});
