import { randomUUID } from "node:crypto";
import { addHostedExecutionRuntimeAuthority, encodeHostedExecutionSignedRequestPayload } from "@murphai/hosted-execution/auth";
import { parseHostedClinicalRecordsFetchPageResponse, parseHostedClinicalRecordsReadRunResponse } from "@murphai/hosted-execution/clinical-records";
import {
  HOSTED_EXECUTION_NONCE_HEADER, HOSTED_EXECUTION_SIGNATURE_HEADER, HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER, HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { expect, vi } from "vitest";
import { POST as readRun } from "../../app/api/internal/clinical-records/runtime/read-run/route";
import { POST as fetchPage } from "../../app/api/internal/clinical-records/runtime/fetch-page/route";
import { POST as recordOutcome } from "../../app/api/internal/clinical-records/runtime/record-outcome/route";
import type { ClinicalCheckpointInput } from "../../../../packages/assistant-runtime/test/clinical-connector-runtime";

export async function createClinicalRuntimeRoutePort(userId: string, authority: {
  attemptId: string; generation: string; workspaceVersion: string;
}): Promise<ClinicalCheckpointInput["port"]> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "fixture");
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", JSON.stringify(await crypto.subtle.exportKey("jwk", keys.publicKey)));
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON", "{}");
  const routes = { "read-run": readRun, "fetch-page": fetchPage, "record-outcome": recordOutcome };
  async function post(route: keyof typeof routes, body: unknown): Promise<unknown> {
    const url = new URL(`/api/internal/clinical-records/runtime/${route}`, "https://app.example.test");
    addHostedExecutionRuntimeAuthority(url, authority);
    const payload = JSON.stringify(body);
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey,
      encodeHostedExecutionSignedRequestPayload({ method: "POST", nonce, path: url.pathname, payload, search: url.search, timestamp, userId }));
    const response = await routes[route](new Request(url, { method: "POST", body: payload, headers: {
      "content-type": "application/json",
      "x-hosted-runtime-attempt-id": authority.attemptId,
      "x-hosted-runtime-lease-generation": authority.generation,
      "x-hosted-runtime-workspace-version": authority.workspaceVersion,
      [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString("base64url"),
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "fixture",
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
      [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
    } }));
    expect(response.status, route).toBe(200);
    return response.json();
  }
  return {
    readRun: async body => parseHostedClinicalRecordsReadRunResponse(await post("read-run", body)),
    fetchPage: async body => parseHostedClinicalRecordsFetchPageResponse(await post("fetch-page", body)),
    recordOutcome: async body => { expect(await post("record-outcome", body)).toEqual({ ok: true }); },
  };
}
