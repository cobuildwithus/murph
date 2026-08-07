import { describe, expect, it } from "vitest";

import {
  findProviderRequestBoundaryViolations,
  providerRequestScanRoots,
} from "./check-provider-request-boundaries.ts";

function blockedLines(source: string): number[] {
  return findProviderRequestBoundaryViolations(
    "apps/web/src/example.ts",
    source,
  ).filter((violation) => violation.kind === "object-spread").map(
    (violation) => violation.line,
  );
}

describe("check-provider-request-boundaries", () => {
  it("scans production provider request owners", () => {
    expect(providerRequestScanRoots).toContain("apps");
    expect(providerRequestScanRoots).toContain("packages");
    expect(
      findProviderRequestBoundaryViolations(
        "apps/web/app/api/settings/billing/portal/route.ts",
        [
          "stripe.billingPortal.sessions.create({",
          "  ...(configuration ? { configuration } : {}),",
          "  customer,",
          "});",
        ].join("\n"),
      ).map((match) => match.line),
    ).toEqual([2]);
  });

  it("blocks direct and nested object spreads in Stripe request arguments", () => {
    expect(blockedLines([
      "stripe.checkout.sessions.create({",
      "  mode: 'subscription',",
      "  ...(customerId ? { customer: customerId } : {}),",
      "  metadata: { ...metadata },",
      "});",
    ].join("\n"))).toEqual([3, 4]);
  });

  it("follows local request and nested metadata variables", () => {
    expect(blockedLines([
      "const metadata = { ...baseMetadata, source: 'settings' };",
      "const params = { customer, metadata };",
      "input.stripe.subscriptions.create(params);",
    ].join("\n"))).toEqual([1]);
  });

  it("does not resolve request variables through an inaccessible inner scope", () => {
    expect(blockedLines([
      "const params = { ...unsafe };",
      "function unrelated() {",
      "  const params: Stripe.SubscriptionRetrieveParams = { expand: ['customer'] };",
      "  return params;",
      "}",
      "stripe.subscriptions.retrieve(subscriptionId, params);",
    ].join("\n"))).toEqual([1]);
  });

  it("follows locally aliased official Stripe clients", () => {
    expect(blockedLines([
      "const api = requireHostedStripeApi();",
      "api.subscriptions.update(subscriptionId, { ...params });",
    ].join("\n"))).toEqual([2]);
  });

  it("blocks spreads on direct hosted Stripe factory chains", () => {
    expect(blockedLines([
      "requireHostedStripeApi().subscriptions.update(subscriptionId, { ...params });",
    ].join("\n"))).toEqual([1]);
  });

  it("blocks spreads in Stripe request options", () => {
    expect(blockedLines([
      "const options = { ...baseOptions, idempotencyKey: key };",
      "stripe.subscriptions.update(subscriptionId, params, options);",
    ].join("\n"))).toEqual([1]);
  });

  it("blocks payload and option spreads at typed custom Stripe client boundaries", () => {
    expect(blockedLines([
      "interface HostedPulseTrialExtensionStripeClient {",
      "  resumeSubscription(id: string, params: Stripe.SubscriptionResumeParams, options: Stripe.RequestOptions): Promise<Stripe.Subscription>;",
      "}",
      "async function resume(input: { stripe: HostedPulseTrialExtensionStripeClient }) {",
      "  await input.stripe.resumeSubscription(subscriptionId, { ...params }, { ...options });",
      "}",
    ].join("\n"))).toEqual([5, 5]);
  });

  it("blocks spreads hidden inside Stripe-typed parameter builders", () => {
    expect(blockedLines([
      "function buildCheckout(input: Input): Stripe.Checkout.SessionCreateParams {",
      "  return { mode: 'payment', ...(input.customer ? { customer: input.customer } : {}) };",
      "}",
    ].join("\n"))).toEqual([2]);
  });

  it("blocks spreads in official non-Stripe provider request builders", () => {
    expect(blockedLines([
      "import type { MessageSendParams } from '@linqapp/sdk/resources/chats';",
      "function buildMessage(idempotencyKey: string | null): MessageSendParams {",
      "  return { message: { parts: [], ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) } };",
      "}",
      "import type { ConnectionOptions } from '@temporalio/client';",
      "const options: ConnectionOptions = { address, ...(apiKey ? { apiKey } : {}) };",
    ].join("\n"))).toEqual([3, 6]);
  });

  it("covers OpenAI typed builders and the Junction provider client", () => {
    expect(blockedLines([
      "import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';",
      "function buildResponse(): ResponseCreateParamsNonStreaming {",
      "  return { model, input, ...options };",
      "}",
      "import type { Junction } from '@junction-api/sdk';",
      "const client = new JunctionClient(config);",
      "client.listSummary({ resource, userId, ...window });",
    ].join("\n"))).toEqual([3, 7]);
  });

  it("blocks spreads in Kernel SDK request arguments", () => {
    expect(blockedLines([
      "import Kernel from '@onkernel/sdk';",
      "class Client {",
      "  private readonly kernel: Kernel;",
      "  move(sessionId: string) {",
      "    return this.kernel.browsers.computer.moveMouse(sessionId, { ...params });",
      "  }",
      "}",
    ].join("\n"))).toEqual([5]);
  });

  it("recognizes computed, aliased, and parameter-named Stripe clients", () => {
    expect(blockedLines([
      "import Stripe from 'stripe';",
      "const create = stripe.paymentIntents['create'];",
      "create({ ...aliased });",
      "function createAccount(api: Stripe) {",
      "  return api.accounts.create({ ...account });",
      "}",
    ].join("\n"))).toEqual([3, 5]);
  });

  it("rejects untyped object-literal variables passed as provider request params", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "apps/web/src/example.ts",
        [
          "import Stripe from 'stripe';",
          "const retrieveParams = { expand: ['customer'] };",
          "stripe.subscriptions.retrieve(subscriptionId, retrieveParams);",
        ].join("\n"),
      ).map((violation) => ({
        kind: violation.kind,
        line: violation.line,
      })),
    ).toEqual([{ kind: "untyped-request-object", line: 2 }]);
  });

  it("blocks Object.assign at provider request boundaries", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "apps/web/src/example.ts",
        [
          "import type { CallCreatePhoneCallParams } from 'retell-sdk/resources/call';",
          "function build(): CallCreatePhoneCallParams {",
          "  return Object.assign({ from_number: from }, optional);",
          "}",
        ].join("\n"),
      ).map((violation) => violation.kind),
    ).toEqual(["object-assign"]);
  });

  it("allows SDK-typed objects with explicit optional-field assignments", () => {
    expect(blockedLines(`
      const params: Stripe.SubscriptionListParams = { customer, status: "all" };
      if (startingAfter) params.starting_after = startingAfter;
      input.stripe.subscriptions.list(params);
    `)).toEqual([]);
  });

  it("allows array spreads and unrelated object spreads", () => {
    expect(blockedLines(`
      const result = { ...input, status: "ready" };
      stripe.subscriptions.retrieve(subscriptionId, {
        expand: [...SUBSCRIPTION_EXPANSIONS],
      });
    `)).toEqual([]);
  });

  it("ignores helpers whose names merely mention Stripe", () => {
    expect(blockedLines(`
      logHostedStripeFailure({ ...details });
      describeHostedStripeError({ ...errorFields });
    `)).toEqual([]);
  });

  it("reports the SDK callee and normalized source location", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "apps\\web\\src\\example.ts",
        "stripe.refunds.create({ ...payment });",
      ),
    ).toEqual([{
      boundary: "stripe.refunds.create",
      column: 25,
      filePath: "apps/web/src/example.ts",
      kind: "object-spread",
      line: 1,
    }]);
  });
});
