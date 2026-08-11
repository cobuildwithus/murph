import { createServer as createNetServer } from "node:net";
import { describe, expect, it } from "vitest";
import { listMurphDynamicToolNames } from "@murphai/assistant-engine/assistant-codex";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  buildAssistantProviderMurphToolCall,
  buildAssistantProviderVaultCliCall,
  buildHostedLocalDeviceSyncProviderEnvClearances,
  buildHostLoopbackStubBaseUrl,
  expectAdvertisedMurphDynamicTools,
  HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS,
  HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS,
  isLocalTemporalTcpPortCandidateUsable,
  mergeRequiredEnvProfile,
  reserveLocalTemporalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  scopeHostedLocalAssistantProviderResponse,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  type HostedLocalAssistantProviderStubRequest,
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
      mergeRequiredEnvProfile("device-sync,exa,hosted-email,linq,mapbox,telegram", "linq"),
    ).toBe("assistant,device-sync,exa,hosted-email,linq,mapbox,telegram");
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
    const requests: HostedLocalAssistantProviderStubRequest[] = [];
    const server = await startAssistantProviderStubServer({
      onRequest: (request) => {
        requests.push(request);
      },
      responseState: {
        queuedResponses: ["streamed recorder reply"],
      },
    });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [],
            model: "gpt-5.6-terra",
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
      expect(Number.isSafeInteger(requests[0]?.observedAtEpochMs)).toBe(true);
      expect(JSON.parse(requests[0]!.body)).toMatchObject({
        stream: true,
      });
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("streams a scripted function_call item for tool-call turns", async () => {
    const server = await startAssistantProviderStubServer({
      responseState: {
        queuedResponses: [
          buildAssistantProviderVaultCliCall(["automation", "save", "Title with 'quote'"]),
          "follow-up text reply",
        ],
      },
    });

    try {
      const baseUrl =
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`;
      const toolCallResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.6-terra",
          stream: true,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const toolCallBody = await toolCallResponse.text();

      expect(toolCallResponse.status).toBe(200);
      expect(toolCallBody).toContain("response.completed");
      expect(toolCallBody).toContain('"type":"function_call"');
      expect(toolCallBody).toContain("exec_command");
      expect(toolCallBody).toContain("vault-cli");
      expect(toolCallBody).toContain("automation");

      const followupResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.6-terra",
          stream: true,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const followupBody = await followupResponse.text();

      expect(followupResponse.status).toBe(200);
      expect(followupBody).toContain("follow-up text reply");
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("streams a scripted custom_tool_call item for Terra dynamic tools", async () => {
    const server = await startAssistantProviderStubServer({
      responseState: {
        queuedResponses: [
          buildAssistantProviderMurphToolCall("automation", {
            action: "save",
            title: "Morning reminder",
          }),
        ],
      },
    });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [],
            model: "gpt-5.6-terra",
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
      expect(body).toContain("response.completed");
      expect(body).toContain('"type":"custom_tool_call"');
      expect(body).toContain('"name":"exec"');
      expect(body).toContain("yield_time_ms");
      expect(body).toContain("30000");
      expect(body).toContain("tools.murph__automation");
      expect(body).toContain("Morning reminder");
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("does not pop scoped Responses API fixtures for unmatched fallback requests", async () => {
    const responseState = {
      queuedResponses: [
        {
          matchInputContains: "target message",
          response: "target reply",
        },
      ],
    };
    const server = await startAssistantProviderStubServer({
      fallbackResponseText: "fallback reply",
      responseState,
    });

    try {
      const baseUrl =
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`;
      const backgroundResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [{ content: "background wake", role: "user" }],
          model: "gpt-5.6-terra",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const backgroundBody = await backgroundResponse.text();

      expect(backgroundResponse.status).toBe(200);
      expect(backgroundBody).toContain("fallback reply");
      expect(responseState.queuedResponses).toHaveLength(1);

      const targetResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [{ content: "please handle this target message", role: "user" }],
          model: "gpt-5.6-terra",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const targetBody = await targetResponse.text();

      expect(targetResponse.status).toBe(200);
      expect(targetBody).toContain("target reply");
      expect(responseState.queuedResponses).toHaveLength(0);
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("keeps unmatched scoped Responses API fixtures queued when fallback is disabled", async () => {
    const responseState = {
      queuedResponses: [
        {
          matchInputContains: "target message",
          response: "target reply",
        },
      ],
    };
    const server = await startAssistantProviderStubServer({ responseState });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [{ content: "background wake", role: "user" }],
            model: "gpt-5.6-terra",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: "Assistant provider stub received a responses request without a queued response.",
      });
      expect(responseState.queuedResponses).toHaveLength(1);
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("uses the newest matcher-signature group when one request matches multiple queued inputs", async () => {
    const responseState = {
      queuedResponses: [
        {
          matchInputContains: "U can call me Rocket Man",
          response: "nickname reply",
        },
        {
          matchInputContains: "I want to build more strength",
          response: "grouped reply",
        },
      ],
    };
    const server = await startAssistantProviderStubServer({ responseState });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [
              {
                content: [
                  "Input 1/2:",
                  "U can call me Rocket Man",
                  "Input 2/2:",
                  "I want to build more strength",
                ].join("\n"),
                role: "user",
              },
            ],
            model: "gpt-5.6-terra",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("grouped reply");
      expect(body).not.toContain("nickname reply");
      expect(responseState.queuedResponses).toHaveLength(1);
      expect(responseState.queuedResponses[0]).toMatchObject({
        response: "nickname reply",
      });
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("pops scoped fixture sequences with the same matcher in FIFO order", async () => {
    const triggerText = "Can you send me the setup image?";
    const responseState = {
      queuedResponses: [
        scopeHostedLocalAssistantProviderResponse(
          buildAssistantProviderVaultCliCall(["automation", "save", "image setup"]),
          { matchInputContains: triggerText },
        ),
        {
          matchInputContains: triggerText,
          response: "same matcher follow-up reply",
        },
      ],
    };
    const server = await startAssistantProviderStubServer({ responseState });

    try {
      const baseUrl =
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`;
      const toolCallResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [{ content: triggerText, role: "user" }],
          model: "gpt-5.6-terra",
          stream: true,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const toolCallBody = await toolCallResponse.text();

      expect(toolCallResponse.status).toBe(200);
      expect(toolCallBody).toContain('"type":"function_call"');
      expect(toolCallBody).toContain("vault-cli");
      expect(toolCallBody).not.toContain("same matcher follow-up reply");

      const followupResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [
            {
              content: [
                triggerText,
                "Previous tool result: saved the requested setup image.",
              ].join("\n"),
              role: "user",
            },
          ],
          model: "gpt-5.6-terra",
          stream: true,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const followupBody = await followupResponse.text();

      expect(followupResponse.status).toBe(200);
      expect(followupBody).toContain("same matcher follow-up reply");
      expect(followupBody).not.toContain('"type":"function_call"');
      expect(responseState.queuedResponses).toHaveLength(0);
    } finally {
      await stopHttpStubServer(server);
    }
  });

  it("uses the only matching scoped fixture when newer scoped fixtures do not match", async () => {
    const responseState = {
      queuedResponses: [
        {
          matchInputContains: "target message",
          response: "target reply",
        },
        {
          matchInputContains: "unrelated later message",
          response: "unrelated reply",
        },
      ],
    };
    const server = await startAssistantProviderStubServer({ responseState });

    try {
      const response = await fetch(
        `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`,
        {
          body: JSON.stringify({
            input: [{ content: "please handle this target message", role: "user" }],
            model: "gpt-5.6-terra",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("target reply");
      expect(body).not.toContain("unrelated reply");
      expect(responseState.queuedResponses).toHaveLength(1);
      expect(responseState.queuedResponses[0]).toMatchObject({
        response: "unrelated reply",
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
        queuedResponses: ["first reply", "second reply"],
      },
    });

    try {
      const baseUrl = `${buildHostLoopbackStubBaseUrl(server, "assistant provider test")}/v1/responses`;
      const firstResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.6-terra",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
      const secondResponse = await fetch(baseUrl, {
        body: JSON.stringify({
          input: [],
          model: "gpt-5.6-terra",
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

describe("expectAdvertisedMurphDynamicTools", () => {
  it("expects gated tools only when the scenario enables them", () => {
    const allToolNames = listMurphDynamicToolNames();
    const baseToolNames = allToolNames.filter((name) =>
      !name.startsWith("murph.computer_")
      && !name.startsWith("murph.connected_apps_")
      && name !== "murph.group_room_model"
      && name !== "murph.imessage_contact"
      && name !== "murph.react_to_message"
      && name !== "murph.select_reply_target"
      && name !== "murph.create_phone_call"
      && name !== "murph.newsletter"
      && name !== "murph.pending_vault_files"
      && name !== "murph.send_physical_note"
      && name !== "murph.send_vault_file"
      && name !== "murph.ask_grok"
      && name !== "murph.attach_response_card"
    );
    const baseToolNamesWithoutProgress = baseToolNames.filter((name) =>
      name !== "murph.send_progress_update"
    );
    expect(allToolNames).toContain("murph.react_to_message");
    expect(allToolNames).toContain("murph.select_reply_target");
    expect(allToolNames).toContain("murph.computer_open");
    expect(allToolNames).toContain("murph.connected_apps_manage");
    expect(allToolNames).toContain("murph.create_phone_call");
    expect(allToolNames).toContain("murph.group_room_model");
    expect(allToolNames).toContain("murph.imessage_contact");
    expect(allToolNames).toContain("murph.send_physical_note");
    expect(allToolNames).toContain("murph.send_progress_update");
    expect(allToolNames).toContain("murph.ask_grok");
    expect(allToolNames).toContain("murph.attach_response_card");

    expectAdvertisedMurphDynamicTools([
      buildResponsesRequest(baseToolNames),
    ]);
    // Responses Lite models (e.g. gpt-5.6-terra) relocate the structured
    // namespace into an additional_tools input item; it must still be read.
    expectAdvertisedMurphDynamicTools([
      buildResponsesRequest(baseToolNames, "additional-tools"),
    ]);
    expectAdvertisedMurphDynamicTools([
      buildResponsesRequest(baseToolNames, "code-mode"),
    ]);
    // Codex 0.147 wraps the code-mode exec tool in the default functions
    // namespace inside additional_tools.
    expectAdvertisedMurphDynamicTools([
      buildResponsesRequest(baseToolNames, "code-mode-namespaced"),
    ]);
    expectAdvertisedMurphDynamicTools(
      [buildResponsesRequest([...baseToolNames, "murph.pending_vault_files"])],
      {
        pendingVaultFilesAvailable: true,
      },
    );
    expectAdvertisedMurphDynamicTools(
      [buildResponsesRequest([...baseToolNames, "murph.send_vault_file"])],
      {
        vaultFileSendAvailable: true,
      },
    );
    expectAdvertisedMurphDynamicTools(
      [buildResponsesRequest(baseToolNamesWithoutProgress)],
      {
        progressUpdatesAvailable: false,
      },
    );

    expectAdvertisedMurphDynamicTools(
      [buildResponsesRequest(allToolNames)],
      {
        connectedAppsAvailable: true,
        computerToolsAvailable: true,
        groupRoomModelAvailable: true,
        imessageContactAvailable: true,
        messageTargetingAvailable: true,
        newsletterAvailable: true,
        pendingVaultFilesAvailable: true,
        physicalNotesAvailable: true,
        phoneCallsAvailable: true,
        progressUpdatesAvailable: true,
        responseCardAvailable: true,
        vaultFileSendAvailable: true,
        askGrokAvailable: true,
      },
    );
  });
});

describe("buildAssistantProviderMurphToolCall", () => {
  it("scripts Terra dynamic tools through canonical Codex code mode", () => {
    const response = buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      title: "Morning reminder",
    });

    expect(response).toMatchObject({
      customToolCall: {
        name: "exec",
      },
    });
    expect(JSON.stringify(response)).toContain("tools.murph__automation");
    expect(JSON.stringify(response)).toContain("Morning reminder");
  });
});

describe("resolveHostedAssistantLocalDevEnv", () => {
  it("seeds Codex OpenAI config in local stub mode", () => {
    const env = resolveHostedAssistantLocalDevEnv(
      {
        HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
        OPENAI_API_KEY: "live-openai-key",
      },
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "low",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:1234/v1",
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
          HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://127.0.0.1:4567/v1",
        },
        "live",
        "http://127.0.0.1:1234/v1",
        "Hosted local test",
      ),
    ).toEqual({});
  });
});

describe("hosted local e2e scenario registration", () => {
  it("keeps heavy hosted-local scenarios manual-only while preserving the direct-R2 invariant in all", () => {
    const allScenarios = resolveHostedLocalE2eScenarios("all");
    const coldStartBenchmark = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "cold-start-benchmark");
    const containerContinuity = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "container-continuity");
    const codexContainerContinuity = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "codex-container-continuity");
    const directR2PresignedPut = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "direct-r2-presigned-put");
    const linqLostActiveOperation = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "linq-lost-active-operation");
    const linqGroupIosAppDownload = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "linq-group-ios-app-download");
    const vaultPersistence = listHostedLocalE2eScenarios().find((scenario) => scenario.name === "vault-persistence");

    expect(containerContinuity).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "container-continuity",
    });
    expect(coldStartBenchmark).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-cold-start-benchmark-e2e.test.ts",
      manualOnly: true,
      name: "cold-start-benchmark",
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
    expect(linqLostActiveOperation).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-linq-lost-active-operation-e2e.test.ts",
      manualOnly: true,
      name: "linq-lost-active-operation",
    });
    expect(linqGroupIosAppDownload).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-linq-group-ios-app-download-e2e.test.ts",
      manualOnly: true,
      name: "linq-group-ios-app-download",
    });
    expect(vaultPersistence).toMatchObject({
      file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
      manualOnly: true,
      name: "vault-persistence",
    });
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("container-continuity");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("cold-start-benchmark");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("codex-container-continuity");
    expect(allScenarios.map((scenario) => scenario.name)).toContain("direct-r2-presigned-put");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("linq-lost-active-operation");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("linq-group-ios-app-download");
    expect(allScenarios.map((scenario) => scenario.name)).not.toContain("vault-persistence");
    expect(resolveHostedLocalE2eScenarios("container-continuity")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
      manualOnly: true,
      name: "container-continuity",
    })]);
    expect(resolveHostedLocalE2eScenarios("cold-start-benchmark")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-cold-start-benchmark-e2e.test.ts",
      manualOnly: true,
      name: "cold-start-benchmark",
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
    expect(resolveHostedLocalE2eScenarios("linq-lost-active-operation")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-linq-lost-active-operation-e2e.test.ts",
      manualOnly: true,
      name: "linq-lost-active-operation",
    })]);
    expect(resolveHostedLocalE2eScenarios("linq-group-ios-app-download")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-linq-group-ios-app-download-e2e.test.ts",
      manualOnly: true,
      name: "linq-group-ios-app-download",
    })]);
    expect(resolveHostedLocalE2eScenarios("vault-persistence")).toEqual([expect.objectContaining({
      file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
      manualOnly: true,
      name: "vault-persistence",
    })]);
  });
});

function buildResponsesRequest(
  namespacedToolNames: readonly string[],
  toolLocation:
    | "additional-tools"
    | "code-mode"
    | "code-mode-namespaced"
    | "top-level" = "top-level",
): HostedLocalAssistantProviderStubRequest {
  const tools = [
    {
      name: "murph",
      tools: namespacedToolNames.map((name) => ({
        name: name.replace(/^murph\./u, ""),
      })),
      type: "namespace",
    },
  ];
  const codeModeExecTool = {
    description: namespacedToolNames
      .filter((name) =>
        name !== "murph.automation" && name !== "murph.group"
      )
      .map((name) => name.replace(/^murph\./u, "murph__"))
      .concat("ALL_TOOLS")
      .join("\n"),
    name: "exec",
    type: "custom",
  };

  return {
    body: JSON.stringify(
      toolLocation === "additional-tools"
        ? {
            input: [
              {
                role: "developer",
                tools,
                type: "additional_tools",
              },
            ],
          }
        : toolLocation === "code-mode"
        ? {
            tools: [codeModeExecTool],
          }
        : toolLocation === "code-mode-namespaced"
        ? {
            input: [
              {
                role: "developer",
                tools: [
                  {
                    name: "functions",
                    tools: [codeModeExecTool],
                    type: "namespace",
                  },
                ],
                type: "additional_tools",
              },
            ],
          }
        : { tools },
    ),
    method: "POST",
    url: "/v1/responses",
  };
}

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
