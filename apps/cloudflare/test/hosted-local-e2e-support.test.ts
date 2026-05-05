import { describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  buildHostedLocalDeviceSyncProviderEnvClearances,
  buildHostLoopbackStubBaseUrl,
  HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS,
  HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS,
  mergeRequiredEnvProfile,
  resolveHostedAssistantLocalDevEnv,
  startAssistantProviderStubServer,
  stopHttpStubServer,
} from "./helpers/hosted-local-e2e-support.js";

describe("mergeRequiredEnvProfile", () => {
  it("preserves the default hosted runner profiles when adding a required channel profile", () => {
    expect(mergeRequiredEnvProfile(undefined, "linq")).toBe("assistant,linq");
  });

  it("adds the required profile without duplicating existing entries", () => {
    expect(mergeRequiredEnvProfile("assistant,linq", "linq")).toBe("assistant,linq");
  });
});

describe("startAssistantProviderStubServer", () => {
  it("streams Responses API fixtures for real Codex app-server recorder mode", async () => {
    const requests: Array<{ body: string; method: string; url: string }> = [];
    const server = await startAssistantProviderStubServer({
      onRequest: (request) => {
        requests.push(request);
      },
      responseState: {
        queuedResponseTexts: ["streamed recorder reply"],
      },
    });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [],
            model: "gpt-5.5",
            stream: true,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(body).toContain("response.completed");
      expect(body).toContain("streamed recorder reply");
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]!.body)).toMatchObject({
        stream: true,
      });
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("caps recorded Responses API request bodies in diagnostic recorder mode", async () => {
    const requests: Array<{ body: string; method: string; url: string }> = [];
    const server = await startAssistantProviderStubServer({
      maxResponsesApiRequestBodies: 1,
      onRequest: (request) => {
        requests.push(request);
      },
      responseState: {
        queuedResponseTexts: ["first reply", "second reply"],
      },
    });

    try {
      const baseUrl = `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`;
      const firstResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.5",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const secondResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.5",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(429);
      expect(requests).toHaveLength(1);
    } finally {
      await stopHttpStubServer(server);
    }
  });
});

describe("resolveHostedAssistantLocalDevEnv", () => {
  it("seeds Codex Vercel AI Gateway config in local stub mode", () => {
    const env = resolveHostedAssistantLocalDevEnv(
      {
        HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
        HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "12345",
        OPENAI_API_KEY: "live-openai-key",
      },
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "12345",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: "http://127.0.0.1:1234/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "stub-local-vercel-ai-gateway-key",
    });
    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("clears direct provider keys from local stub mode", () => {
    const source = Object.fromEntries(
      HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS.map((key) => [key, `${key}-value`]),
    );
    const env = resolveHostedAssistantLocalDevEnv(
      source,
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    for (const key of HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.VERCEL_AI_API_KEY).toBe("stub-local-vercel-ai-gateway-key");
  });

  it("clears device-sync provider env that would otherwise leak into scenarios", () => {
    const env = buildHostedLocalDeviceSyncProviderEnvClearances();

    expect(HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS).toEqual(
      expect.arrayContaining(["JUNCTION_API_KEY", "JUNCTION_ENV", "WHOOP_CLIENT_SECRET"]),
    );
    for (const key of HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS) {
      expect(env[key]).toBe("");
    }
  });

  it("fails closed in live mode without explicit hosted assistant provider and model", () => {
    expect(() =>
      resolveHostedAssistantLocalDevEnv(
        {},
        "live",
        null,
        "Hosted local test",
      )
    ).toThrow(
      "Hosted local test requires explicit hosted assistant config in live mode.",
    );
  });

  it("passes through live mode when explicit hosted assistant config is supplied", () => {
    expect(
      resolveHostedAssistantLocalDevEnv(
        {
          HOSTED_ASSISTANT_MODEL: "gpt-5.5",
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "23456",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://127.0.0.1:4567/v1",
        },
        "live",
        "http://127.0.0.1:1234/v1",
        "Hosted local test",
      ),
    ).toEqual({
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "23456",
    });
  });
});
