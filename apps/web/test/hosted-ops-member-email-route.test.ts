import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  previewHostedOpsMemberEmail: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  sendHostedOpsMemberEmail: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-ops/member-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-ops/member-email")
  >("@/src/lib/hosted-ops/member-email");
  return {
    ...actual,
    previewHostedOpsMemberEmail: mocks.previewHostedOpsMemberEmail,
    sendHostedOpsMemberEmail: mocks.sendHostedOpsMemberEmail,
  };
});

import {
  HostedOpsMemberEmailNotConfiguredError,
  HostedOpsMemberEmailPreviewStaleError,
  type HostedOpsMemberEmailPreviewProof,
  type HostedOpsMemberEmailResult,
} from "@/src/lib/hosted-ops/member-email";
import { HostedResendPlainTextEmailError } from "@/src/lib/hosted-onboarding/resend-plain-text-email";

type RouteModule = typeof import("../app/api/ops/member-email/route");

const NOW = new Date("2026-07-15T16:00:00.000Z");
const OPERATOR_MEMBER_ID = "member_operator";
const TARGET_MEMBER_ID = "hbm_target_1";
const SUBJECT = "Subject";
const TEXT = "Plain text body.";
const PREVIEW_PROOF: HostedOpsMemberEmailPreviewProof = {
  previewedAt: NOW.toISOString(),
  token: `ops-member-email-preview-v1.v1.${"a".repeat(43)}`,
};

let route: RouteModule;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
const originalOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;

describe("hosted ops member email route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/member-email/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.HOSTED_OPS_MEMBER_IDS = OPERATOR_MEMBER_ID;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: OPERATOR_MEMBER_ID },
    });
    mocks.previewHostedOpsMemberEmail.mockResolvedValue(makeResult());
    mocks.sendHostedOpsMemberEmail.mockResolvedValue(makeResult({
      outcome: "sent",
      previewProof: null,
      recipients: [{ memberId: TARGET_MEMBER_ID, status: "sent" }],
      summary: {
        readyCount: 0,
        requestedCount: 1,
        sentCount: 1,
        skippedCount: 0,
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    if (originalOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalOpsMemberIds;
    }
  });

  test("hides the route from members outside the ops allowlist", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_other" },
    });

    const response = await route.POST(makeRequest({
      memberIds: [TARGET_MEMBER_ID],
      mode: "preview",
      subject: SUBJECT,
      text: TEXT,
    }));

    assert.equal(response.status, 404);
    expect(mocks.previewHostedOpsMemberEmail).not.toHaveBeenCalled();
  });

  test("normalizes unique member IDs while preserving the exact draft", async () => {
    const subject = `  ${SUBJECT}  `;
    const text = `\n${TEXT}\n`;
    const response = await route.POST(makeRequest({
      memberIds: [`  ${TARGET_MEMBER_ID}  `, TARGET_MEMBER_ID],
      mode: "preview",
      subject,
      text,
    }));

    assert.equal(response.status, 200);
    assert.equal(route.maxDuration, 60);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.previewHostedOpsMemberEmail).toHaveBeenCalledWith({
      memberIds: [TARGET_MEMBER_ID],
      subject,
      text,
    });
    expect(mocks.sendHostedOpsMemberEmail).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  test("sends only with the supplied Preview and logs aggregate counts", async () => {
    const response = await route.POST(makeRequest({
      memberIds: [TARGET_MEMBER_ID],
      mode: "send",
      previewProof: PREVIEW_PROOF,
      subject: SUBJECT,
      text: TEXT,
    }));

    assert.equal(response.status, 200);
    expect(mocks.sendHostedOpsMemberEmail).toHaveBeenCalledWith({
      memberIds: [TARGET_MEMBER_ID],
      previewProof: PREVIEW_PROOF,
      subject: SUBJECT,
      text: TEXT,
    });
    expect(consoleInfoSpy.mock.calls[0]).toEqual([
      "Hosted ops member email batch completed.",
      {
        requestedCount: 1,
        sentCount: 1,
        skippedCount: 0,
        timestamp: NOW.toISOString(),
      },
    ]);
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toMatch(/hbm_|Subject|Plain text/u);
  });

  test.each([
    ["empty member list", { memberIds: [] }],
    ["invalid member", { memberIds: ["bad member"] }],
    ["missing subject", { subject: " " }],
    ["long subject", { subject: "s".repeat(201) }],
    ["missing body", { text: " " }],
    ["long body", { text: "t".repeat(20_001) }],
    ["invalid mode", { mode: "apply" }],
  ])("rejects %s", async (_label, override) => {
    const response = await route.POST(makeRequest({
      memberIds: [TARGET_MEMBER_ID],
      mode: "preview",
      subject: SUBJECT,
      text: TEXT,
      ...override,
    }));

    assert.equal(response.status, 400);
    expect(mocks.previewHostedOpsMemberEmail).not.toHaveBeenCalled();
    expect(mocks.sendHostedOpsMemberEmail).not.toHaveBeenCalled();
  });

  test("rejects more than 100 member IDs and Send without a proof", async () => {
    const tooMany = await route.POST(makeRequest({
      memberIds: Array.from({ length: 101 }, (_, index) => `hbm_${index}`),
      mode: "preview",
      subject: SUBJECT,
      text: TEXT,
    }));
    const noProof = await route.POST(makeRequest({
      memberIds: [TARGET_MEMBER_ID],
      mode: "send",
      subject: SUBJECT,
      text: TEXT,
    }));

    assert.equal(tooMany.status, 400);
    assert.equal(noProof.status, 400);
    expect(mocks.previewHostedOpsMemberEmail).not.toHaveBeenCalled();
    expect(mocks.sendHostedOpsMemberEmail).not.toHaveBeenCalled();
  });

  test("maps stale, unconfigured, and provider errors without logging private data", async () => {
    mocks.sendHostedOpsMemberEmail
      .mockRejectedValueOnce(new HostedOpsMemberEmailPreviewStaleError())
      .mockRejectedValueOnce(new HostedOpsMemberEmailNotConfiguredError())
      .mockRejectedValueOnce(new HostedResendPlainTextEmailError(
        "Hosted Resend email batch send failed.",
        { code: "RESEND_BATCH_SEND_FAILED", providerStatus: 429 },
      ));
    const requestBody = {
      memberIds: [TARGET_MEMBER_ID],
      mode: "send",
      previewProof: PREVIEW_PROOF,
      subject: SUBJECT,
      text: TEXT,
    };

    const stale = await route.POST(makeRequest(requestBody));
    const unconfigured = await route.POST(makeRequest(requestBody));
    const unavailable = await route.POST(makeRequest(requestBody));

    assert.equal(stale.status, 409);
    assert.equal(unconfigured.status, 503);
    assert.equal(unavailable.status, 502);
    assert.deepEqual(await unavailable.json(), {
      error: {
        code: "HOSTED_OPS_MEMBER_EMAIL_PROVIDER_UNAVAILABLE",
        message: "Resend could not confirm this email batch.",
        retryable: true,
      },
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Hosted ops member email Resend batch failed.",
      {
        providerErrorCode: "RESEND_BATCH_SEND_FAILED",
        providerStatus: 429,
      },
    );
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(
      /hbm_|Subject|Plain text|@/u,
    );
  });
});

function makeResult(
  overrides: Partial<HostedOpsMemberEmailResult> = {},
): HostedOpsMemberEmailResult {
  return {
    message: "1 of 1 member is ready to receive this email.",
    outcome: "preview",
    previewProof: PREVIEW_PROOF,
    recipients: [{ memberId: TARGET_MEMBER_ID, status: "ready" }],
    summary: {
      readyCount: 1,
      requestedCount: 1,
      sentCount: 0,
      skippedCount: 0,
    },
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ops/member-email", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });
}
