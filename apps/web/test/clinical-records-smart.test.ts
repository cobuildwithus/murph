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
      clientId: "client-id",
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
      clientId: "client-id", code: "authorization-code", verifier: "verifier",
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
      clientId: "client-id",
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
      clientId: "client-id",
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
    const result = await refreshSmartAccessToken({ clientId: "client:one", clientSecret: "secret space", refreshToken: "old-refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["offline_access", "patient/Patient.r", "patient/Observation.s"], fetchImpl });
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "rotated-refresh", grantedScopes: ["offline_access", "patient/Patient.r", "patient/Observation.s"] });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe(`Basic ${Buffer.from("client%3Aone:secret+space").toString("base64")}`);
    expect(String(init.body)).toBe("grant_type=refresh_token&refresh_token=old-refresh");
    expect(init.redirect).toBe("manual");
  });

  it.each([400, 401, 429, 503])("classifies a refresh HTTP %s without exposing its body", async (status) => {
    await expect(refreshSmartAccessToken({ clientId: "client", clientSecret: "secret", refreshToken: "refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["patient/Patient.r", "patient/Observation.s"],
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider response", { status })) }))
      .rejects.toMatchObject({ retryable: status === 429 || status === 503 });
  });

  it("requires reconnecting when renewal narrows the patient grant", async () => {
    await expect(refreshSmartAccessToken({ clientId: "client", clientSecret: "secret", refreshToken: "refresh",
      tokenEndpoint: "https://portal.example.test/token", grantedScopes: ["patient/Patient.r", "patient/Observation.s", "patient/DocumentReference.s"],
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ access_token: "new", expires_in: 300,
        token_type: "Bearer", scope: "patient/Patient.r patient/Observation.s" })) })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_GRANT_CHANGED" });
  });
});
