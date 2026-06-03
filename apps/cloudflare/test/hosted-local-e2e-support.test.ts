import { createServer as createNetServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV as HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
} from "@murphai/hosted-local-harness/codex-app-server-stub";

import {
  buildHostedLocalDeviceSyncProviderEnvClearances,
  buildHostLoopbackStubBaseUrl,
  HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS,
  HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS,
  isLocalTemporalTcpPortCandidateUsable,
  mergeRequiredEnvProfile,
  reserveLocalTemporalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  startAssistantProviderStubServer,
  stopHttpStubServer,
} from "./helpers/hosted-local-e2e-support.js";
import {
  listHostedLocalE2eScenarios,
  resolveHostedLocalE2eScenarios,
} from "@murphai/hosted-local-harness/e2e";

const temporalDevUiPortOffset = 1_000;

describe("mergeRequiredEnvProfile", () => {
  it("preserves the default hosted runner profiles when adding a required channel profile", () => {
    expect(mergeRequiredEnvProfile(undefined, "linq")).toBe("assistant,linq");
  });

  it("adds the required profile without duplicating existing entries", () => {
    expect(mergeRequiredEnvProfile("assistant,linq", "linq")).toBe("assistant,linq");
  });

  it("keeps the assistant profile when local dev supplies non-assistant defaults", () => {
    expect(
      mergeRequiredEnvProfile("device-sync,hosted-email,linq,mapbox,telegram", "linq"),
    ).toBe("assistant,device-sync,hosted-email,linq,mapbox,telegram");
  });
});

describe("reserveLocalTemporalTcpPort", () => {
  it("reserves a frontend port with an available Temporal UI companion port", async () => {
    const port = await reserveLocalTemporalTcpPort();

    expect(port).toBeGreaterThanOrEqual(10_000);
    expect(port).toBeLessThanOrEqual(65_535 - temporalDevUiPortOffset);
    await expect(canBindLocalTcpPort(port)).resolves.toBe(true);
    await expect(canBindLocalTcpPort(port + temporalDevUiPortOffset)).resolves.toBe(true);
  });

  it("rejects candidates that collide with planned scenario ports", () => {
    expect(isLocalTemporalTcpPortCandidateUsable({
      excludedPorts: [40_000],
      port: 40_000,
    })).toBe(false);
    expect(isLocalTemporalTcpPortCandidateUsable({
      excludedPorts: [41_000],
      port: 40_000,
    })).toBe(false);
    expect(isLocalTemporalTcpPortCandidateUsable({
      excludedPorts: [42_000],
      port: 40_000,
    })).toBe(true);
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
  it("seeds Codex OpenAI config in local stub mode", () => {
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
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "12345",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: "http://127.0.0.1:1234/v1",
      NODE_ENV: "test",
      OPENAI_API_KEY: "stub-local-openai-key",
    });
    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();
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
    expect(env.OPENAI_API_KEY).toBe("stub-local-openai-key");
  });

  it("uses a bounded local stub runner timeout by default", () => {
    const env = resolveHostedAssistantLocalDevEnv(
      {},
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    expect(env.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS).toBe("600000");
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
          HOSTED_ASSISTANT_PROVIDER: "openai",
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

describe("hosted local e2e scenario registration", () => {
  it("keeps heavy hosted-local scenarios manual-only while preserving the direct-R2 invariant in all", () => {
    const allScenarios = resolveHostedLocalE2eScenarios("all");
    const containerContinuity = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "container-continuity");
    const codexContainerContinuity = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "codex-container-continuity");
    const directR2PresignedPut = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "direct-r2-presigned-put");
    const vaultPersistence = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "vault-persistence");

    expect(containerContinuity).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "container-continuity",
    });
    expect(codexContainerContinuity).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "codex-container-continuity",
    });
    expect(directR2PresignedPut).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
      name: "direct-r2-presigned-put",
    });
    expect(vaultPersistence).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
      manualOnly: true,
      name: "vault-persistence",
    });
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("container-continuity");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("codex-container-continuity");
    expect(allScenarios.map((scenario) => scenario.name)).toContain("direct-r2-presigned-put");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("vault-persistence");
    expect(resolveHostedLocalE2eScenarios("container-continuity")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "container-continuity",
    })]);
    expect(resolveHostedLocalE2eScenarios("codex-container-continuity")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "codex-container-continuity",
    })]);
    expect(resolveHostedLocalE2eScenarios("direct-r2-presigned-put")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
      name: "direct-r2-presigned-put",
    })]);
    expect(resolveHostedLocalE2eScenarios("vault-persistence")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
      manualOnly: true,
      name: "vault-persistence",
    })]);
  });
});

async function canBindLocalTcpPort(port: number): Promise<boolean> {
  const server = createNetServer();
  return await new Promise<boolean>((resolve) => {
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        resolve(!error);
      });
    });
  });
}
