import { describe, expect, it } from "vitest";

import {
  approvedProviderRawHttpOwners,
  findProviderRequestBoundaryViolations,
  isProviderRequestGuardEntrypoint,
  providerBoundaryRegistry,
  providerHttpExceptionRegistry,
  providerRequestSourceExtensions,
  shouldScanProviderRequestSourceFile,
  shouldSkipProviderRequestDirectory,
} from "./check-provider-request-boundaries.js";

describe("check-provider-request-boundaries", () => {
  it("recognizes direct execution even when the module URL has loader metadata", () => {
    expect(isProviderRequestGuardEntrypoint(
      "/repo/scripts/check-provider-request-boundaries.ts",
      "file:///repo/scripts/check-provider-request-boundaries.ts?tsx=1",
    )).toBe(true);
    expect(isProviderRequestGuardEntrypoint(
      "/repo/scripts/other.ts",
      "file:///repo/scripts/check-provider-request-boundaries.ts",
    )).toBe(false);
  });

  it("scans authored production modules and excludes generated or test sources", () => {
    for (const extension of providerRequestSourceExtensions) {
      expect(shouldScanProviderRequestSourceFile(`packages/example/src/client${extension}`))
        .toBe(true);
    }
    expect(shouldScanProviderRequestSourceFile("packages/example/test/client.ts")).toBe(true);
    expect(shouldScanProviderRequestSourceFile("packages/example/src/client.test.ts")).toBe(false);
    expect(shouldScanProviderRequestSourceFile("packages/example/src/client.generated.ts")).toBe(false);
    expect(shouldScanProviderRequestSourceFile("packages/example/src/client.d.ts")).toBe(false);
    expect(shouldSkipProviderRequestDirectory("test")).toBe(true);
    expect(shouldSkipProviderRequestDirectory(".next-build")).toBe(true);
    expect(shouldSkipProviderRequestDirectory("src")).toBe(false);
  });

  it("rejects registered provider hosts on global and injected fetch", () => {
    expect(violations(`
      fetch("https://api.openai.com/v1/responses");
      async function requestJunction(fetchImpl: typeof fetch, baseUrl: string) {
        return fetchImpl(baseUrl + "/v1/patients");
      }
    `, "packages/example/src/openai-junction.ts")).toEqual([
      "raw-provider-http",
      "raw-provider-http",
    ]);
  });

  it("uses Babel bindings for direct transport aliases without crossing shadows", () => {
    expect(violations(`
      const send = fetch;
      send("https://api.openai.com/v1/responses");
    `)).toEqual(["raw-provider-http"]);

    expect(violations(`
      function fetch(_url: string): void {}
      fetch("https://api.openai.com/v1/responses");
    `)).toEqual([]);
  });

  it("recognizes Node, Undici, CommonJS, and import-equals transports", () => {
    expect(violations(`
      import { request as send } from "node:https";
      import { fetch as undiciFetch } from "undici";
      send("https://api.stripe.com/v1/customers");
      undiciFetch("https://api.openai.com/v1/responses");
      require("https").request("https://api.resend.com/emails");
      import http = require("node:http");
      http.request("https://api.exa.ai/search");
    `)).toEqual([
      "raw-provider-http",
      "raw-provider-http",
      "raw-provider-http",
      "raw-provider-http",
    ]);
  });

  it("recognizes destructured and namespace transport aliases", () => {
    expect(violations(`
      import * as https from "node:https";
      const { request: send } = require("node:http");
      const { fetch: webFetch } = globalThis;
      https.request("https://api.stripe.com/v1/customers");
      send("https://api.openai.com/v1/responses");
      webFetch("https://api.resend.com/emails");
    `)).toEqual([
      "raw-provider-http",
      "raw-provider-http",
      "raw-provider-http",
    ]);
  });

  it("rejects call/apply indirection at provider-owned boundaries", () => {
    expect(violations(`
      fetch.call(undefined, "https://api.openai.com/v1/responses");
      fetch.apply(undefined, ["https://api.openai.com/v1/responses"]);
    `, "packages/example/src/openai-client.ts")).toEqual([
      "raw-provider-http",
      "raw-provider-http",
    ]);
  });

  it("uses a provider SDK import as local provider ownership evidence", () => {
    expect(violations(`
      import OpenAI from "openai";
      async function request(fetchImpl: typeof fetch, url: string) {
        return fetchImpl(url);
      }
      void OpenAI;
    `, "packages/example/src/client.ts")).toEqual(["raw-provider-http"]);
  });

  it("does not mistake official SDK operations for raw HTTP", () => {
    expect(violations(`
      import OpenAI from "openai";
      const sdkFetch = globalThis.fetch.bind(globalThis);
      const client = new OpenAI({ apiKey: "test", fetch: sdkFetch });
      await client.responses.create({ model: "gpt", input: "hello" });
    `)).toEqual([]);
  });

  it("keeps providers without a verified TypeScript SDK outside the ban", () => {
    expect(violations(`
      fetch("https://api.telegram.org/bot/example/sendMessage");
      fetch("https://api.ouraring.com/v2/usercollection/sleep");
      fetch("https://api.prod.whoop.com/developer/v1/cycle");
      fetch("https://www.strava.com/api/v3/athlete");
    `)).toEqual([]);
  });

  it("allows only statically proven single-slash same-origin traffic", () => {
    expect(violations(`
      import OpenAI from "openai";
      const route = "/api/internal/provider-status";
      fetch(route);
      fetch(new URL("/api/internal/provider-status", location.origin));
    `)).toEqual([]);
    expect(violations(`
      import OpenAI from "openai";
      fetch("//api.openai.com/v1/responses");
    `)).toEqual(["raw-provider-http"]);
  });

  it("does not treat comments as authorization", () => {
    expect(violations(`
      // provider-request-boundary-allow-next-line: sdk-transport-adapter
      fetch("https://api.openai.com/v1/responses");
    `)).toEqual(["raw-provider-http"]);
  });

  it("allows an exact SDK transport owner with its required runtime import", () => {
    expect(violations(`
      import Composio from "@composio/client";
      function createBoundedComposioFetch(fetchImpl: typeof fetch) {
        const sdkFetch = (request: Request) => fetchImpl(request);
        return sdkFetch;
      }
      void Composio;
    `, "apps/web/src/lib/connected-apps/composio.ts")).toEqual([]);
  });

  it("invalidates an SDK transport owner that loses its runtime import", () => {
    expect(violations(`
      function createBoundedComposioFetch(fetchImpl: typeof fetch) {
        return (request: Request) => fetchImpl(request);
      }
    `, "apps/web/src/lib/connected-apps/composio.ts")).toEqual([
      "invalid-approved-owner",
    ]);
  });

  it("caps every exact owner at its registered raw-call count", () => {
    expect(violations(`
      import Composio from "@composio/client";
      function createBoundedComposioFetch(fetchImpl: typeof fetch) {
        fetchImpl("https://backend.composio.dev/api/v3/one");
        return fetchImpl("https://backend.composio.dev/api/v3/two");
      }
      void Composio;
    `, "apps/web/src/lib/connected-apps/composio.ts")).toEqual([
      "approved-owner-overflow",
    ]);
  });

  it("does not let one owner's provider approval cover another provider", () => {
    expect(violations(`
      import Composio from "@composio/client";
      function createBoundedComposioFetch(fetchImpl: typeof fetch) {
        return fetchImpl("https://api.openai.com/v1/responses");
      }
      void Composio;
    `, "apps/web/src/lib/connected-apps/composio.ts")).toEqual([
      "raw-provider-http",
    ]);
  });

  it("does not transfer an approval to the same function name in another file", () => {
    expect(violations(`
      import Composio from "@composio/client";
      function createBoundedComposioFetch(fetchImpl: typeof fetch) {
        return fetchImpl("https://backend.composio.dev/api/v3/tools");
      }
      void Composio;
    `, "packages/example/src/composio.ts")).toEqual(["raw-provider-http"]);
  });

  it("allows the exact presigned transfer owner without duplicating runtime validation", () => {
    expect(violations(`
      async function sendHostedLinqAttachmentMessage(
        fetchImpl: typeof fetch,
        uploadUrl: string,
        bytes: Uint8Array,
      ) {
        return fetchImpl(uploadUrl, { body: bytes, method: "PUT" });
      }
    `, "apps/web/src/lib/hosted-onboarding/linq-client.ts")).toEqual([]);
  });

  it("allows xAI only in the exact runtime-validated owner", () => {
    expect(violations(`
      async function executeAskGrokTool(fetchImpl: typeof fetch) {
        return fetchImpl("https://api.x.ai/v1/responses", { method: "POST" });
      }
    `, "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts")).toEqual([]);
    expect(violations(`
      async function askGrok(fetchImpl: typeof fetch) {
        return fetchImpl("https://api.x.ai/v1/responses", { method: "POST" });
      }
    `, "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts")).toEqual([
      "raw-provider-http",
    ]);
  });

  it("reports the primitive once inside a local wrapper", () => {
    const result = findProviderRequestBoundaryViolations(
      "packages/example/src/openai-client.ts",
      `
        function providerFetch(url: string) {
          return fetch(url);
        }
        providerFetch("https://api.openai.com/v1/responses");
      `,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      boundary: "Direct OpenAI provider HTTP in providerFetch",
      kind: "raw-provider-http",
    });
  });

  it("keeps the provider and owner registries explicit and duplicate-free", () => {
    expect(new Set(providerBoundaryRegistry.map((provider) => provider.id)).size)
      .toBe(providerBoundaryRegistry.length);
    const hosts = providerBoundaryRegistry.flatMap((provider) => provider.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(new Set(providerHttpExceptionRegistry.map((exception) => exception.id)).size)
      .toBe(providerHttpExceptionRegistry.length);
    const ownerKeys = approvedProviderRawHttpOwners.map(
      (owner) => `${owner.relativePath}:${owner.ownerName}`,
    );
    expect(new Set(ownerKeys).size).toBe(ownerKeys.length);
    expect(approvedProviderRawHttpOwners.every((owner) => owner.maxCalls === 1)).toBe(true);
  });

});

function violations(
  source: string,
  relativePath = "packages/example/src/provider.ts",
): string[] {
  return findProviderRequestBoundaryViolations(relativePath, source)
    .map((violation) => violation.kind);
}
