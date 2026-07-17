import {
  publicProductRefSchema,
  publicProductSearchRequestSchema,
} from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import { isRecord } from "../src/lib/primitives";
import { createPublicProductsOpenApiDocument } from "../src/lib/public-products/openapi";

describe("Murph Product Data OpenAPI", () => {
  it("documents every public route with unique operation IDs", () => {
    const document = createPublicProductsOpenApiDocument();
    const paths = requiredRecord(document.paths, "paths");

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(paths).sort()).toEqual([
      "/api/public/v1/openapi.json",
      "/api/public/v1/products/search",
      "/api/public/v1/products/{productRef}",
    ]);

    const operationIds = Object.values(paths).flatMap((pathItem) =>
      Object.values(requiredRecord(pathItem, "path item")).flatMap((operation) => {
        if (!isRecord(operation) || typeof operation.operationId !== "string") {
          return [];
        }
        return [operation.operationId];
      }),
    );

    expect(operationIds).toHaveLength(3);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds).toEqual(expect.arrayContaining([
      "getPublicProductsOpenApi",
      "getProduct",
      "searchProducts",
    ]));
  });

  it("describes platform-owned rate limits without promising an application body", () => {
    const document = createPublicProductsOpenApiDocument();
    const paths = requiredRecord(document.paths, "paths");

    for (const [path, method] of [
      ["/api/public/v1/products/search", "post"],
      ["/api/public/v1/products/{productRef}", "get"],
    ] as const) {
      const pathItem = requiredRecord(paths[path], `${path} path`);
      const operation = requiredRecord(pathItem[method], `${method} operation`);
      const responses = requiredRecord(operation.responses, "responses");
      const rateLimited = requiredRecord(responses["429"], "429 response");

      expect(rateLimited.description).toContain("platform");
      expect(rateLimited).not.toHaveProperty("content");
      expect(rateLimited).not.toHaveProperty("headers");
    }
  });

  it("resolves every local schema reference", () => {
    const document = createPublicProductsOpenApiDocument();
    const components = requiredRecord(document.components, "components");
    const schemas = requiredRecord(components.schemas, "component schemas");
    const serialized = JSON.stringify(document);
    const refs = [...serialized.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === "string");

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(schemas).toHaveProperty(ref);
    }
    for (const schema of Object.values(schemas)) {
      expect(isRecord(schema) ? schema.$schema : undefined).toBeUndefined();
    }
  });

  it("keeps examples synthetic and valid at the runtime boundary", () => {
    const document = createPublicProductsOpenApiDocument();
    const paths = requiredRecord(document.paths, "paths");
    const searchPath = requiredRecord(
      paths["/api/public/v1/products/search"],
      "search path",
    );
    const searchPost = requiredRecord(searchPath.post, "search post");
    const requestBody = requiredRecord(searchPost.requestBody, "request body");
    const requestContent = requiredRecord(requestBody.content, "request content");
    const requestJson = requiredRecord(requestContent["application/json"], "request JSON");
    const detailPath = requiredRecord(
      paths["/api/public/v1/products/{productRef}"],
      "detail path",
    );
    const detailGet = requiredRecord(detailPath.get, "detail get");
    const parameters = Array.isArray(detailGet.parameters) ? detailGet.parameters : [];
    const parameter = requiredRecord(parameters[0], "product ref parameter");

    expect(publicProductSearchRequestSchema.parse(requestJson.example)).toEqual({
      query: "example product",
      kinds: ["supplement", "food"],
      limitPerKind: 6,
    });
    expect(publicProductRefSchema.parse(parameter.example)).toBe(
      "supplement_ZHNsZDoxMjM",
    );

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("/api/foods");
    expect(serialized).not.toContain("/api/supplements");
    expect(serialized).not.toContain("MURPH_LABELS_DB_URL");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain('"label"');
  });
});

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}
