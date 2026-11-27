import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import published from "../public/.well-known/oracle/sandbox.jwks.json";
import { ORACLE_SANDBOX_CALLBACK, ORACLE_SANDBOX_ENTRY, resolveOracleStart } from "../src/lib/clinical-records/oracle-integration";
import {
  buildOracleDailyRetrievalPlan, buildOracleInitialFhirPageUrl, buildOracleRetrievalPlan,
} from "../src/lib/clinical-records/oracle-policy";
import {
  buildSmartAuthorizationUrl, createSmartPkce, createSmartState, discoverSmartConfiguration,
  exchangeSmartAuthorizationCode, refreshSmartAccessToken,
} from "../src/lib/clinical-records/smart";
import { readJson, receiveCode, step } from "./clinical-sandbox-consent";

async function main() {
  const [memberId, jwksUrl, certPath, tlsKeyPath] = process.argv.slice(2);
  const redirect = new URL(ORACLE_SANDBOX_CALLBACK);
  const { fhirBaseUrl, requestedBaseScopes } = ORACLE_SANDBOX_ENTRY;
  const { configuration, tls } = await step("Configuration", async () => {
    assert(memberId && certPath && tlsKeyPath && jwksUrl);
    const url = new URL(jwksUrl);
    assert(url.href === `${url.origin}/.well-known/oracle/sandbox.jwks.json` && url.protocol === "https:");
    const configuration = resolveOracleStart(ORACLE_SANDBOX_ENTRY, memberId, redirect.href);
    const tls = { cert: await readFile(certPath), key: await readFile(tlsKeyPath) };
    assert.deepEqual(await readJson(url.href), published);
    return { configuration, tls };
  });
  const { auth, endpointTrust, permissionVersion, resourceTypes } = configuration;
  const smart = await step("Discovery", async () => {
    const result = await discoverSmartConfiguration({ fhirBaseUrl, requestedBaseScopes, resourceTypes,
      requestOfflineAccess: true, endpointTrust, permissionVersion });
    assert(result.requestedScopes.includes("offline_access"));
    return result;
  });
  const pkce = createSmartPkce();
  const { state } = createSmartState();
  const code = await step("Patient consent", () => receiveCode(redirect, tls, buildSmartAuthorizationUrl({
    ...smart, audience: fhirBaseUrl, clientId: auth.clientId, redirectUri: redirect.href, state, challenge: pkce.challenge,
  }), state));
  const grant = await step("Offline code exchange", async () => {
    const token = await exchangeSmartAuthorizationCode({ ...smart, auth, code, redirectUri: redirect.href, verifier: pkce.verifier });
    assert(token.refreshToken && token.grantedScopes.includes("offline_access"));
    return { ...token, refreshToken: token.refreshToken };
  });
  const renewed = await step("Refresh", async () => {
    const token = await refreshSmartAccessToken({ ...grant, auth, tokenEndpoint: smart.tokenEndpoint });
    assert(!token.patientId || token.patientId === grant.patientId);
    return token;
  });
  const headers = { Accept: "application/fhir+json", Authorization: `Bearer ${renewed.accessToken}` };
  await step("Patient read", async () => {
    const patient = await readJson(`${fhirBaseUrl}/Patient/${encodeURIComponent(grant.patientId)}`, headers);
    assert(patient.resourceType === "Patient" && patient.id === grant.patientId);
  });
  // Settles the Encounter `status` and `_lastUpdated` questions with the production query catalog.
  await step("Encounter searches", async () => {
    const initial = buildOracleRetrievalPlan({ resourceTypes: ["Patient", "Encounter"] });
    const daily = buildOracleDailyRetrievalPlan({ previous: initial, now: new Date(), generation: 1 })!;
    for (const retrievalSlice of [...initial.slices, ...daily.slices].filter(slice => slice.resourceType === "Encounter")) {
      const page = buildOracleInitialFhirPageUrl({ fhirBaseUrl, patientId: grant.patientId, retrievalSlice });
      assert((await readJson(page.href, headers)).resourceType === "Bundle");
    }
  });
}

void main().catch(() => { process.exitCode = 1; });
