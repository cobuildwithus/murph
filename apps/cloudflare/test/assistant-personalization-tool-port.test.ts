import { afterEach, expect, it } from "vitest";
import { HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH } from "@murphai/hosted-execution/assistant-personalization";
import { createHostedRuntimeAssistantPersonalizationToolPort } from "../src/runtime-platform/assistant-personalization-tool-port.ts";
import { startHostedWebControlStub, type HostedWebControlStub } from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;
afterEach(async () => { await webControl?.stop(); webControl = null; });

it("sends accepted-input and scheduled authority through signed HTTP without mixing scopes", async () => {
  const response = { action: "update", result: {
    mainPersona: "classic", model: "gpt-6-sol", modelChangeAppliesNextRun: false,
    modelUpdated: false, solAvailable: true, status: "saved", supportingPersona: null,
    tone: "casual", voice: "warm",
  } };
  webControl = await startHostedWebControlStub({ respond: () => ({ body: response }) });
  const port = createHostedRuntimeAssistantPersonalizationToolPort({
    boundUserId: "member_style", fetchImpl: fetch, timeoutMs: 2_000, transport: webControl.transport,
  });
  const request = { action: "update", tone: "casual" } as const;
  const authorities = [
    { assistantInputId: "ain_0123456789abcdef0123456789abcdef", toolCallId: "call_style_one" },
    { automationId: "automation_daily_style", occurrenceAt: "2026-08-06T14:30:00.000Z", toolCallId: "call_style_two" },
  ];
  for (const authority of authorities) {
    await expect(port.request(request, authority)).resolves.toEqual(response);
  }
  expect(webControl.observedRequests).toHaveLength(2);
  for (const [index, observed] of webControl.observedRequests.entries()) {
    const url = new URL(observed.url, webControl.baseUrl);
    expect(url.pathname).toBe(HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual(authorities[index]);
    expect(observed).toMatchObject({ body: JSON.stringify(request), userId: "member_style", keyId: "v1", method: "POST" });
    expect(observed.signature).toMatch(/^[A-Za-z0-9_-]+$/u);
  }
});
