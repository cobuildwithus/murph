import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostedFamilyCheckoutRedirectUrl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  resolveHostedFamilyCheckoutRedirectUrl: mocks.resolveHostedFamilyCheckoutRedirectUrl,
}));

type FamilyCheckoutRedirectRouteModule =
  typeof import("../app/checkout/family/[sessionId]/route");

let familyCheckoutRedirectRoute: FamilyCheckoutRedirectRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.resolveHostedFamilyCheckoutRedirectUrl.mockResolvedValue(
    "https://checkout.stripe.com/c/pay/cs_test_family",
  );
  familyCheckoutRedirectRoute = await import("../app/checkout/family/[sessionId]/route");
});

test("redirects short Family checkout links to the validated Stripe checkout URL", async () => {
  const response = await familyCheckoutRedirectRoute.GET(
    new Request("https://local.withmurph.ai:3443/checkout/family/cs_test_family"),
    {
      params: Promise.resolve({
        sessionId: "cs_test_family",
      }),
    },
  );

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://checkout.stripe.com/c/pay/cs_test_family",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.resolveHostedFamilyCheckoutRedirectUrl).toHaveBeenCalledWith({
    sessionId: "cs_test_family",
  });
});
