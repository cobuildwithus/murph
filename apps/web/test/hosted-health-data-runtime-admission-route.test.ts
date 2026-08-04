import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  prisma: { label: "test-prisma" },
  readHostedHealthDataConsentState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  readHostedHealthDataConsentState: mocks.readHostedHealthDataConsentState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type AdmissionRoute = typeof import(
  "../app/api/internal/hosted-runtime/health-data-admission/route"
);

let route: AdmissionRoute;

describe("hosted runtime health-data admission route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/health-data-admission/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it.each([
    ["granted", true],
    ["missing", true],
    ["revoked", false],
  ] as const)(
    "derives %s admission from the Web-owned consent grant",
    async (consentState, processingAllowed) => {
      mocks.readHostedHealthDataConsentState.mockResolvedValue(consentState);
      const request = new Request(
        "https://join.example.test/api/internal/hosted-runtime/health-data-admission",
      );

      const response = await route.GET(request);

      expect(response.status).toBe(200);
      expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
        request,
        { maxBodyBytes: 0 },
      );
      expect(mocks.readHostedHealthDataConsentState).toHaveBeenCalledWith({
        memberId: "member_123",
        prisma: mocks.prisma,
      });
      await expect(response.json()).resolves.toEqual({
        consentState,
        processingAllowed,
        userId: "member_123",
      });
    },
  );
});
