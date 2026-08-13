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
      .toEqual([{ boundary: "Exa raw HTTP via fetchImpl", line: 3 }]);
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

  it("allows a Node HTTP presigned PUT with a proven piped stream", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "import { request as httpsRequest } from 'node:https';",
          "function putPresignedPayload(input: { payload: Readable; presignedPutUrl: string; tlsCaCertificatePem?: string }) {",
          "  const url = new URL(input.presignedPutUrl);",
          "  const clientRequest = httpsRequest(url, { ...(input.tlsCaCertificatePem ? { ca: input.tlsCaCertificatePem } : {}), method: 'PUT' }, () => undefined);",
          "  input.payload.pipe(clientRequest);",
          "}",
        ].join("\n"),
        "apps/cloudflare/src/openai-presigned-upload.ts",
      ),
    ).toEqual([]);
  });

  it("requires an AST-proven pipe into the exact presigned request", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "import { request as httpsRequest } from 'node:https';",
          "function putPresignedPayload(input: { payload: Readable; presignedPutUrl: string }) {",
          "  const url = new URL(input.presignedPutUrl);",
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

  it("allows an opaque presigned byte upload but reports a direct provider call beside it", () => {
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

    expect(matches.map((match) => match.line)).toEqual([7]);
  });

  it("allows an opaque presigned byte download", () => {
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
    ).toEqual([]);
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

    expect(matches.map((match) => match.line)).toEqual([2, 3, 6, 7, 8, 9]);
  });

  it("admits only registered presigned transfer-header factories", () => {
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  const headers = normalizeLinqRequiredHeaders(input.requiredHeaders);",
          "  await fetch(input.uploadUrl, { body: input.bytes, headers, method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ),
    ).toEqual([]);
    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  const headers = normalizeOtherRequiredHeaders(input.requiredHeaders);",
          "  await fetch(input.uploadUrl, { body: input.bytes, headers, method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).toEqual([4]);

    expect(
      violationsOfKind(
        "raw-provider-http",
        [
          "function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return headers; }",
          "async function uploadLinqAttachmentBytes(input: { bytes: Uint8Array; requiredHeaders: Record<string, string>; uploadUrl: string }) {",
          "  function normalizeLinqRequiredHeaders(headers: Record<string, string>) { return { authorization: headers.authorization }; }",
          "  const headers = normalizeLinqRequiredHeaders(input.requiredHeaders);",
          "  await fetch(input.uploadUrl, { body: input.bytes, headers, method: 'PUT' });",
          "}",
        ].join("\n"),
        "packages/operator-config/src/linq-runtime.ts",
      ).map((match) => match.line),
    ).toEqual([5]);
  });

  it("allows incoming Request pass-through but reports a direct provider call in the same proxy", () => {
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

    expect(matches.map((match) => match.line)).toEqual([3]);
  });

  it("rejects a second init on incoming Request forwarding", () => {
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

    expect(matches.map((match) => match.line)).toEqual([3, 4, 5]);
  });

  it("allows dynamic SMART/FHIR traffic but reports a registered provider endpoint beside it", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "async function readFhir(fhirEndpoint: string, fetchImpl: typeof fetch) {",
        "  await fetchImpl(fhirEndpoint);",
        "  await fetchImpl('https://api.openai.com/v1/responses');",
        "}",
      ].join("\n"),
      "apps/web/src/lib/openai/smart-fhir-client.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([3]);
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
      "apps/web/src/lib/openai/smart-fhir-client.ts",
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
        "const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';",
        "async function search(fetchImpl: typeof fetch) {",
        "  await fetchImpl(XAI_RESPONSES_URL, {",
        "    body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }),",
        "    method: 'POST',",
        "  });",
        "  await fetchImpl(XAI_RESPONSES_URL, {",
        "    body: JSON.stringify({ store: false, tools: [{ type: 'web_search' }] }),",
        "    method: 'POST',",
        "  });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([7]);
  });

  it("rejects effective-value overrides in the path-scoped xAI exception", () => {
    const matches = violationsOfKind(
      "raw-provider-http",
      [
        "const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';",
        "const initOverrides = {};",
        "const payloadOverrides = {};",
        "const toolOverrides = {};",
        "const computedMethod = 'method';",
        "const computedStore = 'store';",
        "const computedType = 'type';",
        "async function search(fetchImpl: typeof fetch) {",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', ...initOverrides });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], ...payloadOverrides }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', ...toolOverrides }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', [computedMethod]: 'GET' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], [computedStore]: true }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', [computedType]: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', method: 'GET' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }), method: 'POST', body: JSON.stringify({ store: true, tools: [] }) });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, store: true, tools: [{ type: 'x_search' }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], tools: [{ type: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search', type: 'web_search' }] }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }] }, null), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], toJSON() { return { store: true, tools: [] }; } }), method: 'POST' });",
        "  await fetchImpl(XAI_RESPONSES_URL, { body: JSON.stringify({ store: false, tools: [{ type: 'x_search' }], __proto__: { toJSON() { return { store: true, tools: [] }; } } }), method: 'POST' });",
        "}",
      ].join("\n"),
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
    );

    expect(matches.map((match) => match.line)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
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
      "incoming-request-pass-through",
      "dynamic-smart-fhir",
      "xai-x-search-responses",
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
      "apps/web/src/lib/hosted-onboarding/linq-client.ts",
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

});
