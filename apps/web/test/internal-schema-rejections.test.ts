import { deviceSyncError } from "@murphai/device-syncd/errors";
import { parseRequestJson } from "../src/lib/http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authenticateJson: vi.fn(),
  effect: vi.fn(),
}));
vi.mock("../src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.authenticate,
  requireHostedCloudflareCallbackJsonRequest: mocks.authenticateJson,
}));
vi.mock("../src/lib/phone-calls/service", () => ({ createHostedPhoneCall: mocks.effect }));
vi.mock("../src/lib/phone-calls/status", () => ({ readHostedPhoneCallStatus: mocks.effect }));
vi.mock("../src/lib/phone-calls/control", () => ({ stopHostedPhoneCall: mocks.effect }));
vi.mock("../src/lib/physical-notes/service", () => ({
  createHostedPhysicalNote: mocks.effect, recoverHostedPhysicalNote: mocks.effect,
}));
vi.mock("../src/lib/hosted-execution/usage-status", () => ({ readHostedPersonalAiUsageStatus: mocks.effect }));
vi.mock("../src/lib/hosted-execution/usage-diagnostics", () => ({ readHostedUsageDiagnostics: mocks.effect }));
vi.mock("../src/lib/hosted-execution/assistant-personalization-tool", () => ({ handleHostedRuntimeAssistantPersonalizationTool: mocks.effect }));

vi.mock("../src/lib/hosted-polls/tool", () => ({ handleHostedConversationPollTool: mocks.effect }));
vi.mock("../src/lib/hosted-execution/runtime-snapshots", () => ({ executeHostedRuntimeSnapshotCommand: mocks.effect }));
vi.mock("../src/lib/device-sync/hosted-runtime-authority", () => ({ applyHostedDeviceSyncRuntimeResult: mocks.effect }));
vi.mock("../src/lib/device-sync/source-no-data-outreach-preference", () => ({ configureHostedSourceNoDataOutreach: mocks.effect }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({}) }));

import { POST as applyDeviceResult } from "../app/api/internal/device-sync/runtime/apply/route";
import { POST as configureOutreach } from "../app/api/internal/device-sync/no-data-outreach/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { POST as polls } from "../app/api/internal/hosted-execution/polls/tool/route";
import { POST as resources } from "../app/api/internal/hosted-runtime/resources/route";
import { POST as startCall } from "../app/api/internal/phone-calls/route";
import { POST as callStatus } from "../app/api/internal/phone-calls/status/route";
import { POST as stopCall } from "../app/api/internal/phone-calls/stop/route";
import { POST as sendNote } from "../app/api/internal/physical-notes/route";
import { POST as recoverNote } from "../app/api/internal/physical-notes/recovery/route";
import { POST as planUsage } from "../app/api/internal/hosted-execution/plan-usage/tool/route";
import { POST as diagnostics } from "../app/api/internal/hosted-execution/usage/diagnostics/route";
import { POST as personalization } from "../app/api/internal/hosted-execution/assistant-personalization/tool/route";
import { hostedPhoneCallStatusRequestSchema } from "@murphai/hosted-execution/phone-calls";

function request(payload: unknown) {
  return new Request("https://web.example.test/api/internal/test", {
    method: "POST", body: JSON.stringify(payload),
  });
}

describe("internal schema rejection boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue("member_bound");
    mocks.authenticateJson.mockImplementation(async (req: Request) => ({
      userId: "member_bound", payload: parseRequestJson(await req.text()),
    }));
    mocks.effect.mockResolvedValue({});
  });

  it.each([
    ["phone call start", startCall, {}],
    ["phone call status", callStatus, { phoneCallId: 42 }],
    ["phone call stop", stopCall, {}],
    ["physical note", sendNote, {}],
    ["physical note recovery", recoverNote, {}],
    ["plan usage", planUsage, { includeSubscriptionActionQuote: false }],
    ["usage diagnostics", diagnostics, { days: 0 }],
    ["personalization", personalization, {}],
  ] as const)("rejects malformed %s before service effects", async (_label, post, payload) => {
    const response = await post(request(payload));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid request." } });
    expect(mocks.effect).not.toHaveBeenCalled();
    expect(mocks.authenticate.mock.calls.length + mocks.authenticateJson.mock.calls.length).toBe(1);
  });

  it.each([startCall, callStatus, stopCall, sendNote, recoverNote, planUsage, diagnostics, personalization])(
    "keeps malformed caller JSON as INVALID_JSON %#", async post => {
      const response = await post(new Request("https://web.example.test/api/internal/test", {
        method: "POST", body: "{",
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "INVALID_JSON", message: "Invalid JSON." } });
      expect(mocks.effect).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["personalization", personalization, { action: "read" }],
    ["polls", polls, { assistantInputId: `ain_${"a".repeat(32)}`, request: { action: "list" } }],
    ["resources", resources, { operation: "snapshot_read", snapshotId: "snapshot_test", attemptId: "attempt_test", generation: "1" }],
    ["physical note", sendNote, {
      artwork: { expiresAt: "2026-01-01T00:00:00.000Z", sha256: "a".repeat(64), url: "https://assets.example.test/note.pdf" },
      originAssistantInputId: `ain_${"a".repeat(32)}`, requestKey: "request_test",
      recipient: { addressLine1: "address_test", city: "city_test", name: "recipient_test", postalCode: "00000", state: "CA" },
    }],
  ] as const)("preserves the %s domain refusal status, code and message", async (_label, post, payload) => {
    mocks.effect.mockRejectedValueOnce(hostedOnboardingError({ code: "INVALID_REQUEST", httpStatus: 400, message: "Synthetic state refusal." }));
    const rejected = await post(request(payload));
    expect(mocks.effect).toHaveBeenCalledOnce();
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Synthetic state refusal.", retryable: false } });

    mocks.effect.mockRejectedValueOnce(hostedOnboardingError({ code: "INVALID_REQUEST", httpStatus: 503, message: "Synthetic upstream refusal." }));
    expect((await post(request(payload))).status).toBe(503);

    mocks.effect.mockRejectedValueOnce(new TypeError("synthetic dependency fault"));
    const fault = await post(request(payload));
    expect(fault.status).toBe(500);
    expect(await fault.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
  });

  it.each([
    [applyDeviceResult, {}, deviceSyncError],
    [configureOutreach, { assistantInputId: `ain_${"a".repeat(32)}`, mode: "default", sourceProviderSlug: "garmin" }, hostedOnboardingError],
  ] as const)("preserves the device domain refusal status, code and message %#", async (post, payload, domainError) => {
    mocks.effect.mockRejectedValueOnce(domainError({ code: "INVALID_REQUEST", httpStatus: 400, message: "Synthetic policy refusal." }));
    const response = await post(request(payload));
    expect(mocks.effect).toHaveBeenCalledOnce();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Synthetic policy refusal.", retryable: false } });
    mocks.effect.mockRejectedValueOnce(domainError({ code: "INVALID_REQUEST", httpStatus: 503, message: "Synthetic unavailable authority." }));
    expect((await post(request(payload))).status).toBe(503);
  });

  it("does not translate an unexpected schema parser bug", async () => {
    const parser = vi.spyOn(hostedPhoneCallStatusRequestSchema, "safeParse")
      .mockImplementationOnce(() => { throw new TypeError("synthetic parser fault"); });
    try {
      const response = await callStatus(request({}));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
      expect(mocks.effect).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it("keeps service faults retryable as server errors", async () => {
    mocks.effect.mockRejectedValueOnce(new TypeError("synthetic dependency fault"));
    const response = await callStatus(request({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
  });
});
