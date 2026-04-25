import { describe, expect, it } from "vitest";

import {
  buildHostLoopbackStubBaseUrl,
  mergeRequiredEnvProfile,
  startAssistantProviderStubServer,
  stopHttpStubServer,
} from "./helpers/hosted-local-e2e-support.js";

describe("mergeRequiredEnvProfile", () => {
  it("preserves the default hosted runner profiles when adding a required channel profile", () => {
    expect(mergeRequiredEnvProfile(undefined, "linq")).toBe("assistant,parsers,web,linq");
  });

  it("adds the required profile without duplicating existing entries", () => {
    expect(mergeRequiredEnvProfile("assistant,linq,web", "linq")).toBe("assistant,linq,web");
  });
});

describe("startAssistantProviderStubServer", () => {
  it("serves queued responses through the OpenAI Responses API shape", async () => {
    const server = await startAssistantProviderStubServer({
      responseState: {
        queuedResponseTexts: ['{"kind":"send_message","privateSummary":"deliver","text":"hello"}'],
      },
    });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider stub")}/v1/responses`,
        {
          body: JSON.stringify({
            input: "hello",
            model: "stub-openrouter-model",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: "resp_stub_hosted_local_e2e",
        model: "stub-openrouter-model",
        output: [
          {
            content: [
              {
                annotations: [],
                text: '{"kind":"send_message","privateSummary":"deliver","text":"hello"}',
                type: "output_text",
              },
            ],
            id: "msg_stub_hosted_local_e2e",
            role: "assistant",
            type: "message",
          },
        ],
        usage: {
          input_tokens: 24,
          output_tokens: 11,
        },
      });

      const unqueuedResponse = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider stub")}/v1/responses`,
        {
          body: JSON.stringify({
            input: "hello again",
            model: "stub-openrouter-model",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      );

      expect(unqueuedResponse.status).toBe(500);
      await expect(unqueuedResponse.json()).resolves.toMatchObject({
        error: expect.stringContaining("without a queued response"),
      });
    } finally {
      await stopHttpStubServer(server);
    }
  });
});
