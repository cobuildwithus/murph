import { describe, expect, it } from "vitest";

import {
  findProviderRequestBoundaryViolations,
  providerRequestScanRoots,
  providerRequestSourceExtensions,
  shouldScanProviderRequestSourceFile,
} from "./check-provider-request-boundaries.ts";

function blockedLines(source: string): number[] {
  return findProviderRequestBoundaryViolations(
    "apps/web/src/example.ts",
    source,
  ).filter((violation) => violation.kind === "object-spread").map(
    (violation) => violation.line,
  );
}

function rawHttpViolations(source: string, relativePath = "scripts/example.mjs") {
  return findProviderRequestBoundaryViolations(relativePath, source).filter(
    (violation) => violation.kind === "raw-provider-http",
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

  it("includes JavaScript operational scripts in the production scan", () => {
    expect(providerRequestSourceExtensions).toContain(".cjs");
    expect(providerRequestSourceExtensions).toContain(".js");
    expect(providerRequestSourceExtensions).toContain(".mjs");
  });

  it("excludes JavaScript tests and TypeScript declaration variants", () => {
    for (const relativePath of [
      "scripts/example.spec.cjs",
      "scripts/example.test.cjs",
      "scripts/example.spec.js",
      "scripts/example.test.js",
      "scripts/example.spec.mjs",
      "scripts/example.test.mjs",
      "scripts/example.d.cts",
      "scripts/example.d.mts",
      "scripts/example.d.ts",
    ]) {
      expect(shouldScanProviderRequestSourceFile(relativePath)).toBe(false);
    }
    for (const relativePath of [
      "scripts/example.cjs",
      "scripts/example.js",
      "scripts/example.mjs",
      "scripts/example.mts",
      "scripts/example.ts",
    ]) {
      expect(shouldScanProviderRequestSourceFile(relativePath)).toBe(true);
    }
  });

  it("blocks direct provider fetches without an SDK import", () => {
    expect(rawHttpViolations([
      "const openAiBaseUrl = 'https://api.openai.com/v1';",
      "await fetch(`${openAiBaseUrl}/responses`, { method: 'POST' });",
      "const resendRequest = new Request('https://api.resend.com/emails');",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        boundary: "Direct OpenAI provider HTTP",
        line: 2,
      }),
      expect.objectContaining({
        boundary: "Direct Resend provider HTTP",
        line: 3,
      }),
    ]);
  });

  it("resolves direct provider origins through URL and request variables", () => {
    expect(rawHttpViolations([
      "const baseUrl = new URL('https://api.sandbox.eu.junction.com');",
      "const target = new URL('/v2/users', baseUrl);",
      "const request = new Request(target);",
      "await globalThis.fetch(request);",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        boundary: "Direct Junction provider HTTP",
        line: 3,
      }),
      expect.objectContaining({
        boundary: "Direct Junction provider HTTP",
        line: 4,
      }),
    ]);
  });

  it("allows only a matching official SDK transport adapter exception", () => {
    expect(rawHttpViolations([
      "import { Exa } from 'exa-js';",
      "const baseUrl = 'https://api.exa.ai';",
      "// provider-request-boundary-allow-next-line: sdk-transport-adapter",
      "await fetchImpl(`${baseUrl}/search`, { method: 'POST' });",
    ].join("\n"))).toEqual([]);

    expect(rawHttpViolations([
      "import { Resend } from 'resend';",
      "// provider-request-boundary-allow-next-line: sdk-transport-adapter",
      "await fetchImpl('https://api.exa.ai/search', { method: 'POST' });",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        boundary: "Invalid provider HTTP exception sdk-transport-adapter",
        line: 3,
      }),
    ]);
  });

  it("allows only SDK-owned Linq presigned byte URL variables", () => {
    expect(rawHttpViolations([
      "import LinqAPIV3 from '@linqapp/sdk';",
      "const uploadUrl = await prepareUploadUrl();",
      "// provider-request-boundary-allow-next-line: linq-presigned-bytes",
      "await fetch(uploadUrl, { body: bytes, method: 'PUT' });",
    ].join("\n"))).toEqual([]);

    expect(rawHttpViolations([
      "import LinqAPIV3 from '@linqapp/sdk';",
      "const apiUrl = 'https://api.linqapp.com/api/partner/v3/chats';",
      "// provider-request-boundary-allow-next-line: linq-presigned-bytes",
      "await fetch(apiUrl, { method: 'GET' });",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        boundary: "Invalid provider HTTP exception linq-presigned-bytes",
        line: 4,
      }),
    ]);
  });

  it("rejects unknown provider HTTP exception reasons", () => {
    expect(rawHttpViolations([
      "import OpenAI from 'openai';",
      "// provider-request-boundary-allow-next-line: legacy-client",
      "await fetch('https://api.openai.com/v1/responses');",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        boundary: "Invalid provider HTTP exception legacy-client",
        line: 3,
      }),
    ]);
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

  it("covers Resend typed request builders and client operations", () => {
    expect(blockedLines([
      "import { Resend, type CreateBatchOptions, type CreateEmailOptions } from 'resend';",
      "const email: CreateEmailOptions = { from, subject, text, to, ...optional };",
      "const batch: CreateBatchOptions = [{ from, subject, text, to, ...optional }];",
      "const resend = new Resend(apiKey);",
      "resend.emails.send(email, { ...requestOptions });",
      "resend.batch.send(batch);",
    ].join("\n"))).toEqual([2, 3, 5]);
  });

  it("covers the newly adopted official provider clients", () => {
    expect(blockedLines([
      "import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';",
      "import { KeyManagementServiceClient } from '@google-cloud/kms';",
      "import { LettersApi } from '@lob/lob-typescript-sdk';",
      "import { Exa } from 'exa-js';",
      "import { GoogleAuth } from 'google-auth-library';",
      "const elevenLabs = new ElevenLabsClient({ apiKey });",
      "const kms = new KeyManagementServiceClient();",
      "const letters = new LettersApi(configuration);",
      "const exa = new Exa(apiKey);",
      "const auth = new GoogleAuth(options);",
      "elevenLabs.textToSpeech.convert(voiceId, { ...speech });",
      "kms.encrypt({ ...request });",
      "letters.create({ ...letter });",
      "exa.search(query, { ...searchOptions });",
      "auth.getClient({ ...authOptions });",
    ].join("\n"))).toEqual([11, 12, 13, 14, 15]);
  });

  it("covers Composio typed builders and the generated provider client", () => {
    expect(blockedLines([
      "import Composio from '@composio/client';",
      "import type { ToolExecuteParams } from '@composio/client/resources/tools';",
      "function buildExecute(): ToolExecuteParams {",
      "  return { arguments, ...identity };",
      "}",
      "const composio = new Composio({ apiKey });",
      "composio.tools.execute(toolSlug, { arguments, ...identity });",
    ].join("\n"))).toEqual([4, 7]);
  });

  it("rejects inferred Composio request variables", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "apps/web/src/example.ts",
        [
          "import Composio from '@composio/client';",
          "const composio = new Composio({ apiKey });",
          "const params = { arguments, user_id: userId, version };",
          "composio.tools.execute(toolSlug, params);",
        ].join("\n"),
      ).map((violation) => ({
        kind: violation.kind,
        line: violation.line,
      })),
    ).toEqual([{ kind: "untyped-request-object", line: 3 }]);
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
