import { describe, expect, it, vi } from "vitest";

import {
  discoverSmartConfiguration,
  exchangeSmartAuthorizationCode,
  readGrantedSmartResourceTypes,
  selectSmartRequestedScopes,
} from "@/src/lib/clinical-records/smart";

const baseScopes = ["openid", "fhirUser", "launch/patient"];
const resourceTypes = ["Patient", "Observation", "Goal"];

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
      "patient/Patient.rs",
      "patient/Observation.rs",
      "patient/Goal.rs",
      "offline_access",
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
      "patient/Goal.read",
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
      "patient/Patient.rs",
      "patient/Observation.rs",
      "patient/Goal.rs",
    ];
    const token = await exchangeSmartAuthorizationCode({
      clientId: "client-id",
      code: "authorization-code",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: "access-token",
        expires_in: 3600,
        patient: "patient-1",
        scope: [...baseScopes, "patient/Patient.rs", "patient/Observation.rs"].join(" "),
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
    expect(readGrantedSmartResourceTypes(["patient/*.read"], resourceTypes)).toEqual(resourceTypes);
  });

  it("rejects a token grant without Patient plus one clinical family", async () => {
    await expect(exchangeSmartAuthorizationCode({
      clientId: "client-id",
      code: "authorization-code",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: "access-token",
        patient: "patient-1",
        scope: [...baseScopes, "patient/Observation.rs"].join(" "),
        token_type: "Bearer",
      })),
      redirectUri: "https://app.example.test/api/clinical-records/oauth/callback",
      requestedScopes: [...baseScopes, "patient/Patient.rs", "patient/Observation.rs"],
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
