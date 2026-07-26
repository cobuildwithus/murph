import type Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { makeSafeStripePortalConfiguration } from "./support/stripe-portal";

const mocks = vi.hoisted(() => ({
  resolveHostedStripePortalConfigurationId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  resolveHostedStripePortalConfigurationId:
    mocks.resolveHostedStripePortalConfigurationId,
}));

import {
  createHostedStripePortalSession,
  type HostedStripePortalClient,
} from "@/src/lib/hosted-onboarding/stripe-portal";

describe("createHostedStripePortalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValue("bpc_member");
  });

  test("revalidates the selected configuration immediately before creating a session", async () => {
    const retrieve = vi.fn<
      (configurationId: string) => Promise<Stripe.BillingPortal.Configuration>
    >().mockResolvedValue(
      makeSafeStripePortalConfiguration({
        configurationId: "bpc_member",
      }),
    );
    const create = vi.fn<
      (
        params: Stripe.BillingPortal.SessionCreateParams,
      ) => Promise<Stripe.BillingPortal.Session>
    >().mockResolvedValue({
      id: "bps_123",
      object: "billing_portal.session",
      url: "https://billing.stripe.test/session_123",
    } as Stripe.BillingPortal.Session);
    const stripe = makeStripePortalClient({ create, retrieve });

    await expect(createHostedStripePortalSession({
      kind: "member",
      params: {
        customer: "cus_123",
        return_url: "https://join.example.test/settings",
      },
      stripe,
    })).resolves.toMatchObject({
      url: "https://billing.stripe.test/session_123",
    });

    expect(retrieve).toHaveBeenCalledWith("bpc_member");
    expect(create).toHaveBeenCalledWith({
      configuration: "bpc_member",
      customer: "cus_123",
      return_url: "https://join.example.test/settings",
    });
    expect(retrieve.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0]!,
    );
  });

  test("fails closed when Dashboard edits enable portal plan or quantity changes", async () => {
    const configuration = makeSafeStripePortalConfiguration({
      configurationId: "bpc_member",
    });
    configuration.features.subscription_update.enabled = true;
    configuration.features.subscription_update.default_allowed_updates = [
      "quantity",
    ];
    const retrieve = vi.fn<
      (configurationId: string) => Promise<Stripe.BillingPortal.Configuration>
    >().mockResolvedValue(configuration);
    const create = vi.fn<
      (
        params: Stripe.BillingPortal.SessionCreateParams,
      ) => Promise<Stripe.BillingPortal.Session>
    >();

    await expect(createHostedStripePortalSession({
      kind: "member",
      params: {
        customer: "cus_123",
        return_url: "https://join.example.test/settings",
      },
      stripe: makeStripePortalClient({ create, retrieve }),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_UNSAFE",
      httpStatus: 500,
      retryable: false,
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("permits an unconfigured default only when the runtime resolver permits it", async () => {
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValueOnce(
      undefined,
    );
    const retrieve = vi.fn<
      (configurationId: string) => Promise<Stripe.BillingPortal.Configuration>
    >();
    const create = vi.fn<
      (
        params: Stripe.BillingPortal.SessionCreateParams,
      ) => Promise<Stripe.BillingPortal.Session>
    >().mockResolvedValue({
      id: "bps_local",
      object: "billing_portal.session",
      url: "https://billing.stripe.test/session_local",
    } as Stripe.BillingPortal.Session);

    await createHostedStripePortalSession({
      kind: "member",
      params: {
        customer: "cus_123",
        return_url: "https://join.example.test/settings",
      },
      stripe: makeStripePortalClient({ create, retrieve }),
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://join.example.test/settings",
    });
  });
});

function makeStripePortalClient(input: {
  create: HostedStripePortalClient["billingPortal"]["sessions"]["create"];
  retrieve: HostedStripePortalClient["billingPortal"]["configurations"]["retrieve"];
}): HostedStripePortalClient {
  return {
    billingPortal: {
      configurations: {
        retrieve: input.retrieve,
      },
      sessions: {
        create: input.create,
      },
    },
  };
}
