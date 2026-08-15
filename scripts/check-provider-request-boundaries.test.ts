import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findProviderRequestBoundaryViolations,
  isProviderRequestGuardEntrypoint,
  providerBoundaryRegistry,
  providerHttpExceptionRegistry,
  providerRequestScanRoots,
  providerRequestSourceExtensions,
  shouldScanProviderRequestSourceFile,
  shouldSkipProviderRequestDirectory,
} from "./check-provider-request-boundaries.ts";

function blockedLines(source: string): number[] {
  return findProviderRequestBoundaryViolations(
    "apps/web/src/example.ts",
    source,
  ).filter((violation) => violation.kind === "object-spread").map(
    (violation) => violation.line,
  );
}

function violationsOfKind(
  kind: "handwritten-provider-transport" | "raw-provider-http",
  source: string,
  relativePath = "apps/web/src/example.ts",
) {
  return findProviderRequestBoundaryViolations(relativePath, source).filter(
    (violation) => violation.kind === kind,
  );
}

function rawHttpViolations(source: string, relativePath = "scripts/example.mjs") {
  return violationsOfKind("raw-provider-http", source, relativePath);
}

function replaceRequired(source: string, before: string, after: string): string {
  expect(source).toContain(before);
  return source.replace(before, after);
}

describe("check-provider-request-boundaries", () => {
  it("recognizes direct tsx execution even when the module URL has a query", () => {
    expect(
      isProviderRequestGuardEntrypoint(
        "/workspace/repo/scripts/check-provider-request-boundaries.ts",
        "file:///workspace/repo/scripts/check-provider-request-boundaries.ts?tsx=1",
      ),
    ).toBe(true);
    expect(
      isProviderRequestGuardEntrypoint(
        "/workspace/repo/scripts/another-script.ts",
        "file:///workspace/repo/scripts/check-provider-request-boundaries.ts",
      ),
    ).toBe(false);
  });

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

  it("does not treat assembled deployment output as authored provider source", () => {
    expect(shouldSkipProviderRequestDirectory(".deploy")).toBe(true);
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

  it("blocks direct and nested object spreads in Stripe request arguments", () => {
    expect(blockedLines([
      "stripe.checkout.sessions.create({",
      "  mode: 'subscription',",
      "  ...(customerId ? { customer: customerId } : {}),",
      "  metadata: { ...metadata },",
      "});",
    ].join("\n"))).toEqual([3, 4]);
  });

  it("recognizes fetch call/apply indirection without shifting provider evidence", () => {
    const matches = rawHttpViolations([
      "const openAiUrl = 'https://api.openai.com/v1/responses';",
      "fetch.call(undefined, openAiUrl, { method: 'POST' });",
      "fetch.apply(undefined, [openAiUrl, { method: 'POST' }]);",
      "const openAiArgs: Parameters<typeof fetch> = [openAiUrl];",
      "fetch.apply(undefined, openAiArgs);",
    ].join("\n"));

    expect(matches.map((match) => match.line)).toEqual([2, 3, 5]);
  });

  it("keeps provider provenance through call and rejects mutable apply tuples", () => {
    const matches = rawHttpViolations(
      [
        "async function invoke(openAiFetch: typeof fetch) {",
        "  const send = openAiFetch;",
        "  await send.call(undefined, '/v1/responses', { method: 'POST' });",
        "  await fetch.apply(undefined, ['https://api.openai.com/v1/responses', { method: 'POST' }]);",
        "  await fetch.apply(undefined, ['/api/status']);",
        "  const args: Parameters<typeof fetch> = ['/api/status'];",
        "  args[0] = 'https://api.openai.com/v1/responses';",
        "  await fetch.apply(undefined, args);",
        "  await fetch.apply(undefined, ['https://api.openai.com/v1/responses', ...args]);",
        "  await fetch.apply(undefined, [, { method: 'POST' }]);",
        "}",
        "const unrelated = { call() {}, apply() {} };",
        "unrelated.call(undefined, 'https://api.openai.com/v1/responses');",
        "unrelated.apply(undefined, ['https://api.openai.com/v1/responses']);",
      ].join("\n"),
      "packages/assistant-engine/src/openai-transport.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 4, 8, 9, 10]);
  });

  it("uses the nearest effective URL assignment at the request", () => {
    const matches = rawHttpViolations(
      [
        "let endpoint = '/api/openai/status';",
        "endpoint = 'https://api.openai.com/v1/responses';",
        "fetch(endpoint, { method: 'POST' });",
        "endpoint = '/api/openai/status';",
        "fetch(endpoint);",
        "endpoint = 'https://api.linqapp.com/v1/messages';",
        "fetch(endpoint);",
        "fetch(endpoint = 'https://api.openai.com/v1/images');",
        "let nestedEndpoint = '/api/status';",
        "if (process.env.OPENAI_API_BASE_URL) {",
        "  nestedEndpoint = 'https://api.openai.com/v1/responses';",
        "}",
        "fetch(nestedEndpoint);",
        "let maybeInternal = 'https://api.openai.com/v1/responses';",
        "if (process.env.USE_INTERNAL) {",
        "  maybeInternal = '/api/status';",
        "}",
        "fetch(maybeInternal);",
        "let composed = 'https://api.openai.com/v1';",
        "composed = `${composed}/responses`;",
        "fetch(composed);",
      ].join("\n"),
      "apps/web/src/lib/openai/runtime.ts",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([
        { boundary: "OpenAI raw HTTP via fetch", line: 3 },
        { boundary: "Linq raw HTTP via fetch", line: 7 },
        { boundary: "OpenAI raw HTTP via fetch", line: 8 },
        { boundary: "OpenAI raw HTTP via fetch", line: 13 },
        { boundary: "OpenAI raw HTTP via fetch", line: 18 },
        { boundary: "OpenAI raw HTTP via fetch", line: 21 },
      ]);
  });

  it("does not let conditional assignments erase provider provenance", () => {
    const matches = rawHttpViolations(
      [
        "let unbraced = 'https://api.openai.com/v1/responses';",
        "if (process.env.USE_INTERNAL) unbraced = '/api/status';",
        "fetch(unbraced);",
        "let logical = 'https://api.openai.com/v1/responses';",
        "process.env.USE_INTERNAL && (logical = '/api/status');",
        "fetch(logical);",
        "let ternary = 'https://api.openai.com/v1/responses';",
        "process.env.USE_INTERNAL ? (ternary = '/api/status') : undefined;",
        "fetch(ternary);",
      ].join("\n"),
      "apps/web/src/lib/openai/runtime.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 6, 9]);
  });

  it("keeps provider-neutral exact callbacks outside provider fallback", () => {
    const matches = rawHttpViolations(
      [
        "export function forwardUnknown(url: string, fetchImplementation: typeof fetch) {",
        "  return fetchImplementation(url);",
        "}",
      ].join("\n"),
      "packages/runner/src/provider-neutral-runner.ts",
    );

    expect(matches).toEqual([]);
  });

  it("does not attribute a neutral fetch helper to an unrelated SDK import", () => {
    const matches = rawHttpViolations(
      [
        "import LinqAPIV3 from '@linqapp/sdk';",
        "async function fetchWithTimeout(fetchImplementation: typeof fetch, url: URL) {",
        "  return await fetchImplementation(url, { signal: AbortSignal.timeout(1000) });",
        "}",
        "const client = new LinqAPIV3({ apiKey: 'test' });",
        "void client;",
      ].join("\n"),
      "apps/cloudflare/src/operator-alert/neutral.ts",
    );

    expect(matches).toEqual([]);
  });

  it("still attributes provider-neutral calls inside an SDK fetch adapter", () => {
    const matches = rawHttpViolations(
      [
        "import LinqAPIV3 from '@linqapp/sdk';",
        "function createSdkFetch(fetchImplementation: typeof fetch) {",
        "  return async (url: URL) => await fetchImplementation(url);",
        "}",
        "void LinqAPIV3;",
      ].join("\n"),
      "apps/cloudflare/src/operator-alert/linq.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("does not allow source comments to suppress provider HTTP", () => {
    const matches = rawHttpViolations([
      "// provider-request-boundary-allow-next-line: sdk-transport-adapter",
      "fetch('https://api.exa.ai/search', { method: 'POST' });",
    ].join("\n"));

    expect(matches.map((match) => match.line)).toEqual([2]);
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

  it("covers official provider clients loaded through CommonJS require", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "scripts/openai-client.cjs",
        [
          "const OpenAI = require('openai');",
          "const client = new OpenAI();",
          "client.responses.create({ model: 'gpt-5', ...payload });",
        ].join("\n"),
      ).filter((match) => match.kind === "object-spread").map(
        (match) => match.line,
      ),
    ).toEqual([3]);
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

  it("scans operational JavaScript modules while excluding tests, fixtures, and generated output", () => {
    expect(providerRequestSourceExtensions).toContain(".mjs");
    expect(shouldScanProviderRequestSourceFile("scripts/provider-sync.mjs")).toBe(true);
    expect(shouldScanProviderRequestSourceFile("scripts/provider-sync.test.mjs")).toBe(false);
    expect(shouldScanProviderRequestSourceFile("scripts/provider-sync.generated.mjs")).toBe(false);
    expect(shouldSkipProviderRequestDirectory("fixtures")).toBe(true);
    expect(shouldSkipProviderRequestDirectory("dist")).toBe(true);
    expect(shouldSkipProviderRequestDirectory("build")).toBe(true);
    expect(shouldSkipProviderRequestDirectory("out")).toBe(true);
  });

  it("reports canonical provider fetches in mjs files without an SDK import", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io';",
        "const url = new URL('/v1/text-to-speech/voice', ELEVENLABS_API_BASE_URL);",
        "await fetch(url, { method: 'POST' });",
      ].join("\n"),
      "scripts/generate-provider-preview.mjs",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([{
        boundary: "ElevenLabs raw HTTP via fetch",
        line: 3,
      }]);
  });

  it("recognizes a canonical provider host literal without a scheme", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const apiHost = 'api.resend.com';",
        "fetch(`https://${apiHost}/emails`, { method: 'POST' });",
      ].join("\n"),
      "scripts/send-provider-email.mjs",
    );

    expect(matches.map((match) => match.line)).toEqual([2]);
  });

  it("reports direct, aliased, and typed-wrapper fetch transports", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "type ProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;",
        "const JUNCTION_BASE_URL = 'https://api.us.junction.com';",
        "const fetchImplementation = fetch;",
        "fetch(new URL('/v1/users', JUNCTION_BASE_URL));",
        "fetchImplementation(`${JUNCTION_BASE_URL}/v1/connections`);",
        "function request(fetchTransport: ProviderFetch) {",
        "  return fetchTransport(new URL('/v1/summaries', JUNCTION_BASE_URL));",
        "}",
        "async function invoke(input: string | URL, init?: RequestInit): Promise<Response> {",
        "  return fetch(input, init);",
        "}",
        "invoke(new URL('/v1/devices', JUNCTION_BASE_URL));",
      ].join("\n"),
      "packages/device-syncd/src/providers/junction-http.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 5, 7, 12]);
  });

  it("recognizes a constructor-injected fetch member by its call signature", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "class ResendTransport {",
        "  constructor(private readonly request: typeof fetch) {}",
        "  send() { return this.request('https://api.resend.com/emails'); }",
        "}",
      ].join("\n"),
      "apps/web/src/lib/hosted-onboarding/resend-transport.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("follows configurable provider bases through locals, fields, parameters, and config names", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "class LinqTransport {",
        "  private baseUrl: string;",
        "  private openAiApiRoot: string;",
        "  constructor(config: { apiRoot: string; linqApiBaseUrl: string }) {",
        "    this.baseUrl = config.linqApiBaseUrl;",
        "    this.openAiApiRoot = config.apiRoot || config.linqApiBaseUrl;",
        "  }",
        "  send(path: string, fetchImpl: typeof fetch) {",
        "    const endpoint = new URL(path, this.baseUrl);",
        "    return fetchImpl(endpoint);",
        "  }",
        "  sendOpenAi(fetchImpl: typeof fetch) {",
        "    return fetchImpl(new URL('/v1/responses', this.openAiApiRoot));",
        "  }",
        "}",
        "function sendOpenAi(openAiBaseUrl: string) {",
        "  const endpoint = `${openAiBaseUrl}/v1/responses`;",
        "  return fetch(endpoint);",
        "}",
        "const junctionEndpoint = new URL('/v1/users', process.env.JUNCTION_API_BASE_URL);",
        "fetch(junctionEndpoint);",
      ].join("\n"),
      "apps/web/src/lib/linq/provider-transport.ts",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([
        { boundary: "Linq raw HTTP via fetchImpl", line: 10 },
        { boundary: "Linq/OpenAI raw HTTP via fetchImpl", line: 13 },
        { boundary: "OpenAI raw HTTP via fetch", line: 18 },
        { boundary: "Junction raw HTTP via fetch", line: 21 },
      ]);
  });

  it("reports ambiguous provider dataflow without selecting registry order", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const openAiApiRoot = process.env.OPENAI_API_BASE_URL;",
        "const linqApiBaseUrl = process.env.LINQ_API_BASE_URL;",
        "const endpoint = Math.random() > 0.5 ? openAiApiRoot : linqApiBaseUrl;",
        "fetch(endpoint);",
      ].join("\n"),
      "apps/web/src/lib/provider-transport.ts",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([{
        boundary: "Linq/OpenAI raw HTTP via fetch",
        line: 4,
      }]);
  });

  it("follows a configurable Junction base through a parameter and new URL", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function readJunction(junctionBaseUrl: string, fetchImplementation: typeof fetch) {",
        "  const endpoint = new URL('/v1/connections', junctionBaseUrl);",
        "  await fetchImplementation(endpoint);",
        "}",
      ].join("\n"),
      "packages/device-syncd/src/providers/configured-client.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("recognizes Google KMS, STS, and IAM Credentials endpoints", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "fetch('https://cloudkms.googleapis.com/v1/projects/p/locations/l/keyRings/r/cryptoKeys/k:encrypt');",
        "fetch('https://sts.googleapis.com/v1/token');",
        "fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/a:generateAccessToken');",
      ].join("\n"),
      "apps/web/src/lib/hosted-crypto/provider-auth.ts",
    );

    expect(matches.map((match) => match.boundary)).toEqual([
      "Google Cloud KMS raw HTTP via fetch",
      "Google STS raw HTTP via fetch",
      "Google IAM Credentials raw HTTP via fetch",
    ]);
  });

  it("reports handwritten provider fetch, client, request, and response contracts", () => {
    const agentmailMatches = violationsOfKind(
      "handwritten-provider-transport",
      [
        "const AGENTMAIL_API_BASE_URL = 'https://api.agentmail.to/v0';",
        "interface AgentmailFetchResponse {",
        "  json(): Promise<unknown>;",
        "  status: number;",
        "}",
        "type AgentmailFetch = (input: string, init: RequestInit) => Promise<AgentmailFetchResponse>;",
        "interface AgentmailHttpClient {",
        "  request(input: RequestInfo, init?: RequestInit): Promise<Response>;",
        "}",
        "interface AgentmailApiClient {",
        "  send(request: { body: string }): Promise<AgentmailFetchResponse>;",
        "}",
      ].join("\n"),
      "packages/operator-config/src/agentmail-http.ts",
    );
    const exaMatches = violationsOfKind(
      "handwritten-provider-transport",
      [
        "const EXA_RESEARCH_SCOUT_PATH = '/search';",
        "const EXA_RESEARCH_SCOUT_METHOD = 'POST';",
        "interface ExaResearchScoutRequestBody {",
        "  query: string;",
        "  numResults: number;",
        "}",
      ].join("\n"),
      "packages/contracts/src/exa-wire.ts",
    );

    expect(agentmailMatches.map((match) => match.line)).toEqual([2, 6, 7]);
    expect(exaMatches.map((match) => match.line)).toEqual([3]);
  });

  it("uses unambiguous transport evidence for generically named wire contracts", () => {
    const matches = violationsOfKind(
      "handwritten-provider-transport",
      [
        "const OPENAI_URL = 'https://api.openai.com/v1/responses';",
        "interface RequestOptions {",
        "  method: 'POST';",
        "  headers: Record<string, string>;",
        "  body: string;",
        "}",
        "interface ResponseBody {",
        "  json(): Promise<unknown>;",
        "  status: number;",
        "}",
        "interface Payload {",
        "  method: 'POST';",
        "  headers: Record<string, string>;",
        "  body: string;",
        "}",
        "interface DomainResponse {",
        "  json(): Promise<unknown>;",
        "  status: number;",
        "}",
      ].join("\n"),
      "packages/contracts/src/provider-wire.ts",
    );
    const ambiguousMatches = violationsOfKind(
      "handwritten-provider-transport",
      [
        "const OPENAI_URL = 'https://api.openai.com/v1/responses';",
        "const LINQ_URL = 'https://api.linqapp.com/api/partner/v3/chats';",
        "interface RequestOptions {",
        "  method: 'POST';",
        "  body: string;",
        "}",
      ].join("\n"),
      "packages/contracts/src/ambiguous-provider-wire.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 7, 11]);
    expect(ambiguousMatches).toEqual([]);
  });

  it("reports only the primitive inside provider-domain orchestration helpers", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "type ExaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;",
        "async function fetchExaResearchScoutResponse(body: unknown, fetchImpl: ExaFetch): Promise<unknown> {",
        "  const response = await fetchImpl('https://api.exa.ai/search', { method: 'POST' });",
        "  return await response.json();",
        "}",
        "async function fetchExaResearchScoutCandidates(fetchImpl: ExaFetch) {",
        "  return await fetchExaResearchScoutResponse({}, fetchImpl);",
        "}",
        "type MigrationRunner = (command: string, args: readonly string[]) => Promise<void>;",
        "async function runProductionMigrations(runCommand: MigrationRunner) {",
        "  await runCommand('pnpm', ['linq:sync-lines']);",
        "}",
        "async function downloadHostedLinqAttachmentBytes(url: string, fetchImplementation: ExaFetch): Promise<Uint8Array> {",
        "  const response = await fetchImplementation(url);",
        "  return new Uint8Array(await response.arrayBuffer());",
        "}",
        "async function consumeAttachment(fetchImplementation: ExaFetch) {",
        "  return await downloadHostedLinqAttachmentBytes('https://api.linqapp.com/v1/attachment', fetchImplementation);",
        "}",
      ].join("\n"),
      "packages/cli/src/provider-orchestration.ts",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([
        { boundary: "Exa raw HTTP via fetchImpl", line: 3 },
        { boundary: "Linq raw HTTP via fetchImplementation", line: 14 },
      ]);
  });

  it("reports a fetch-shaped wrapper once rather than at every caller", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const EXA_BASE_URL = 'https://api.exa.ai';",
        "async function requestExa(input: string | URL, init?: RequestInit): Promise<Response> {",
        "  return fetch(new URL('/search', EXA_BASE_URL), init);",
        "}",
        "requestExa(new URL('/search', EXA_BASE_URL));",
        "requestExa(new URL('/search', EXA_BASE_URL), { method: 'POST' });",
      ].join("\n"),
      "packages/cli/src/exa-http.ts",
    );

    expect(matches.map((match) => ({ boundary: match.boundary, line: match.line })))
      .toEqual([{ boundary: "Exa raw HTTP via fetch", line: 3 }]);
  });

  it("resolves fetch aliases at the nearest binding", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import { fetch as providerFetch } from 'undici';",
        "interface Transport { request: typeof fetch; }",
        "const openAiUrl = 'https://api.openai.com/v1/responses';",
        "providerFetch(openAiUrl);",
        "async function outer(request: typeof fetch) {",
        "  await request(openAiUrl);",
        "  async function nested(request: (input: string) => Promise<string>) {",
        "    return await request(openAiUrl);",
        "  }",
        "  await nested(request);",
        "}",
        "const client = { request: async (_url: string) => 'ok' };",
        "client.request(openAiUrl);",
      ].join("\n"),
      "packages/cli/src/openai-binding-resolution.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 6]);
  });

  it("reports imported Node and Undici transports plus canonical provider hosts", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import { request as send } from 'node:https';",
        "import { fetch as undiciFetch, request as undiciRequest } from 'undici';",
        "import * as https from 'node:https';",
        "send('https://api.openai.com/v1/responses');",
        "undiciFetch('https://api.openai.com/v1/responses');",
        "undiciRequest('https://api.openai.com/v1/responses');",
        "https.get('https://api.openai.com/v1/models');",
        "send({ hostname: 'api.openai.com', path: '/v1/responses' });",
        "fetch('https://api.retellai.com/v2/create-phone-call');",
        "fetch('https://backend.composio.dev/api/v1/connectedAccounts');",
      ].join("\n"),
      "scripts/provider-http-transports.mjs",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it("reports scoped CommonJS and namespace-destructured transports", () => {
    const commonJsMatches = violationsOfKind(
      "raw-provider-http",
      [
        "const { request: send } = require('node:https');",
        "const https = require('node:https');",
        "const { request: sendFromNamespace } = https;",
        "const directSend = require('node:https').request;",
        "const { fetch: undiciFetch } = require('undici');",
        "send('https://api.openai.com/v1/responses');",
        "https.request('https://api.openai.com/v1/responses');",
        "sendFromNamespace('https://api.openai.com/v1/responses');",
        "directSend('https://api.openai.com/v1/responses');",
        "undiciFetch('https://api.openai.com/v1/responses');",
        "let undici = require('undici');",
        "undici.request('https://api.openai.com/v1/responses');",
        "undici = { request: (_url: string) => undefined };",
        "undici.request('https://api.openai.com/v1/responses');",
        "function shadow(send: (url: string) => string) {",
        "  return send('https://api.openai.com/v1/responses');",
        "}",
        "function shadowGlobalFetch(unrelated: { fetch: (url: string) => string }) {",
        "  const { fetch } = unrelated;",
        "  return fetch('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "scripts/provider-http-transports.cjs",
    );
    const namespaceMatches = violationsOfKind(
      "raw-provider-http",
      [
        "import * as https from 'node:https';",
        "const { request: send } = https;",
        "send('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/provider-http-transports.mjs",
    );

    expect(commonJsMatches.map((match) => match.line)).toEqual([6, 7, 8, 9, 10, 12]);
    expect(namespaceMatches.map((match) => match.line)).toEqual([3]);
  });

  it("reports destructured global fetch aliases without trusting shadowed objects", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const { fetch } = globalThis;",
        "const { fetch: send } = self;",
        "const { fetch: windowSend } = window;",
        "const { ['fetch']: computedSend } = globalThis;",
        "const { fetch: defaultedSend = () => undefined } = globalThis;",
        "const { ...globalCopy } = globalThis;",
        "const unrelated = { fetch: (url: string) => url };",
        "const { fetch: localSend } = unrelated;",
        "await fetch('https://api.openai.com/v1/responses');",
        "await send('https://api.openai.com/v1/responses');",
        "await windowSend('https://api.openai.com/v1/responses');",
        "await computedSend('https://api.openai.com/v1/responses');",
        "await defaultedSend('https://api.openai.com/v1/responses');",
        "await globalCopy.fetch('https://api.openai.com/v1/responses');",
        "await localSend('https://api.openai.com/v1/responses');",
        "function shadow(globalThis: { fetch: (url: string) => string }) {",
        "  const { fetch: shadowed } = globalThis;",
        "  return shadowed('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "scripts/destructured-global-fetch.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("preserves exact fetch types on destructured provider transports", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function direct({ fetch }: { fetch: typeof globalThis.fetch }) {",
        "  await fetch('https://api.openai.com/v1/responses');",
        "}",
        "async function aliased({ fetch: openAiSend }: { fetch: typeof globalThis.fetch }) {",
        "  await openAiSend('/v1/responses', { method: 'POST' });",
        "}",
        "async function loose(openAiHandler: (request: Request) => Promise<Response>, request: Request) {",
        "  await openAiHandler(request);",
        "}",
        "async function looseMember(runtime: { openAiHandler: (request: Request) => Promise<Response> }, request: Request) {",
        "  await runtime.openAiHandler(request);",
        "}",
        "async function exactMethod(runtime: { openAiSend(input: RequestInfo, init?: RequestInit): Promise<Response> }) {",
        "  await runtime.openAiSend('/v1/responses');",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/provider-request-proxy.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 5, 14]);
  });

  it("preserves provider facts across destructured transport aliases", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function direct({ openAiFetch: send }: { openAiFetch: typeof fetch }) {",
        "  await send('/v1/responses', { method: 'POST' });",
        "}",
        "async function nested({ openAi: { fetch: send } }: { openAi: { fetch: typeof fetch } }) {",
        "  await send('/v1/responses', { method: 'POST' });",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/provider-request-proxy.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 5]);
  });

  it("reports direct CommonJS transports without treating unrelated require calls as HTTP", () => {
    const commonJsMatches = violationsOfKind(
      "raw-provider-http",
      [
        "require('node:https').request('https://api.openai.com/v1/responses');",
        "require('node:http').get('https://api.openai.com/v1/responses');",
        "require('undici').fetch('https://api.openai.com/v1/responses');",
        "require('undici').request('https://api.openai.com/v1/responses');",
        "require('node-fetch')('https://api.openai.com/v1/responses');",
        "require('cross-fetch')('https://api.openai.com/v1/responses');",
        "require('unrelated').fetch('https://api.openai.com/v1/responses');",
        "require('unrelated')('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/direct-provider-transports.cjs",
    );
    const typedCommonJsMatches = violationsOfKind(
      "raw-provider-http",
      [
        "require('node:https').request('https://api.openai.com/v1/responses');",
        "require('node-fetch')('https://api.openai.com/v1/responses');",
        "function shadow(require: (name: string) => { request: (url: string) => void }) {",
        "  require('node:https').request('https://api.openai.com/v1/responses');",
        "}",
        "function localLoader() {",
        "  const require = (name: string) => ({ request: (_url: string) => name });",
        "  require('node:https').request('https://api.openai.com/v1/responses');",
        "}",
        "try {} catch (require) {",
        "  require('node:https').request('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "scripts/direct-provider-transports.cts",
    );

    expect(commonJsMatches.map((match) => match.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(typedCommonJsMatches.map((match) => match.line)).toEqual([1, 2]);
  });

  it("reports assigned CommonJS namespaces in TypeScript modules", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const https = require('node:https');",
        "const undici = require('undici');",
        "https.request('https://api.openai.com/v1/responses');",
        "undici.fetch('https://api.openai.com/v1/responses');",
        "function shadow(https: { request(url: string): void }) {",
        "  https.request('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "scripts/assigned-provider-transports.cts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 4]);
  });

  it("reports TypeScript import-equals transports and preserves unrelated shadows", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import https = require('node:https');",
        "import undici = require('undici');",
        "import providerFetch = require('node-fetch');",
        "import unrelated = require('unrelated');",
        "https.request('https://api.openai.com/v1/responses');",
        "undici.fetch('https://api.openai.com/v1/responses');",
        "providerFetch('https://api.openai.com/v1/responses');",
        "unrelated.request('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/import-equals-provider-transports.cts",
    );

    expect(matches.map((match) => match.line)).toEqual([5, 6, 7]);
  });

  it("reports literal dynamic-import transports in every scanned module extension", () => {
    const cases = [
      {
        expectedLines: [2],
        path: "scripts/dynamic-provider-transport.mjs",
        source: [
          "const { request: send } = await import('node:https');",
          "send('https://api.openai.com/v1/responses');",
        ].join("\n"),
      },
      {
        expectedLines: [2, 4],
        path: "scripts/dynamic-provider-transport.mts",
        source: [
          "const https = await import('node:https');",
          "https.request('https://api.openai.com/v1/responses');",
          "const { fetch: send } = await import('undici');",
          "send('https://api.linqapp.com/api/partner/v3/chats');",
        ].join("\n"),
      },
      {
        expectedLines: [2],
        path: "scripts/dynamic-provider-transport.cts",
        source: [
          "const undici = await import('undici');",
          "undici.fetch('https://api.openai.com/v1/responses');",
        ].join("\n"),
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        violationsOfKind("raw-provider-http", testCase.source, testCase.path)
          .map((match) => match.line),
        testCase.path,
      ).toEqual(testCase.expectedLines);
    }
  });

  it("reports default fetch exports from literal dynamic imports", () => {
    const cases = [
      {
        path: "scripts/dynamic-node-fetch.mjs",
        source: [
          "const { default: send } = await import('node-fetch');",
          "await send('https://api.openai.com/v1/responses');",
          "const nodeFetch = await import('node-fetch');",
          "await nodeFetch.default('https://api.openai.com/v1/responses');",
        ].join("\n"),
      },
      {
        path: "scripts/dynamic-cross-fetch.mts",
        source: [
          "const { default: send } = await import('cross-fetch');",
          "await send('https://api.openai.com/v1/responses');",
          "const crossFetch = await import('cross-fetch');",
          "await crossFetch.default('https://api.openai.com/v1/responses');",
        ].join("\n"),
      },
      {
        path: "scripts/dynamic-fetch-default.cts",
        source: [
          "const nodeFetch = await import('node-fetch');",
          "await nodeFetch.default('https://api.openai.com/v1/responses');",
          "const { default: send } = await import('cross-fetch');",
          "await send('https://api.openai.com/v1/responses');",
        ].join("\n"),
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        violationsOfKind("raw-provider-http", testCase.source, testCase.path)
          .map((match) => match.line),
        testCase.path,
      ).toEqual([2, 4]);
    }
  });

  it("reports direct, computed, defaulted, and rest dynamic fetch exports", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "await (await import('node-fetch')).default('https://api.openai.com/v1/responses');",
        "const { ['default']: computed } = await import('node-fetch');",
        "await computed('https://api.openai.com/v1/responses');",
        "const { default: defaulted = () => undefined } = await import('cross-fetch');",
        "await defaulted('https://api.openai.com/v1/responses');",
        "const { ...namespaceCopy } = await import('cross-fetch');",
        "await namespaceCopy.default('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/dynamic-fetch-variants.mjs",
    );

    expect(matches.map((match) => match.line)).toEqual([1, 3, 5, 7]);
  });

  it("does not infer HTTP transports from computed or unrelated dynamic imports", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const moduleName = 'node:https';",
        "const computed = await import(moduleName);",
        "computed.request('https://api.openai.com/v1/responses');",
        "const unrelated = await import('unrelated');",
        "unrelated.request('https://api.openai.com/v1/responses');",
        "unrelated.default('https://api.openai.com/v1/responses');",
        "const { default: localSend } = await import('unrelated');",
        "localSend('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/unrelated-dynamic-provider-transport.mjs",
    );

    expect(matches).toEqual([]);
  });

  it("recognizes provider SDK request objects through import-equals", () => {
    const matches = findProviderRequestBoundaryViolations(
      "scripts/import-equals-openai-client.cts",
      [
        "import OpenAI = require('openai');",
        "const base = { model: 'gpt-5' };",
        "const params: OpenAI.Responses.ResponseCreateParams = { ...base, input: 'hello' };",
      ].join("\n"),
    );

    expect(matches.map((match) => ({ kind: match.kind, line: match.line })))
      .toEqual([{ kind: "object-spread", line: 3 }]);
  });

  it("does not create a provider exception for Node streamed transfers", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "import { request as httpsRequest } from 'node:https';",
          "function putOpenAiPresignedPayload(input: { payload: Readable; openAiPresignedPutUrl: string }) {",
          "  const url = new URL(input.openAiPresignedPutUrl);",
          "  const clientRequest = httpsRequest(url, { method: 'PUT' }, () => undefined);",
          "  // input.payload.pipe(clientRequest);",
          "}",
        ].join("\n"),
        "apps/cloudflare/src/openai-presigned-upload.ts",
      ).map((match) => match.line),
    ).toEqual([4]);
  });

  it("allows SDK-backed business adapters while retaining provider wire declarations", () => {
    expect(
      violationsOfKind(
        "handwritten-provider-transport",
        [
          "import Kernel from '@onkernel/sdk';",
          "import type Stripe from 'stripe';",
          "import { Client } from '@temporalio/client';",
          "import { Retell } from 'retell-sdk';",
          "const KMS_ROOT = 'https://cloudkms.googleapis.com/v1';",
          "interface ComputerKernelClient { requestManagedAuthConnection(input: { url: string }): Promise<{ id: string }>; }",
          "class KernelComputerClient { async listManagedAuthConnections(): Promise<readonly string[]> { return []; } }",
          "interface HostedStripeLegacyUsageMigrationClient { fetchMigrationSummary(url: string): Promise<object>; }",
          "interface HostedRuntimeTemporalSignalClient { signalWithStart(workflowId: string): Promise<unknown>; }",
          "interface HostedRuntimeTemporalTerminationClient { terminate(reason: string): Promise<void>; }",
          "interface RetellPhoneCallAccountDeletionRuntime { deleteProviderCall(id: string): Promise<void>; }",
          "class RetellPhoneCallRuntime { async start(callId: string): Promise<void> {} }",
          "interface HostedGcpKmsClient { encrypt(input: { plaintext: Uint8Array; signal?: AbortSignal }): Promise<{ ciphertext: string }>; }",
          "interface HostedGcpAccessTokenProvider { getAccessToken(signal?: AbortSignal): Promise<string>; }",
          "class HostedLocalGcpKmsClient { async encrypt(plaintext: Uint8Array): Promise<Uint8Array> { return plaintext; } }",
          "interface GcpEncryptResponse { ciphertext?: string; name?: string; }",
        ].join("\n"),
        "apps/web/src/lib/provider-sdk-adapters.ts",
      ).map((match) => ({ boundary: match.boundary, line: match.line })),
    ).toEqual([{
      boundary: "Google Cloud KMS handwritten transport declaration GcpEncryptResponse",
      line: 16,
    }]);
  });

  it("does not mistake provider-named domain projections for transport contracts", () => {
    expect(
      findProviderRequestBoundaryViolations(
        "packages/contracts/src/provider-domain.ts",
        [
          "const OPENAI_API_URL = 'https://api.openai.com/v1/responses';",
          "interface OpenAIResponse {",
          "  status: 'ready' | 'failed';",
          "  internalMessageId: string;",
          "}",
          "interface OpenAIResponseProjection {",
          "  status: 'ready' | 'failed';",
          "  internalMessageId: string;",
          "}",
          "interface JunctionConnectionSummary {",
          "  connectedAt: string;",
          "  sourceId: string;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("requires a registered owner even for structurally safe byte uploads", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function uploadPresignedBytes(url: string, bytes: Uint8Array) {",
        "  await fetch(url, {",
        "    body: bytes,",
        "    headers: { 'content-type': 'application/octet-stream' },",
        "    method: 'PUT',",
        "  });",
        "  await fetch('https://api.linqapp.com/api/partner/v3/chats', { method: 'POST' });",
        "}",
      ].join("\n"),
      "apps/web/src/lib/linq/attachment-upload.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 7]);
  });

  it("requires a registered owner even for structurally safe byte downloads", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "async function downloadBytes(downloadUrl: string, fetchImpl: typeof fetch) {",
          "  const response = await fetchImpl(downloadUrl);",
          "  return new Uint8Array(await response.arrayBuffer());",
          "}",
        ].join("\n"),
        "apps/web/src/lib/linq/attachment-download.ts",
      ),
    ).toHaveLength(1);
  });

  it("does not exempt credential-bearing or provider-synthesized uploads", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function upload(uploadUrl: string, token: string) {",
        "  await fetch(uploadUrl, {",
        "    headers: { Authorization: `Bearer ${token}` },",
        "    method: 'PUT',",
        "  });",
        "  await fetch(uploadUrl, { credentials: 'include', method: 'PUT' });",
        "  const providerUploadUrl = 'https://api.linqapp.com/api/partner/v3/uploads';",
        "  await fetch(providerUploadUrl, { method: 'PUT' });",
        "}",
      ].join("\n"),
      "apps/web/src/lib/linq/attachment-upload.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 6, 8]);
  });

  it("requires static credentials, headers, and binary bodies for presigned transfers", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function upload(uploadUrl: string, openAiUploadUrl: string, bytes: Uint8Array, credentials: RequestCredentials, headerName: string) {",
        "  await fetch(uploadUrl, { body: bytes, credentials, method: 'PUT' });",
        "  await fetch(uploadUrl, { body: bytes, headers: { [headerName]: 'secret' }, method: 'PUT' });",
        "  await fetch(uploadUrl, { body: JSON.stringify({ bytes }), method: 'PUT' });",
        "  await fetch(openAiUploadUrl, { body: bytes, method: 'PUT' });",
        "}",
        "async function uploadBytes(uploadUrl: string, bytes: Uint8Array, requiredHeaders: Record<string, string>) {",
        "  await fetch(uploadUrl, { body: new Blob([bytes]), credentials: 'omit', headers: requiredHeaders, method: 'PUT' });",
        "}",
      ].join("\n"),
      "apps/web/src/lib/linq/attachment-upload.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3, 4, 5, 8]);
  });

  it("does not trust mutable aliases for presigned URLs, init, or headers", () => {
    const matches = rawHttpViolations(
      [
        "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
        "function normalizeLinqAttachmentUploadUrl(url: string) { return url; }",
        "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
        "  let uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
        "  uploadUrl = 'https://api.linqapp.com/v1/messages';",
        "  const headers = normalizeLinqRequiredHeaders(input.requiredHeaders);",
        "  headers.authorization = 'Bearer provider-token';",
        "  await fetch(uploadUrl, { body: input.bytes, headers, method: 'PUT' });",
        "  const safeUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
        "  const init = { body: input.bytes, headers: normalizeLinqRequiredHeaders(input.requiredHeaders), method: 'PUT' };",
        "  await fetch(safeUrl, init);",
        "}",
      ].join("\n"),
      "packages/operator-config/src/linq-runtime.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([8, 11]);
  });

  it("rejects spread transfer init and spelling-only binary bodies", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function upload(uploadUrl: string, options: RequestInit, payload: { arrayBuffer(): ArrayBuffer }) {",
        "  await fetch(uploadUrl, ...[options]);",
        "  await fetch(uploadUrl, { body: payload.arrayBuffer(), method: 'PUT' });",
        "}",
        "async function shadowed(uploadUrl: string, Blob: new (parts: unknown[]) => object, Uint8Array: new (bytes: number[]) => { buffer: ArrayBuffer }, Buffer: { from(value: unknown): object }, Readable: { from(value: unknown): object }) {",
        "  await fetch(uploadUrl, { body: new Blob([]), method: 'PUT' });",
        "  await fetch(uploadUrl, { body: new Uint8Array([]).buffer, method: 'PUT' });",
        "  await fetch(uploadUrl, { body: Buffer.from('json'), method: 'PUT' });",
        "  await fetch(uploadUrl, { body: Readable.from('json'), method: 'PUT' });",
        "}",
        "async function proven(uploadUrl: string, bytes: Uint8Array) {",
        "  await fetch(uploadUrl, { body: new Blob([bytes]), method: 'PUT' });",
        "  await fetch(uploadUrl, { body: new Uint8Array(bytes).buffer, method: 'PUT' });",
        "}",
      ].join("\n"),
      "apps/web/src/lib/linq/attachment-upload.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3, 6, 7, 8, 9, 12, 13]);
  });

  it("rejects name-only presigned transfer factories and shadowed factories", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "function normalizeLinqAttachmentUploadUrl(url: string) { return url; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  const uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
          "  await fetch(uploadUrl, { body: input.bytes, headers: normalizeLinqRequiredHeaders(input.requiredHeaders), method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).toEqual([5]);
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "function normalizeLinqAttachmentUploadUrl(url: string) { return url; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  const uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
          "  await fetch(uploadUrl, { body: input.bytes, headers: normalizeOtherRequiredHeaders(input.requiredHeaders), method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).toEqual([5]);

    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "function normalizeLinqAttachmentUploadUrl(url: string) { return url; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  const uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
          "  function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return { authorization: headers.authorization }; }",
          "  await fetch(uploadUrl, { body: input.bytes, headers: normalizeLinqRequiredHeaders(input.requiredHeaders), method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).toEqual([6]);
  });

  it("keeps the actual Linq presigned byte upload outside migration findings", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        readFileSync("packages/operator-config/src/linq-runtime.ts", "utf8"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).not.toContain(886);
  });

  it("admits only the exact production SDK transport hooks", () => {
    const owners = [
      "apps/cloudflare/src/database-health/monitor.ts",
      "apps/web/src/lib/connected-apps/composio.ts",
      "apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts",
      "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts",
      "apps/web/src/lib/labs/junction.ts",
      "apps/web/src/lib/linq/api.ts",
      "apps/web/src/lib/physical-notes/lob-runtime.ts",
      "packages/assistant-engine/src/assistant/channels/runtime.ts",
      "packages/assistant-engine/src/assistant-codex/openai-image-generation.ts",
      "packages/cli/src/research-scout-client.ts",
      "packages/device-syncd/src/providers/junction-client.ts",
      "packages/operator-config/src/elevenlabs-runtime.ts",
      "packages/operator-config/src/linq-runtime.ts",
    ] as const;

    for (const relativePath of owners) {
      expect(
        rawHttpViolations(
          readFileSync(relativePath, "utf8"),
          relativePath,
        ),
      ).toEqual([]);
    }
  });

  it("rejects implementation and wiring mutations in official SDK transport adapters", () => {
    const cases = [
      {
        after: "redirect: \"follow\",",
        before: "redirect: \"manual\",",
        path: "apps/cloudflare/src/operator-alert/linq.ts",
      },
      {
        after: "request,",
        before: "preserveRepeatedComposioListQueryParams(request),",
        path: "apps/web/src/lib/connected-apps/composio.ts",
      },
      {
        after: "body: 'override',",
        before: "body: init.body,",
        path: "packages/assistant-engine/src/assistant/channels/runtime.ts",
      },
      {
        after: "fetchImpl.call(undefined, new URL(String(request)), init)",
        before: "fetchImpl.call(undefined, request, init)",
        path:
          "apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts",
      },
      {
        after: "cache: \"reload\",",
        before: "cache: \"no-store\",",
        path: "apps/web/src/lib/labs/junction.ts",
      },
      {
        after: "const target = new URL(String(input));",
        before: "const target = mapLinqSdkRequestUrl(input, apiRoot);",
        path: "apps/web/src/lib/linq/api.ts",
      },
      {
        after: "method,\n      redirect: \"follow\",\n      signal,",
        before: "method,\n      redirect: \"error\",\n      signal,",
        path: "apps/web/src/lib/physical-notes/lob-runtime.ts",
      },
      {
        after: "fetchImpl.call(undefined, new URL(String(request)), init)",
        before: "fetchImpl.call(undefined, request, init)",
        path:
          "packages/assistant-engine/src/assistant-codex/openai-image-generation.ts",
      },
      {
        after: "this.fetchImpl(new URL(String(input)), {",
        before: "this.fetchImpl(input, {",
        path: "packages/device-syncd/src/providers/junction-client.ts",
      },
      {
        after:
          "method: init?.method ?? request?.method ?? 'GET',\n        redirect: 'follow',",
        before:
          "method: init?.method ?? request?.method ?? 'GET',\n        redirect: 'error',",
        path: "packages/operator-config/src/elevenlabs-runtime.ts",
      },
      {
        after: "method: 'POST',",
        before: "method: requestMethod || 'GET',",
        path: "packages/operator-config/src/linq-runtime.ts",
      },
      {
        after: "fetch: input.fetchImplementation && createOperatorLinqFetch(",
        before: "fetch: createOperatorLinqFetch(",
        path: "apps/cloudflare/src/operator-alert/linq.ts",
      },
      {
        after: "baseOptions.adapter = input.fetchImpl as LobAxiosAdapter;",
        before:
          "baseOptions.adapter = createLobFetchAdapter(input.fetchImpl, input.signal);",
        path: "apps/web/src/lib/physical-notes/lob-runtime.ts",
      },
      {
        after: "fetch: globalThis.fetch,",
        before: "fetch: sdkFetch,",
        path: "packages/device-syncd/src/providers/junction-client.ts",
      },
    ] as const;

    for (const testCase of cases) {
      const source = readFileSync(testCase.path, "utf8");
      expect(
        rawHttpViolations(
          replaceRequired(source, testCase.before, testCase.after),
          testCase.path,
        ),
        testCase.path,
      ).toHaveLength(1);
    }
  });

  it("rejects duplicate adapters, duplicate effects, and decoy SDK wiring", () => {
    const relativePath = "apps/web/src/lib/connected-apps/composio.ts";
    const source = readFileSync(relativePath, "utf8");
    const duplicatedEffect = replaceRequired(
      source,
      [
        "    const response = await fetchImpl(",
        "      preserveRepeatedComposioListQueryParams(request),",
        "      init,",
        "    );",
      ].join("\n"),
      [
        "    const response = await fetchImpl(",
        "      preserveRepeatedComposioListQueryParams(request),",
        "      init,",
        "    );",
        "    await fetchImpl(request, init);",
      ].join("\n"),
    );
    expect(rawHttpViolations(duplicatedEffect, relativePath)).toHaveLength(2);

    const duplicatedOwner = [
      source,
      "{",
      "function createBoundedComposioFetch(fetchImpl: typeof fetch): typeof fetch {",
      "  return fetchImpl;",
      "}",
      "}",
    ].join("\n");
    expect(rawHttpViolations(duplicatedOwner, relativePath)).toHaveLength(1);

    const decoyWiring = [
      replaceRequired(
        source,
        "fetch: createBoundedComposioFetch(fetchImpl),",
        "fetch: fetchImpl,",
      ),
      "const composioWiringDecoy = { fetch: createBoundedComposioFetch(fetchImpl) };",
    ].join("\n");
    expect(rawHttpViolations(decoyWiring, relativePath)).toHaveLength(1);
  });

  it("rejects authority-helper, SDK-binding, and exclusive-consumer mutations", () => {
    const relativePath = "apps/web/src/lib/connected-apps/composio.ts";
    const source = readFileSync(relativePath, "utf8");
    const helperRedirect = replaceRequired(
      source,
      "const url = new URL(requestUrl);",
      "const url = new URL('https://api.openai.com/v1/responses');",
    );
    expect(rawHttpViolations(helperRedirect, relativePath)).toHaveLength(1);

    const localSdkReplacement = replaceRequired(
      source,
      "import Composio, { APIConnectionError, APIError } from \"@composio/client\";",
      [
        "import type ComposioSdk from \"@composio/client\";",
        "import { APIConnectionError, APIError } from \"@composio/client\";",
        "class Composio { constructor(_input: unknown) { void (null as unknown as ComposioSdk); } }",
      ].join("\n"),
    );
    expect(rawHttpViolations(localSdkReplacement, relativePath)).toHaveLength(1);

    const sideEffectSdkImport = replaceRequired(
      source,
      "import Composio, { APIConnectionError, APIError } from \"@composio/client\";",
      [
        "import \"@composio/client\";",
        "import { APIConnectionError, APIError } from \"@composio/client\";",
        "class Composio { constructor(_input: unknown) {} }",
      ].join("\n"),
    );
    expect(rawHttpViolations(sideEffectSdkImport, relativePath)).toHaveLength(1);

    const secondConsumer = [
      source,
      "const leakedComposioFetch = createBoundedComposioFetch(fetch);",
    ].join("\n");
    expect(rawHttpViolations(secondConsumer, relativePath)).toHaveLength(1);
  });

  it("rejects presigned transfer authority mutations and additional owners", () => {
    const relativePath = "packages/operator-config/src/linq-runtime.ts";
    const source = readFileSync(relativePath, "utf8");
    const credentialInjection = replaceRequired(
      source,
      "const normalized: Record<string, string> = {}",
      "const normalized: Record<string, string> = { authorization: 'Bearer injected' }",
    );
    expect(rawHttpViolations(credentialInjection, relativePath)).toHaveLength(1);

    const urlMutation = replaceRequired(
      source,
      "return parsed.toString()",
      "return input.uploadUrl",
    );
    expect(rawHttpViolations(urlMutation, relativePath)).toHaveLength(1);

    const secondOwner = [
      source,
      "async function uploadLinqAttachmentBytesAgain(uploadUrl: string, bytes: Uint8Array) {",
      "  await fetch(uploadUrl, { body: bytes, method: 'PUT' });",
      "}",
    ].join("\n");
    expect(rawHttpViolations(secondOwner, relativePath)).toHaveLength(1);

    const normalizedSecondOwner = [
      source,
      "async function uploadLinqAttachmentBytesAgain(input: { bytes: Uint8Array; uploadUrl: string }) {",
      "  const uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl);",
      "  await fetch(uploadUrl, { body: input.bytes, method: 'PUT' });",
      "}",
    ].join("\n");
    expect(rawHttpViolations(normalizedSecondOwner, relativePath)).toHaveLength(
      1,
    );

    const duplicateEffect = replaceRequired(
      source,
      "  const timeout = createTimeoutAbortController(",
      [
        "  await fetchImplementation(uploadUrl, {",
        "    body,",
        "    headers: normalizeLinqRequiredHeaders(input.requiredHeaders),",
        "    method: 'PUT',",
        "    redirect: 'error',",
        "  })",
        "  const timeout = createTimeoutAbortController(",
      ].join("\n"),
    );
    expect(rawHttpViolations(duplicateEffect, relativePath).length).toBeGreaterThan(
      0,
    );
  });

  it("requires the Resend override to pass one direct closed request init", () => {
    const relativePath =
      "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts";
    const source = readFileSync(relativePath, "utf8");
    const directInit = [
      "      {",
      "        body: options.body,",
      "        headers: normalizeResendRequestHeaders(options.headers),",
      "        method: options.method,",
      "        redirect: \"error\",",
      "        signal: this.requestSignal,",
      "      },",
    ].join("\n");
    const unsafeInits = [
      [
        "      (() => {",
        "        const requestInit: RequestInit = {",
        "          body: options.body,",
        "          headers: normalizeResendRequestHeaders(options.headers),",
        "          method: options.method,",
        "          redirect: \"error\",",
        "          signal: this.requestSignal,",
        "        };",
        "        const forwarded = requestInit;",
        "        forwarded.body = JSON.stringify({ override: true });",
        "        return requestInit;",
        "      })(),",
      ].join("\n"),
      [
        "      (() => {",
        "        const requestInit: RequestInit = {",
        "          body: options.body,",
        "          headers: normalizeResendRequestHeaders(options.headers),",
        "          method: options.method,",
        "          redirect: \"error\",",
        "          signal: this.requestSignal,",
        "        };",
        "        const mutate = (value: RequestInit) => { value.method = \"GET\"; };",
        "        mutate(requestInit);",
        "        return requestInit;",
        "      })(),",
      ].join("\n"),
      "      Object.assign({}, { body: options.body, headers: normalizeResendRequestHeaders(options.headers), method: options.method, redirect: \"error\", signal: this.requestSignal }),",
      "      { ...options, headers: normalizeResendRequestHeaders(options.headers), redirect: \"error\", signal: this.requestSignal },",
      "      { [\"body\"]: options.body, headers: normalizeResendRequestHeaders(options.headers), method: options.method, redirect: \"error\", signal: this.requestSignal },",
      "      { body: options.body, body: options.body, headers: normalizeResendRequestHeaders(options.headers), method: options.method, redirect: \"error\", signal: this.requestSignal },",
    ] as const;

    for (const unsafeInit of unsafeInits) {
      expect(
        rawHttpViolations(
          replaceRequired(source, directInit, unsafeInit),
          relativePath,
        ),
      ).toHaveLength(1);
    }
  });

  it("rejects path, method, body, and SDK ownership mutations in gap overrides", () => {
    const cases = [
      {
        after: "`${this.baseUrl}${path}`",
        before: "`${this.baseUrl}${requestPath}`",
        path: "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts",
      },
      {
        after: "method: \"GET\",",
        before: "method: options.method,",
        path: "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts",
      },
      {
        after: "'https://api.exa.ai/contents'",
        before: "'https://api.exa.ai/search'",
        path: "packages/cli/src/research-scout-client.ts",
      },
      {
        after: "method: 'GET',",
        before: "method: 'POST',",
        path: "packages/cli/src/research-scout-client.ts",
      },
      {
        after: "body: JSON.stringify({ query: 'override' }),",
        before: "body: JSON.stringify(body),",
        path: "packages/cli/src/research-scout-client.ts",
      },
      {
        after: "class RunnerScopedExaClient extends Resend {",
        before: "class RunnerScopedExaClient extends Exa {",
        path: "packages/cli/src/research-scout-client.ts",
      },
    ] as const;

    for (const testCase of cases) {
      const source = readFileSync(testCase.path, "utf8");
      expect(
        rawHttpViolations(
          replaceRequired(source, testCase.before, testCase.after),
          testCase.path,
        ),
      ).toHaveLength(1);
    }
  });

  it("keeps every registered production byte or stream transfer outside migration findings", () => {
    const owners = [
      ["apps/cloudflare/src/container-entrypoint.ts", 1646],
      ["apps/web/src/lib/hosted-onboarding/linq-client.ts", 848],
      ["apps/web/src/lib/hosted-onboarding/linq-contact-card.ts", 589],
      ["packages/assistant-runtime/src/hosted-runtime/events/linq.ts", 490],
    ] as const;

    for (const [relativePath, line] of owners) {
      expect(
        violationsOfKind(
          "raw-provider-http",
          readFileSync(relativePath, "utf8"),
          relativePath,
        ).map((match) => match.line),
      ).not.toContain(line);
    }
  });

  it("does not inherit a transfer allowance through a duplicate owner name", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function downloadHostedLinqAttachmentBytes(url: string, input: { fetchImplementation: typeof fetch }) {",
        "  await input.fetchImplementation(url);",
        "}",
        "function shadow() {",
        "  async function downloadHostedLinqAttachmentBytes(url: string, input: { fetchImplementation: typeof fetch }) {",
        "    await input.fetchImplementation(url);",
        "  }",
        "}",
      ].join("\n"),
      "packages/assistant-runtime/src/hosted-runtime/events/linq.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 6]);
  });

  it("reports provider-bearing incoming Requests without a path exception", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function proxy(input: { openaiRequest: Request }) {",
        "  await fetch(input.openaiRequest);",
        "  await fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/hosted-runner-egress-proxy.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3]);
  });

  it("reports every provider-bearing incoming Request forwarding shape", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function proxy(input: { openaiRequest: Request }, init: RequestInit) {",
        "  await fetch(input.openaiRequest);",
        "  await fetch(input.openaiRequest, init);",
        "  await fetch(input.openaiRequest, { signal: AbortSignal.timeout(1000) });",
        "  await fetch(input.openaiRequest, ...[init]);",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/hosted-runner-egress-proxy.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3, 4, 5]);
  });

  it("fails closed when SMART/FHIR traffic shares explicit provider file evidence", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function readFhir(fhirEndpoint: string, fetchImpl: typeof fetch) {",
        "  await fetchImpl(fhirEndpoint);",
        "  await fetchImpl('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "apps/web/src/lib/clinical-records/smart.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3]);
  });

  it("does not exempt provider-named parameters or config in SMART/FHIR code", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function readFhir(input: { fhirEndpoint: string; openAiApiRoot: string }, fetchImpl: typeof fetch) {",
        "  await fetchImpl(input.fhirEndpoint);",
        "  await fetchImpl(input.openAiApiRoot);",
        "  await fetchImpl(process.env.OPENAI_API_ROOT!);",
        "}",
        "async function readProvider(openAiEndpoint: string, fetchImpl: typeof fetch) {",
        "  await fetchImpl(openAiEndpoint);",
        "}",
      ].join("\n"),
      "apps/web/src/lib/clinical-records/smart.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 4, 7]);
  });

  it("does not erase provider facts in object-form SMART/FHIR requests", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import { request } from 'node:https';",
        "const openAiHost = 'api.openai.com';",
        "const fhirPath = '/v1/responses';",
        "request({ hostname: openAiHost, path: fhirPath });",
      ].join("\n"),
      "apps/web/src/lib/smart-fhir/provider-transport.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([4]);
  });

  it("keeps actual generic runner and SMART traffic outside provider candidates", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        readFileSync("apps/cloudflare/src/runner-egress-intercept.ts", "utf8"),
        "apps/cloudflare/src/runner-egress-intercept.ts",
      ),
    ).toEqual([]);
    expect(
      violationsOfKind(
        "raw-provider-http",
        readFileSync("apps/web/src/lib/clinical-records/smart.ts", "utf8"),
        "apps/web/src/lib/clinical-records/smart.ts",
      ),
    ).toEqual([]);
  });

  it("keeps no-verified-SDK providers explicit and rejects general xAI HTTP", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "fetch('https://api.telegram.org/bot123/sendMessage');",
        "fetch('https://api.x.ai/v1/chat/completions');",
        "fetch('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/provider-exceptions.mjs",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3]);
    expect(
      providerBoundaryRegistry.find((provider) => provider.id === "xai")?.rawHttpPolicy,
    ).toBe("require-official-sdk");
    expect(
      providerBoundaryRegistry.find((provider) => provider.id === "telegram")?.rawHttpPolicy,
    ).toBe("allow-no-verified-sdk");
  });

  it("allows only the path-scoped xAI Responses x_search request", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function search(fetchImpl: typeof fetch) {",
        "  await fetchImpl('https://api.x.ai/v1/responses', {",
        "    body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }),",
        "    method: 'POST',",
        "  });",
        "  await fetchImpl('https://api.x.ai/v1/responses', {",
        "    body: JSON.stringify({ store: false, tools: [{ type: 'web_search' }] }),",
        "    method: 'POST',",
        "  });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([6]);
  });

  it("rejects identifier-bound and reassigned xAI request values", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function search(fetchImpl: typeof fetch, configuredEndpoint: string) {",
        "  const requestInit: RequestInit = { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' };",
        "  await fetchImpl('https://api.x.ai/v1/responses', requestInit);",
        "  requestInit.body = JSON.stringify({ store: true, tools: [{ type: 'x_search' }] });",
        "  await fetchImpl('https://api.x.ai/v1/responses', requestInit);",
        "  let endpoint = 'https://api.x.ai/v1/responses';",
        "  endpoint = configuredEndpoint;",
        "  await fetchImpl(endpoint, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "  await fetchImpl(configuredEndpoint ? 'https://api.x.ai/v1/responses' : endpoint, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 5, 8, 9]);
  });

  it("admits only the direct production xAI exception request", () => {
    const source = readFileSync(
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
      "utf8",
    );

    expect(
      violationsOfKind(
        "raw-provider-http",
        source,
        "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
      ),
    ).toEqual([]);
    expect(
      source.match(/fetchImpl\('https:\/\/api\.x\.ai\/v1\/responses', \{/gu),
    ).toHaveLength(1);
  });

  it("rejects effective-value overrides in the path-scoped xAI exception", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const initOverrides = {};",
        "const payloadOverrides = {};",
        "const toolOverrides = {};",
        "const computedMethod = 'method';",
        "const computedStore = 'store';",
        "const computedType = 'type';",
        "async function search(fetchImpl: typeof fetch) {",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', ...initOverrides });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], ...payloadOverrides }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', ...toolOverrides }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', [computedMethod]: 'GET' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], [computedStore]: true }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', [computedType]: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', method: 'GET' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', body: JSON.stringify({ store: true, tools: [] }) });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, store: true, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], tools: [{ type: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', type: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }, null), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], toJSON() { return { store: true, tools: [] }; } }), method: 'POST' });",
        "  await fetchImpl('https://api.x.ai/v1/responses', { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], __proto__: { toJSON() { return { store: true, tools: [] }; } } }), method: 'POST' });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });

  it("rejects a shadowed JSON serializer in the path-scoped xAI exception", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';",
        "async function search(fetchImpl: typeof fetch) {",
        "  const JSON = { stringify: (_payload: unknown) => '{\"store\":true}' };",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([4]);
  });

  it("rejects destructured JSON, URL, and location parameter shadows", () => {
    const xaiMatches = violationsOfKind(
      "raw-provider-http",
      [
        "const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';",
        "async function search({ JSON }: { JSON: { stringify(value: unknown): string } }, fetchImpl: typeof fetch) {",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );
    const internalMatches = violationsOfKind(
      "raw-provider-http",
      [
        "async function sendWithLocalUrl({ URL }: { URL: typeof globalThis.URL }) {",
        "  await fetch(new URL('/v1/responses', location.origin));",
        "}",
        "async function sendWithLocalLocation({ location }: { location: Location }) {",
        "  await fetch(new URL('/v1/responses', location.origin));",
        "}",
      ].join("\n"),
      "apps/web/src/lib/openai/destructured-internal-globals.ts",
    );

    expect(xaiMatches.map((match) => match.line)).toEqual([3]);
    expect(internalMatches.map((match) => match.line)).toEqual([2, 5]);
  });

  it("registers the known verified-SDK bypass inventory explicitly", () => {
    const registeredIds = new Set(providerBoundaryRegistry.map((provider) => provider.id));
    expect([
      "junction",
      "linq",
      "openai",
      "agentmail",
      "resend",
      "elevenlabs",
      "exa",
      "lob",
      "google-cloud-kms",
      "google-sts",
      "google-iam-credentials",
    ].every((providerId) => registeredIds.has(providerId))).toBe(true);
  });

  it("keeps the purpose-specific exception registry auditable", () => {
    expect(providerHttpExceptionRegistry.map((entry) => entry.id)).toEqual([
      "presigned-byte-transfer",
      "internal-same-origin",
      "xai-x-search-responses",
      "official-sdk-fetch-hook",
      "resend-sdk-fetch-request-override",
      "exa-sdk-request-override",
    ]);
  });

  it("assigns canonical provider hosts to the correct registry owner", () => {
    expect(
      providerBoundaryRegistry.find((provider) => provider.id === "retell")?.hosts,
    ).toContain("api.retellai.com");
    expect(
      providerBoundaryRegistry.find((provider) => provider.id === "kernel")?.hosts,
    ).not.toContain("api.retellai.com");
    expect(
      providerBoundaryRegistry.find((provider) => provider.id === "composio")?.hosts,
    ).toContain("backend.composio.dev");
  });

  it("allows provider-adjacent internal traffic without treating request.url as same-origin", () => {
    const source = [
      "const endpoint = '/api/openai/status';",
      "fetch(endpoint);",
      "fetch(new URL('/api/linq/status', location.origin));",
      "fetch('http://localhost:3000/api/junction/status');",
      "async function replay(input: { request: Request }) {",
      "  await fetch(input.request.url);",
      "  await fetch(new URL('/api/openai/status', input.request.url));",
      "  const request = { url: 'https://api.openai.com' };",
      "  await fetch(new URL('/v1/responses', request.url));",
      "  const location = { origin: 'https://api.openai.com' };",
      "  await fetch(new URL('/v1/responses', location.origin));",
      "  const URL = class { constructor(_path: string, _base: string) { return 'https://api.openai.com/v1/responses'; } };",
      "  await fetch(new URL('/v1/responses', globalThis.location.origin));",
      "}",
    ].join("\n");

    expect(
      violationsOfKind(
        "raw-provider-http",
        source,
        "apps/web/src/lib/openai/internal-status.ts",
      ).map((match) => match.line),
    ).toEqual([6, 7, 9, 11, 13]);
  });

  it("accumulates provider evidence and rejects network-path URLs", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const telegramUrl = 'https://api.openai.com/v1/responses';",
        "fetch(telegramUrl);",
        "async function replay(input: { request: Request }) {",
        "  await fetch(new URL('//api.openai.com/v1/responses', input.request.url));",
        "  const openAiNetworkPath = '\\\\api.openai.com/v1/responses';",
        "  await fetch(new URL(openAiNetworkPath, input.request.url));",
        "  const openAiInternalPath = '/api/responses';",
        "  await fetch(new URL(openAiInternalPath, input.request.url));",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/provider-url-resolution.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 4, 6, 8]);
  });

  it("rejects network paths composed through template interpolation", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function replay(input: { request: Request }) {",
        "  const openAiNetworkPath = '/api.openai.com/v1/responses';",
        "  await fetch(new URL(`/${openAiNetworkPath}`, input.request.url));",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/provider-url-resolution.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("accumulates provider facts from computed origins and provider-bound transports", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const providerOrigins = { openai: 'https://api.openai.com', linq: 'https://api.linqapp.com' };",
        "const providerKey = Math.random() > 0.5 ? 'openai' : 'linq';",
        "fetch(new URL('/v1/responses', providerOrigins[providerKey]));",
        "const config = { origins: { primary: 'https://example.invalid' } };",
        "const OPENAI_ORIGIN_KEY = 'primary';",
        "fetch(new URL('/v1/responses', config.origins[OPENAI_ORIGIN_KEY]));",
        "async function send(openAiFetch: typeof fetch) {",
        "  await openAiFetch('/v1/responses', { method: 'POST' });",
        "}",
        "fetch('/api/openai/status');",
        "const origins = ['https://api.openai.com', 'https://api.linqapp.com'] as const;",
        "fetch(new URL('/v1/responses', origins[Math.random() > 0.5 ? 0 : 1]));",
      ].join("\n"),
      "apps/web/src/lib/provider-dispatch.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 6, 8, 12]);
  });

  it("does not inherit provider facts through static response members or internal handlers", () => {
    const staticMemberMatches = violationsOfKind(
      "raw-provider-http",
      [
        "declare function parseLinqResponse(): { upload_url: string };",
        "const created = parseLinqResponse();",
        "fetch(created.upload_url, { body: new Uint8Array([1]).buffer, method: 'PUT' });",
      ].join("\n"),
      "apps/web/src/lib/attachment-upload.ts",
    );
    const internalHandlerMatches = violationsOfKind(
      "raw-provider-http",
      [
        "type OutboundHandler = (request: Request) => Promise<Response>;",
        "declare const openAiHandler: OutboundHandler;",
        "async function wrap(request: Request) {",
        "  return openAiHandler(request);",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/hosted-local-test/runner-container.ts",
    );

    expect(staticMemberMatches).toEqual([]);
    expect(internalHandlerMatches).toEqual([]);
  });

  it("follows exact static properties in local provider route maps", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const routes = {",
        "  responses: 'https://api.openai.com/v1/responses',",
        "  messages: 'https://api.linqapp.com/api/partner/v3/chats',",
        "  nested: { image: 'https://api.openai.com/v1/images' },",
        "} as const;",
        "fetch(routes.responses, { method: 'POST' });",
        "fetch(routes.messages, { method: 'POST' });",
        "fetch(routes.nested.image, { method: 'POST' });",
        "const created = await createAttachment();",
        "fetch(created.upload_url, { method: 'PUT' });",
      ].join("\n"),
      "apps/web/src/lib/provider-route-map.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([6, 7, 8]);
  });

  it("infers provider endpoints returned by same-file URL helpers", () => {
    const source = [
      "function makeTarget() {",
      "  return 'https://api.openai.com/v1/responses';",
      "}",
      "function chooseTarget(flag) {",
      "  return flag ? '/internal' : 'https://api.openai.com/v1/images';",
      "}",
      "await fetch(makeTarget(), { method: 'POST' });",
      "await fetch(chooseTarget(Date.now() > 0), { method: 'POST' });",
    ].join("\n");

    for (const relativePath of [
      "scripts/local-provider-url-helpers.mjs",
      "scripts/local-provider-url-helpers.mts",
    ]) {
      const matches = rawHttpViolations(source, relativePath);
      expect(matches.map((match) => match.line)).toEqual([7, 8]);
    }
  });

  it("keeps internal, shadowed, nested, and recursive URL helpers clean", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "function makeTarget() {",
        "  return '/internal';",
        "}",
        "await fetch(makeTarget(), { method: 'POST' });",
        "function recursiveTarget() {",
        "  return recursiveTarget();",
        "}",
        "await fetch(recursiveTarget(), { method: 'POST' });",
        "function outerTarget() {",
        "  function nestedTarget() {",
        "    return 'https://api.openai.com/v1/responses';",
        "  }",
        "  return '/internal';",
        "}",
        "await fetch(outerTarget(), { method: 'POST' });",
        "function shadowedTarget() {",
        "  return 'https://api.openai.com/v1/responses';",
        "}",
        "async function invoke(shadowedTarget) {",
        "  await fetch(shadowedTarget(), { method: 'POST' });",
        "}",
        "await invoke(() => '/internal');",
        "{",
        "  const shadowedTarget = () => '/internal';",
        "  await fetch(shadowedTarget(), { method: 'POST' });",
        "}",
        "async function copyRequest(request: Request) {",
        "  return new Request(request.url);",
        "}",
        "async function forward(handler: typeof fetch, request: Request) {",
        "  const copied = await copyRequest(request);",
        "  await handler(copied);",
        "}",
      ].join("\n"),
      "scripts/local-url-helper-negatives.mts",
    );

    expect(matches).toEqual([]);
  });

  it("fails closed for provider-bearing fetch argument spreads", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const requestArgs: Parameters<typeof fetch> = ['https://api.openai.com/v1/responses', { method: 'POST' }];",
        "fetch(...requestArgs);",
        "const internalArgs: Parameters<typeof fetch> = ['/api/status'];",
        "fetch(...internalArgs);",
        "async function relay(openAiFetch: typeof fetch, args: Parameters<typeof fetch>) {",
        "  await openAiFetch(...args);",
        "}",
        "async function exceptions(openAiFetch: typeof fetch, openAiRequest: Request, openAiUploadArgs: Parameters<typeof fetch>) {",
        "  await fetch(...[openAiRequest]);",
        "  await fetch(...openAiUploadArgs);",
        "  await openAiFetch(...['https://api.x.ai/v1/responses', { method: 'POST' }]);",
        "}",
      ].join("\n"),
      "apps/cloudflare/src/provider-request-proxy.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 6, 9, 10, 11]);
  });

  it("follows defaulted, assigned, and exact forwarding fetch transports", () => {
    const untypedMatches = violationsOfKind(
      "raw-provider-http",
      [
        "async function defaulted(fetchImpl = fetch) {",
        "  await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST' });",
        "}",
        "let send;",
        "send = globalThis.fetch;",
        "await send('https://api.openai.com/v1/responses', { method: 'POST' });",
      ].join("\n"),
      "scripts/provider-transports.mjs",
    );
    const wrapperMatches = violationsOfKind(
      "raw-provider-http",
      [
        "const send = (url, init) => fetch(url, init);",
        "const openAiUrl = process.env.PROVIDER_URL;",
        "await send(openAiUrl, { method: 'POST' });",
        "const reordered = (url, init) => fetch(init, url);",
        "await reordered(openAiUrl, { method: 'POST' });",
        "const altered = (url, init) => fetch(`${url}/responses`, init);",
        "await altered(openAiUrl, { method: 'POST' });",
        "const callback = (url, init) => ({ url, init });",
        "callback(openAiUrl, { method: 'POST' });",
        "let reassigned = globalThis.fetch;",
        "reassigned = callback;",
        "await reassigned(openAiUrl, { method: 'POST' });",
        "let scoped;",
        "if (openAiUrl) { scoped = globalThis.fetch; }",
        "await scoped(openAiUrl, { method: 'POST' });",
      ].join("\n"),
      "apps/web/src/lib/provider-transports.ts",
    );
    const typedMatches = violationsOfKind(
      "raw-provider-http",
      [
        "async function defaulted(fetchImpl = globalThis.fetch) {",
        "  await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST' });",
        "}",
        "let send: typeof fetch;",
        "send = fetch;",
        "await send('https://api.openai.com/v1/responses', { method: 'POST' });",
      ].join("\n"),
      "apps/web/src/lib/openai/provider-transports.ts",
    );

    expect(untypedMatches.map((match) => match.line)).toEqual([2, 6]);
    expect(wrapperMatches.map((match) => match.line)).toEqual([3, 15]);
    expect(typedMatches.map((match) => match.line)).toEqual([2, 6]);
  });

  it("composes statically bound transport arguments and fails closed on opaque binds", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await send();",
        "const onlyThis = globalThis.fetch.bind(undefined);",
        "await onlyThis('https://api.openai.com/v1/responses');",
        "const mixed = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await mixed(undefined);",
        "const internal = globalThis.fetch.bind(undefined);",
        "await internal('/api/status');",
        "const args = ['https://api.openai.com/v1/responses'] as const;",
        "const opaque = globalThis.fetch.bind(undefined, ...args);",
        "await opaque();",
        "const unrelated = ((url: string) => url).bind(undefined, 'https://api.openai.com/v1/responses');",
        "unrelated();",
        "const applied = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await applied.apply(undefined, []);",
        "class OpenAiTransport {",
        "  send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "  async run() { await this.send(); }",
        "}",
      ].join("\n"),
      "scripts/bound-provider-transports.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 4, 6, 11, 15, 18]);
  });

  it("composes pre-bound Node request options", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import * as https from 'node:https';",
        "const send = https.request.bind(https, { hostname: 'api.openai.com', path: '/v1/responses' });",
        "send();",
      ].join("\n"),
      "scripts/bound-node-provider-transport.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("preserves transport namespaces through local aliases and reassignment", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "import * as https from 'node:https';",
        "import * as undici from 'undici';",
        "const web = globalThis;",
        "const { fetch: send } = web;",
        "await send('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const imported = await import('node-fetch');",
        "const transport = imported;",
        "await transport.default('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const nodeTransport = https;",
        "nodeTransport.request({ hostname: 'api.openai.com', path: '/v1/responses' });",
        "let assigned;",
        "assigned = undici;",
        "await assigned.fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const workerGlobal = self;",
        "await workerGlobal.fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const browserGlobal = window;",
        "await browserGlobal.fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
      ].join("\n"),
      "scripts/aliased-transport-namespaces.mts",
    );
    const shadowed = violationsOfKind(
      "raw-provider-http",
      [
        "async function run(globalThis: { fetch(url: string): Promise<unknown> }) {",
        "  const web = globalThis;",
        "  const { fetch: send } = web;",
        "  await send('https://api.openai.com/v1/responses');",
        "}",
        "const web = globalThis;",
        "let selected = web;",
        "selected = { fetch: async (_url: string) => ({ ok: true }) };",
        "const { fetch: selectedSend } = selected;",
        "await selectedSend('https://api.openai.com/v1/responses');",
      ].join("\n"),
      "scripts/shadowed-transport-namespaces.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([5, 8, 10, 13, 15, 17]);
    expect(shadowed).toEqual([]);
  });

  it("preserves transport namespace alternatives through expression aliases", () => {
    const source = [
      "import * as https from 'node:https';",
      "import * as undici from 'undici';",
      "const inert = { get(_url) {}, request(_url) {}, fetch(_url) {} };",
      "const conditional = Date.now() > 0 ? https : inert;",
      "conditional.get('https://api.openai.com/v1/models');",
      "const logical = Date.now() > 0 && undici;",
      "await logical.fetch('https://api.openai.com/v1/responses');",
      "const mixed = Date.now() > 0 ? https : undici;",
      "mixed.get('https://api.openai.com/v1/models');",
      "await mixed.fetch('https://api.openai.com/v1/responses');",
      "const sequenced = (inert, https);",
      "sequenced.request({ hostname: 'api.openai.com', path: '/v1/responses' });",
      "const chosen = mixed;",
      "chosen.request('https://api.openai.com/v1/responses');",
    ].join("\n");
    const clean = violationsOfKind(
      "raw-provider-http",
      [
        "import * as https from 'node:https';",
        "import * as undici from 'undici';",
        "const inert = { get(_url: string) {}, request(_url: string) {}, fetch(_url: string) {} };",
        "let selected = Date.now() > 0 ? https : undici;",
        "{",
        "  const selected = inert;",
        "  selected.get('https://api.openai.com/v1/models');",
        "}",
        "selected = inert;",
        "selected.get('https://api.openai.com/v1/models');",
      ].join("\n"),
      "scripts/definitely-reassigned-transport-namespace.mts",
    );

    for (const relativePath of [
      "scripts/expression-transport-namespaces.mjs",
      "scripts/expression-transport-namespaces.mts",
    ]) {
      const matches = rawHttpViolations(source, relativePath);
      expect(matches.map((match) => match.line)).toEqual([
        5,
        7,
        9,
        10,
        12,
        14,
      ]);
    }
    expect(clean).toEqual([]);
  });

  it("composes pre-bound transports stored in closed local members", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const transports = {",
        "  send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' }),",
        "};",
        "await transports.send();",
        "const nested = { provider: { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') } };",
        "await nested.provider.send.call(undefined, { method: 'POST' });",
        "const tuple = [globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses')] as const;",
        "await tuple[0].apply(undefined, []);",
        "const base = { ignored: true };",
        "const spread = { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses'), ...base };",
        "await spread.send();",
        "let conditional = { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') };",
        "if (Date.now() > 0) conditional = { send: async (_url: string) => ({ ok: true }) };",
        "await conditional.send();",
        "const shared = { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') };",
        "const spreadOnly = { ...shared };",
        "await spreadOnly.send();",
        "const selected = Date.now() > 0 ? shared : { send: async (_url: string) => ({ ok: true }) };",
        "await selected.send();",
        "const referenced = { provider: shared };",
        "await referenced.provider.send();",
        "const mutated = { send: async (_url: string) => ({ ok: true }) };",
        "mutated.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await mutated.send();",
        "const assigned = { send: async (_url: string) => ({ ok: true }) };",
        "Object.assign(assigned, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "await assigned.send();",
      ].join("\n"),
      "scripts/member-bound-provider-transports.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      4,
      6,
      8,
      11,
      14,
      17,
      19,
      21,
      24,
      27,
    ]);
  });

  it("retains provider provenance through aliased member mutation and destructuring", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const transports = { send: async (_url: string) => ({ ok: true }) };",
        "const alias = transports;",
        "alias.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await transports.send();",
        "const assigned = { send: async (_url: string) => ({ ok: true }) };",
        "const assignedAlias = assigned;",
        "Object.assign(assignedAlias, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "await assigned.send();",
        "const nested = { provider: { send: async (_url: string) => ({ ok: true }) } };",
        "const nestedAlias = nested.provider;",
        "nestedAlias.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await nested.provider.send();",
        "const tuple = [async (_url: string) => ({ ok: true })];",
        "const tupleAlias = tuple;",
        "tupleAlias[0] = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await tuple[0]();",
        "const routes = { endpoint: '/internal' };",
        "routes.endpoint = 'https://api.openai.com/v1/responses';",
        "await fetch(routes.endpoint, { method: 'POST' });",
        "const aliasedRoutes = { endpoint: '/internal' };",
        "const routesAlias = aliasedRoutes;",
        "routesAlias.endpoint = 'https://api.openai.com/v1/responses';",
        "await fetch(aliasedRoutes.endpoint, { method: 'POST' });",
        "const grouped = { provider: { responses: 'https://api.openai.com/v1/responses' } };",
        "const { provider: { responses: endpoint } } = grouped;",
        "await fetch(endpoint, { method: 'POST' });",
        "const imported = await import('node-fetch');",
        "const importedAlias = imported;",
        "let dynamicSend = async (_url: string) => ({ ok: true });",
        "({ default: dynamicSend } = importedAlias);",
        "await dynamicSend('https://api.openai.com/v1/responses');",
        "const web = globalThis;",
        "let webSend = async (_url: string) => ({ ok: true });",
        "({ fetch: webSend } = web);",
        "await webSend('https://api.openai.com/v1/responses');",
        "const conditionalTarget = { send: async (_url: string) => ({ ok: true }) };",
        "const conditionalOther = { send: async (_url: string) => ({ ok: true }) };",
        "let conditionalAlias = conditionalTarget;",
        "if (Date.now() > 0) conditionalAlias = conditionalOther;",
        "conditionalAlias.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await conditionalTarget.send();",
        "const selectedTarget = { send: async (_url: string) => ({ ok: true }) };",
        "const selectedOther = { send: async (_url: string) => ({ ok: true }) };",
        "const selectedAlias = Date.now() > 0 ? selectedTarget : selectedOther;",
        "selectedAlias.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await selectedTarget.send();",
      ].join("\n"),
      "scripts/aliased-member-provider-transports.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      4,
      8,
      12,
      16,
      19,
      23,
      26,
      31,
      35,
      41,
      46,
    ]);
  });

  it("retains member mutations through reference-valued closed containers", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const objectTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const objectHolder = { current: objectTransport };",
        "objectHolder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await objectTransport.send();",
        "const arrayTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const arrayHolder = [arrayTransport];",
        "arrayHolder[0].send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await arrayTransport.send();",
        "const writtenTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const writtenHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "writtenHolder.current = writtenTransport;",
        "writtenHolder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await writtenTransport.send();",
        "const assignedTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const assignedHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "Object.assign(assignedHolder, { current: assignedTransport });",
        "assignedHolder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await assignedTransport.send();",
        "const conditionalFirst = { send: async (_url: string) => ({ ok: true }) };",
        "const conditionalSecond = { send: async (_url: string) => ({ ok: true }) };",
        "const conditionalHolder = { current: Date.now() > 0 ? conditionalFirst : conditionalSecond };",
        "conditionalHolder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await conditionalFirst.send();",
        "await conditionalSecond.send();",
        "const nestedTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const nestedHolder = { slot: { current: nestedTransport } };",
        "nestedHolder.slot.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await nestedTransport.send();",
        "const aliasedWriteTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const aliasedWriteHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "const aliasedWriteHolderAlias = aliasedWriteHolder;",
        "aliasedWriteHolderAlias.current = aliasedWriteTransport;",
        "aliasedWriteHolderAlias.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await aliasedWriteTransport.send();",
        "const aliasedAssignTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const aliasedAssignHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "const aliasedAssignHolderAlias = aliasedAssignHolder;",
        "Object.assign(aliasedAssignHolderAlias, { current: aliasedAssignTransport });",
        "aliasedAssignHolderAlias.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await aliasedAssignTransport.send();",
      ].join("\n"),
      "scripts/closed-container-provider-transport-aliases.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      4,
      8,
      13,
      18,
      23,
      24,
      28,
      34,
      40,
    ]);
  });

  it("does not cross closed-container shadows or definitive reassignments", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const outer = { send: async (_url: string) => ({ ok: true }) };",
        "{",
        "  const inner = { send: async (_url: string) => ({ ok: true }) };",
        "  const holder = { current: inner };",
        "  holder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "}",
        "await outer.send();",
        "const original = { send: async (_url: string) => ({ ok: true }) };",
        "const replacement = { send: async (_url: string) => ({ ok: true }) };",
        "let reassignedHolder = { current: original };",
        "reassignedHolder = { current: replacement };",
        "reassignedHolder.current.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await original.send();",
      ].join("\n"),
      "scripts/shadowed-closed-container-provider-transport-aliases.mts",
    );

    expect(matches).toEqual([]);
  });

  it("exposes referenced-object mutations through their aggregate path", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const transport = { send: async (_url: string) => ({ ok: true }) };",
        "const holder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "holder.current = transport;",
        "transport.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses', { method: 'POST' });",
        "await holder.current.send();",
      ].join("\n"),
      "scripts/referenced-provider-transport-through-aggregate.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([5]);
  });

  it("uses effective provider-valued members and destructured defaults", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const routes = { endpoint: '/internal' };",
        "routes.endpoint = 'https://api.openai.com/v1/responses';",
        "await fetch(routes.endpoint, { method: 'POST' });",
        "const aliasedRoutes = { endpoint: '/internal' };",
        "const routesAlias = aliasedRoutes;",
        "routesAlias.endpoint = 'https://api.openai.com/v1/responses';",
        "await fetch(aliasedRoutes.endpoint, { method: 'POST' });",
        "const grouped = { provider: { responses: 'https://api.openai.com/v1/responses' } };",
        "const { provider: { responses: endpoint } } = grouped;",
        "await fetch(endpoint, { method: 'POST' });",
        "const optional = { endpoint: undefined };",
        "const { endpoint: fallbackEndpoint = 'https://api.openai.com/v1/responses' } = optional;",
        "await fetch(fallbackEndpoint, { method: 'POST' });",
      ].join("\n"),
      "scripts/effective-provider-member-values.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 7, 10, 13]);
  });

  it("does not cross aliased member shadows or unrelated reassignments", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const transports = { send: async (_url: string) => ({ ok: true }) };",
        "const alias = transports;",
        "{",
        "  const alias = { send: async (_url: string) => ({ ok: true }) };",
        "  alias.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "}",
        "await transports.send();",
        "const original = { send: async (_url: string) => ({ ok: true }) };",
        "let reassigned = original;",
        "reassigned = { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') };",
        "await original.send();",
      ].join("\n"),
      "scripts/shadowed-aliased-member-provider-transports.mts",
    );

    expect(matches).toEqual([]);
  });

  it("rejects provider transports stored through opaque alias-producing calls", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "declare function selectTable<T>(value: T): T;",
        "const direct = { send: async (_url: string) => ({ ok: true }) };",
        "const opaque = selectTable(direct);",
        "opaque.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await direct.send();",
        "const assigned = { send: async (_url: string) => ({ ok: true }) };",
        "const assignedOpaque = selectTable(assigned);",
        "Object.assign(assignedOpaque, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "await assigned.send();",
      ].join("\n"),
      "scripts/opaque-provider-member-aliases.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 8]);
  });

  it("rejects provider transports stored through nested opaque member roots", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const transport = { send: async (_url: string) => ({ ok: true }) };",
        "const holder = { current: transport };",
        "const key = 'current';",
        "holder[key].send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await transport.send();",
        "const assignedTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const assignedHolder = { current: assignedTransport };",
        "const assignedKey = 'current';",
        "Object.assign(assignedHolder[assignedKey], { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "await assignedTransport.send();",
        "const literalTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const literalHolder = { current: literalTransport };",
        "literalHolder['current'].send = async (_url: string) => ({ ok: true });",
        "await literalTransport.send();",
        "const benignTransport = { send: async (_url: string) => ({ ok: true }) };",
        "const benignHolder = { current: benignTransport };",
        "const benignKey = 'current';",
        "benignHolder[benignKey].send = async (_url: string) => ({ ok: true });",
        "await benignTransport.send();",
        "{",
        "  const holder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "  const key = 'current';",
        "  holder[key].send = async (_url: string) => ({ ok: true });",
        "}",
      ].join("\n"),
      "scripts/nested-opaque-provider-member-aliases.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 9]);
  });

  it("fails closed for provider transports stored through non-variable opaque roots", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "export function issue(holder: Record<string, { send?: typeof fetch }>, key: string) {",
        "  holder[key].send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "  Object.assign(holder[key], { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "}",
        "declare function select<T>(value: T): T;",
        "const selectedHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "select(selectedHolder).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "Object.assign(select(selectedHolder), { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "class ProviderTransportHolder {",
        "  holder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "  issue(key: string) {",
        "    this.holder[key].send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "    Object.assign(this.holder[key], { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "  }",
        "}",
        "export function benign(holder: Record<string, { send?: typeof fetch }>, key: string) {",
        "  holder[key].send = async (_url: string) => ({ ok: true });",
        "  Object.assign(holder[key], { send: async (_url: string) => ({ ok: true }) });",
        "}",
        "const literalHolder = { current: { send: async (_url: string) => ({ ok: true }) } };",
        "literalHolder['current'].send = async (_url: string) => ({ ok: true });",
      ].join("\n"),
      "scripts/non-variable-opaque-provider-member-roots.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([2, 3, 7, 8, 12, 13]);
  });

  it("uses one target-expression authority for provider transport mutations", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const left = { send: async (_url: string) => ({ ok: true }) };",
        "const right = { send: async (_url: string) => ({ ok: true }) };",
        "const chooseLeft = Date.now() > 0;",
        "(chooseLeft ? left : right).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await left.send();",
        "await right.send();",
        "Object.assign(left || right, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "await left.send();",
        "await right.send();",
        "(left, right).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await right.send();",
        "async function getHolder(): Promise<typeof left> { return left; }",
        "(await getHolder()).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "Object.assign(await getHolder(), { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "getHolder().send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "Object.assign(getHolder(), { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "function issue(holder: { send: typeof fetch }) {",
        "  holder.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "  Object.assign(holder, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "}",
        "class HolderOwner {",
        "  holder = { send: async (_url: string) => ({ ok: true }) };",
        "  issue() {",
        "    this.holder.send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "    Object.assign(this.holder, { send: globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses') });",
        "  }",
        "}",
        "(await getHolder()).send = async (_url: string) => ({ ok: true });",
        "Object.assign(getHolder(), { send: async (_url: string) => ({ ok: true }) });",
        "function benign(holder: { send: (_url: string) => Promise<{ ok: boolean }> }) {",
        "  holder.send = async (_url: string) => ({ ok: true });",
        "  Object.assign(holder, { send: async (_url: string) => ({ ok: true }) });",
        "}",
      ].join("\n"),
      "scripts/provider-transport-mutation-target-expressions.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      5,
      6,
      8,
      9,
      11,
      13,
      14,
      15,
      16,
      18,
      19,
      24,
      25,
    ]);
  });

  it("keeps target-expression mutation alternatives inside their binding owners", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const outer = { send: async (_url: string) => ({ ok: true }) };",
        "{",
        "  const left = { send: async (_url: string) => ({ ok: true }) };",
        "  const right = { send: async (_url: string) => ({ ok: true }) };",
        "  (Date.now() > 0 ? left : right).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "}",
        "await outer.send();",
        "const original = { send: async (_url: string) => ({ ok: true }) };",
        "const replacement = { send: async (_url: string) => ({ ok: true }) };",
        "let alias = original;",
        "alias = replacement;",
        "(alias || replacement).send = globalThis.fetch.bind(undefined, 'https://api.openai.com/v1/responses');",
        "await original.send();",
      ].join("\n"),
      "scripts/scoped-provider-transport-mutation-target-expressions.mts",
    );

    expect(matches).toEqual([]);
  });

  it("retains earlier transports across conditional benign reassignment", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "let webSend = globalThis.fetch;",
        "if (Date.now() > 0) webSend = async (_url: string) => ({ ok: true });",
        "await webSend('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const { request: undiciRequest } = await import('undici');",
        "let undiciSend = undiciRequest;",
        "if (Date.now() > 0) undiciSend = async (_url: string) => ({ ok: true });",
        "await undiciSend('https://api.openai.com/v1/responses', { method: 'POST' });",
        "const httpsNamespace = await import('node:https');",
        "let nodeSend = httpsNamespace.request;",
        "if (Date.now() > 0) nodeSend = async (_url: string) => ({ ok: true });",
        "nodeSend('https://api.openai.com/v1/responses', { method: 'POST' });",
      ].join("\n"),
      "scripts/conditional-provider-transports.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([3, 7, 11]);
  });

  it("keeps a definite benign transport reassignment clean", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "let send = globalThis.fetch;",
        "send = async (_url: string) => ({ ok: true });",
        "await send('https://api.openai.com/v1/responses', { method: 'POST' });",
      ].join("\n"),
      "scripts/definitely-reassigned-provider-transport.mts",
    );

    expect(matches).toEqual([]);
  });

  it("projects effective member mutations through destructuring and Object.assign", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const routes = { route: '/internal' };",
        "routes.route = 'https://api.openai.com/v1/responses';",
        "const { route: selected } = routes;",
        "await fetch(selected, { method: 'POST' });",
        "const source = { route: '/internal' };",
        "source.route = 'https://api.openai.com/v1/responses';",
        "const target = { route: '/internal' };",
        "Object.assign(target, source);",
        "await fetch(target.route, { method: 'POST' });",
        "const nested = { holder: { route: '/internal' } };",
        "nested.holder.route = 'https://api.openai.com/v1/responses';",
        "const { holder: { route: nestedRoute } } = nested;",
        "await fetch(nestedRoute, { method: 'POST' });",
        "const tuple = ['/internal'];",
        "tuple[0] = 'https://api.openai.com/v1/responses';",
        "const [tupleRoute] = tuple;",
        "await fetch(tupleRoute, { method: 'POST' });",
      ].join("\n"),
      "scripts/effective-provider-member-projection.mts",
    );

    expect(matches.map((match) => match.line)).toEqual([4, 9, 13, 17]);
  });

  it("does not project effective member mutations across lexical shadows", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const routes = { route: '/internal' };",
        "{",
        "  const routes = { route: '/internal' };",
        "  routes.route = 'https://api.openai.com/v1/responses';",
        "}",
        "const { route: selected } = routes;",
        "await fetch(selected, { method: 'POST' });",
      ].join("\n"),
      "scripts/shadowed-provider-member-projection.mts",
    );

    expect(matches).toEqual([]);
  });

});
