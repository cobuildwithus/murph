import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import sandboxSet from "../public/.well-known/epic/sandbox.jwks.json";
import productionSet from "../public/.well-known/epic/production.jwks.json";
import oracleProductionSet from "../public/.well-known/oracle/production.jwks.json";
import { epicAssertionSigner } from "@/src/lib/clinical-records/epic-client-auth";
import { describe, expect, it, vi } from "vitest";

import {
  discoverSmartConfiguration,
  exchangeSmartAuthorizationCode,
  refreshSmartAccessToken,
  readGrantedSmartResourceTypes,
  selectSmartRequestedScopes,
} from "@/src/lib/clinical-records/smart";

import { epicBinaryReadIsGranted, epicMediaReadIsGranted } from "@/src/lib/clinical-records/epic-policy";

const baseScopes = ["openid", "fhirUser", "launch/patient"];
const resourceTypes = ["Patient", "Observation", "DiagnosticReport"];

describe("Clinical Records SMART negotiation", () => {
  it("uses Epic permission capabilities instead of requiring exact scopes_supported entries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      authorization_endpoint: "https://fhir.example.test/oauth2/authorize",
      capabilities: [
        "permission-v1",
        "permission-v2",
        "permission-offline",
        "context-standalone-patient",
      ],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["epic.scanning.dmsusername", "fhirUser", "launch", "openid", "profile"],
      token_endpoint: "https://fhir.example.test/oauth2/token",
    }));

    const configuration = await discoverSmartConfiguration({
      fetchImpl,
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      requestedBaseScopes: baseScopes,
      resourceTypes,
    });

    expect(configuration.requestedScopes).toEqual([
      ...baseScopes,
      "patient/Patient.r",
      "patient/Observation.s",
      "patient/DiagnosticReport.s",
      "patient/Binary.r",
      "patient/Media.r",
    ]);
    expect(configuration.requestedResourceTypes).toEqual(resourceTypes);
  });

  it("falls back to SMART v1 read scopes and fails without standalone patient capability", () => {
    expect(selectSmartRequestedScopes({
      capabilities: ["permission-v1", "context-standalone-patient"],
      requestedBaseScopes: baseScopes,
      resourceTypes,
    }).scopes).toEqual([
      ...baseScopes,
      "patient/Patient.read",
      "patient/Observation.read",
      "patient/DiagnosticReport.read",
      "patient/Binary.read",
      "patient/Media.read",
    ]);

    expect(() => selectSmartRequestedScopes({
      capabilities: ["permission-v2"],
      requestedBaseScopes: baseScopes,
      resourceTypes,
    })).toThrow(/standalone patient/u);
  });

  it("accepts partial useful grants and derives only exact or wildcard-granted families", async () => {
    const requestedScopes = [
      ...baseScopes,
      "patient/Patient.r",
      "patient/Observation.s",
      "patient/DiagnosticReport.s",
    ];
    const token = await exchangeSmartAuthorizationCode({
      auth: { method: "public" as const, clientId: "client-id" },
      code: "authorization-code",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: "access-token",
        expires_in: 3600,
        patient: "patient-1",
        refresh_token: "unexpected-refresh-token",
        scope: [...baseScopes, "patient/Patient.r", "patient/Observation.s"].join(" "),
        token_type: "Bearer",
      })),
      redirectUri: "https://app.example.test/api/clinical-records/oauth/callback",
      requestedScopes,
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
      verifier: "verifier",
    });

    expect(readGrantedSmartResourceTypes(token.grantedScopes, resourceTypes)).toEqual([
      "Patient",
      "Observation",
    ]);
    expect(token).not.toHaveProperty("refreshToken");
    expect(token.patientId).toBe("patient-1");
    expect(readGrantedSmartResourceTypes(["patient/*.read"], resourceTypes)).toEqual(resourceTypes);
    expect(readGrantedSmartResourceTypes(
      [
        "patient/Patient.s",
        "patient/Observation.r",
        "patient/DiagnosticReport.rs",
        "patient/Observation.horse",
      ],
      resourceTypes,
    )).toEqual(["DiagnosticReport"]);
  });

  it("retains primary document access when the provider withholds Binary read permission", async () => {
    const selection = selectSmartRequestedScopes({
      capabilities: ["permission-v2", "context-standalone-patient"],
      requestedBaseScopes: baseScopes,
      resourceTypes: ["Patient", "DocumentReference"],
    });
    expect(selection.scopes).toContain("patient/Binary.r");
    const token = await exchangeSmartAuthorizationCode({
      auth: { method: "public" as const, clientId: "client-id" }, code: "authorization-code", verifier: "verifier",
      redirectUri: "https://app.example.test/api/clinical-records/oauth/callback",
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
      requestedScopes: selection.scopes,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: "access-token", expires_in: 3600, patient: "patient-1", token_type: "Bearer",
        scope: [...baseScopes, "patient/Patient.r", "patient/DocumentReference.s"].join(" "),
      })),
    });
    expect(readGrantedSmartResourceTypes(token.grantedScopes, selection.resourceTypes))
      .toEqual(["Patient", "DocumentReference"]);
    expect(epicBinaryReadIsGranted(token.grantedScopes)).toBe(false);
    expect(epicMediaReadIsGranted(token.grantedScopes)).toBe(false);
    expect(selection.scopes).not.toContain("patient/Media.r");
    expect(selectSmartRequestedScopes({
      capabilities: ["permission-v2", "context-standalone-patient"],
      requestedBaseScopes: baseScopes, resourceTypes: ["Patient", "Observation"],
    }).scopes).not.toContain("patient/Binary.r");
  });

  it("normalizes a FHIR Patient reference and rejects invalid patient launch context", async () => {
    const tokenResponse = (patient: string) => jsonResponse({
      access_token: "access-token",
      patient,
      scope: [...baseScopes, "patient/Patient.r", "patient/Observation.s"].join(" "),
      token_type: "Bearer",
    });
    const input = {
      auth: { method: "public" as const, clientId: "client-id" },
      code: "authorization-code",
      redirectUri: "https://app.example.test/api/clinical-records/oauth/callback",
      requestedScopes: [...baseScopes, "patient/Patient.r", "patient/Observation.s"],
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
      verifier: "verifier",
    };

    await expect(exchangeSmartAuthorizationCode({
      ...input,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("Patient/patient-1")),
    })).resolves.toMatchObject({ patientId: "patient-1" });

    await expect(exchangeSmartAuthorizationCode({
      ...input,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("Practitioner/patient-1")),
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_TOKEN_INVALID" });
  });

  it("rejects a token grant without Patient plus one clinical family", async () => {
    await expect(exchangeSmartAuthorizationCode({
      auth: { method: "public" as const, clientId: "client-id" },
      code: "authorization-code",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: "access-token",
        patient: "patient-1",
        scope: [...baseScopes, "patient/Observation.s"].join(" "),
        token_type: "Bearer",
      })),
      redirectUri: "https://app.example.test/api/clinical-records/oauth/callback",
      requestedScopes: [...baseScopes, "patient/Patient.r", "patient/Observation.s"],
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
      verifier: "verifier",
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_SCOPES_INSUFFICIENT" });
  });

  it("cancels oversized SMART responses when Content-Length is missing", async () => {
    const streamed = oversizedJsonResponse([32 * 1_024, 32 * 1_024, 1], null);

    await expect(discoverSmartConfiguration({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(streamed.response),
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      requestedBaseScopes: baseScopes,
      resourceTypes,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_RESPONSE_TOO_LARGE" });
    expect(streamed.wasCanceled()).toBe(true);
  });

  it("rejects malformed UTF-8 in a SMART response", async () => {
    const prefix = new TextEncoder().encode(
      '{"authorization_endpoint":"https://fhir.example.test/oauth2/authorize","capabilities":["permission-v2","context-standalone-patient"],"code_challenge_methods_supported":["S256"],"id":"',
    );
    const suffix = new TextEncoder().encode(
      '","token_endpoint":"https://fhir.example.test/oauth2/token"}',
    );
    const body = new Uint8Array(prefix.length + 1 + suffix.length);
    body.set(prefix);
    body[prefix.length] = 0xff;
    body.set(suffix, prefix.length + 1);

    await expect(discoverSmartConfiguration({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
        headers: { "Content-Type": "application/json" },
      })),
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      requestedBaseScopes: baseScopes,
      resourceTypes,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_RESPONSE_INVALID" });
  });
});

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    headers: { "Content-Type": "application/json" },
  });
}

function oversizedJsonResponse(chunkSizes: number[], declaredLength: string | null): {
  response: Response;
  wasCanceled: () => boolean;
} {
  let canceled = false;
  const chunks = [...chunkSizes];
  const response = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
    pull(controller) {
      const size = chunks.shift();
      if (size === undefined) return;
      controller.enqueue(new Uint8Array(size));
    },
  }), {
    headers: {
      "Content-Type": "application/json",
      ...(declaredLength === null ? {} : { "Content-Length": declaredLength }),
    },
  });
  return { response, wasCanceled: () => canceled };
}


describe("persistent SMART access", () => {
  it("requests offline access only for explicit consent and a capable portal", () => {
    const input = { capabilities: ["permission-v2", "context-standalone-patient", "permission-offline"], requestedBaseScopes: baseScopes, resourceTypes };
    expect(selectSmartRequestedScopes(input).scopes).not.toContain("offline_access");
    expect(selectSmartRequestedScopes({ ...input, requestOfflineAccess: true }).scopes).toContain("offline_access");
    expect(selectSmartRequestedScopes({ ...input, requestOfflineAccess: true, capabilities: input.capabilities.slice(0, 2) }).scopes).not.toContain("offline_access");
  });

  it("rotates refresh tokens with confidential Basic authentication and retains omitted scope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 300, token_type: "Bearer",
    }));
    const result = await refreshSmartAccessToken({ auth: { method: "basic", clientId: "client:one", clientSecret: "secret space" }, refreshToken: "old-refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["offline_access", "patient/Patient.r", "patient/Observation.s"], fetchImpl });
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "rotated-refresh", grantedScopes: ["offline_access", "patient/Patient.r", "patient/Observation.s"] });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe(`Basic ${Buffer.from("client%3Aone:secret+space").toString("base64")}`);
    expect(String(init.body)).toBe("grant_type=refresh_token&refresh_token=old-refresh");
    expect(init.redirect).toBe("manual");
  });

  it.each([400, 401, 429, 503])("classifies a refresh HTTP %s without exposing its body", async (status) => {
    await expect(refreshSmartAccessToken({ auth: { method: "basic", clientId: "client", clientSecret: "secret" }, refreshToken: "refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["patient/Patient.r", "patient/Observation.s"],
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider response", { status })) }))
      .rejects.toMatchObject({ retryable: status === 429 || status === 503 });
  });

  it("requires reconnecting when renewal narrows the patient grant", async () => {
    await expect(refreshSmartAccessToken({ auth: { method: "basic", clientId: "client", clientSecret: "secret" }, refreshToken: "refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["patient/Patient.r", "patient/Observation.s", "patient/DocumentReference.s"],
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ access_token: "new", expires_in: 300,
        token_type: "Bearer", scope: "patient/Patient.r patient/Observation.s" })) })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_GRANT_CHANGED" });
  });
});

describe("Epic signed client authentication", () => {
  it("signs a one-time PKCE exchange and each rolling refresh for the pinned endpoint", async ({ onTestFinished }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => { vi.useRealTimers(); });
    const now = Math.floor(Date.now() / 1000);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { n, e } = publicKey.export({ format: "jwk" });
    const publicJwk = { kty: "RSA", alg: "RS384", use: "sig", kid: "synthetic-key", n: n!, e: e! };
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => epicAssertionSigner("client", pem, [])).toThrow();
    const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    const previous = { ...publicJwk, kid: "previous-key", n: otherKey.n!, e: otherKey.e! };
    expect(() => epicAssertionSigner("client", pem, [previous])).toThrow();
    const auth = epicAssertionSigner("client", pem, [previous, publicJwk]);
    const tokenEndpoint = "https://portal.example.test/token";
    const scopes = ["patient/Patient.r", "patient/Observation.s"];
    const ids = new Set();
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(tokenEndpoint);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      const fields = new URLSearchParams(String(init?.body));
      expect(fields.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
      const assertion = fields.get("client_assertion")!;
      const { payload, protectedHeader } = await jwtVerify(assertion, createLocalJWKSet({ keys: [previous, publicJwk] }), { audience: tokenEndpoint,
        issuer: auth.clientId, subject: auth.clientId, algorithms: ["RS384"], currentDate: new Date((now - 60) * 1000) });
      expect(protectedHeader).toEqual({ alg: "RS384", typ: "JWT", kid: publicJwk.kid });
      await expect(jwtVerify(assertion, publicKey, { audience: "https://other.example.test/token" })).rejects.toThrow();
      await expect(jwtVerify(assertion, createLocalJWKSet({ keys: [{ ...publicJwk, kid: "wrong-key" }] })))
        .rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
      expect(payload).toMatchObject({ iat: now - 60, nbf: now - 60, exp: now + 120 });
      expect(payload.jti).toMatch(/^[a-f0-9-]{36}$/u);
      ids.add(payload.jti);
      if (fields.get("grant_type") === "authorization_code") {
        expect(fields.get("code_verifier")).toBe("verifier");
        expect(fields.get("redirect_uri")).toBe("https://app.example.test/callback");
      } else {
        expect(fields.get("refresh_token")).toBe(`refresh-${ids.size - 1}`);
      }
      return jsonResponse({ access_token: "access", token_type: "Bearer", patient: "sample", expires_in: 300,
        refresh_token: `refresh-${ids.size}` });
    });
    const common = { auth, tokenEndpoint, fetchImpl };
    const oneTime = await exchangeSmartAuthorizationCode({ ...common, requestedScopes: scopes, code: "code",
      verifier: "verifier", redirectUri: "https://app.example.test/callback" });
    expect(oneTime.refreshToken).toBeUndefined();
    let refreshToken = "refresh-1";
    for (const successor of ["refresh-2", "refresh-3"]) {
      const renewed = await refreshSmartAccessToken({ ...common, grantedScopes: [...scopes, "offline_access"], refreshToken });
      expect(renewed.successorReturned).toBe(true);
      expect(renewed.refreshToken).toBe(successor);
      refreshToken = renewed.refreshToken;
    }
    expect(ids.size).toBe(3);
  });

  it("keeps the prior token but exposes an omitted successor", async () => {
    const result = await refreshSmartAccessToken({
      auth: { method: "basic", clientId: "client", clientSecret: "secret" },
      grantedScopes: ["offline_access", "patient/Patient.r", "patient/Observation.s"],
      refreshToken: "retained", tokenEndpoint: "https://portal.example.test/token",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ access_token: "access", token_type: "Bearer", expires_in: 300 })),
    });
    expect(result).toMatchObject({ refreshToken: "retained", successorReturned: false });
  });

  it("publishes only distinct RSA verification keys across both environments and integrations", () => {
    const kids = new Set<string>();
    const moduli = new Set<string>();
    expect(sandboxSet.keys.length).toBeGreaterThan(0);
    // Oracle registers this URL; its key is separate from every Epic key.
    expect(oracleProductionSet.keys.map((key) => key.kid)).toEqual(["murph-oracle-production-4D9w9oKpPTN3"]);
    for (const set of [sandboxSet, productionSet, oracleProductionSet]) {
      expect(Object.keys(set)).toEqual(["keys"]);
      for (const key of set.keys) {
        expect(Object.keys(key).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
        expect(key).toMatchObject({ kty: "RSA", alg: "RS384", use: "sig" });
        expect(key.kid.trim()).not.toBe("");
        const imported = createPublicKey({ key, format: "jwk" });
        const canonical = imported.export({ format: "jwk" });
        expect(imported.asymmetricKeyDetails!.modulusLength).toBeGreaterThanOrEqual(2048);
        expect(canonical.n).toBe(key.n);
        expect(canonical.e).toBe(key.e);
        expect(kids.has(key.kid)).toBe(false);
        expect(moduli.has(key.n)).toBe(false);
        kids.add(key.kid);
        moduli.add(key.n);
      }
    }
  });
});
