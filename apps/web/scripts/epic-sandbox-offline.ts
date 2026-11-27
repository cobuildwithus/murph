// Interactive proof against the fixed Epic sandbox. All OAuth state lives in this process.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readJson, receiveCode, step } from "./clinical-sandbox-consent";
import published from "../public/.well-known/epic/sandbox.jwks.json";
import { epicAssertionSigner } from "../src/lib/clinical-records/epic-client-auth";
import { EPIC_AUTOMATIC_RESOURCE_TYPES, EPIC_BETA_REQUESTED_BASE_SCOPES } from "../src/lib/clinical-records/epic-policy";
import {
  buildSmartAuthorizationUrl, createSmartPkce, createSmartState, discoverSmartConfiguration,
  exchangeSmartAuthorizationCode, refreshSmartAccessToken,
} from "../src/lib/clinical-records/smart";

const fhirBaseUrl = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";

async function main() {
  const [clientId, pemPath, kid, jwksUrl, redirectUri, certPath, tlsKeyPath] = process.argv.slice(2);
  const { auth, redirect, tls } = await step("Configuration", async () => {
    assert(clientId && pemPath && kid && jwksUrl && redirectUri && certPath && tlsKeyPath);
    const redirect = new URL(redirectUri);
    assert(redirect.protocol === "https:" && redirect.hostname === "127.0.0.1" && redirect.port
      && !redirect.search && !redirect.hash && !redirect.username && !redirect.password);
    const url = new URL(jwksUrl);
    assert(url.protocol === "https:" && url.pathname === "/.well-known/epic/sandbox.jwks.json"
      && !url.username && !url.password && !url.search && !url.hash);
    const auth = epicAssertionSigner(clientId, await readFile(pemPath, "utf8"), published.keys);
    assert.equal(auth.kid, kid);
    return { auth, redirect, tls: { cert: await readFile(certPath), key: await readFile(tlsKeyPath) } };
  });
  await step("Published key", async () => {
    const remote = await readJson(jwksUrl!);
    const matches = remote.keys.filter((key: { kid: string }) => key.kid === auth.kid);
    assert.deepEqual(matches, published.keys.filter(key => key.kid === auth.kid));
  });
  const smart = await step("Discovery", async () => {
    const smart = await discoverSmartConfiguration({ fhirBaseUrl, requestOfflineAccess: true,
      requestedBaseScopes: EPIC_BETA_REQUESTED_BASE_SCOPES, resourceTypes: EPIC_AUTOMATIC_RESOURCE_TYPES });
    assert(smart.requestedScopes.includes("offline_access"));
    return smart;
  });
  const { state } = createSmartState();
  const pkce = createSmartPkce();
  const code = await step("Patient consent", () => receiveCode(redirect, tls, buildSmartAuthorizationUrl({
    ...smart, audience: fhirBaseUrl, clientId: auth.clientId, redirectUri: redirect.href, state, challenge: pkce.challenge,
  }), state));
  const initial = await step("Offline code exchange", async () => {
    const token = await exchangeSmartAuthorizationCode({ ...smart, auth, code, redirectUri: redirect.href, verifier: pkce.verifier });
    assert(token.refreshToken && token.grantedScopes.includes("offline_access"));
    return { ...token, refreshToken: token.refreshToken };
  });
  let grant = initial;
  for (const round of [1, 2]) {
    const renewed = await step(`Rolling refresh ${round}`, async () => {
      const result = await refreshSmartAccessToken({ ...grant, auth, tokenEndpoint: smart.tokenEndpoint });
      assert(result.successorReturned && result.refreshToken !== grant.refreshToken);
      assert(!result.patientId || result.patientId === initial.patientId);
      return result;
    });
    await step(`Patient read ${round}`, async () => {
      const patient = await readJson(`${fhirBaseUrl}/Patient/${encodeURIComponent(initial.patientId)}`, {
        Accept: "application/fhir+json", Authorization: `Bearer ${renewed.accessToken}`,
      });
      assert(patient.resourceType === "Patient" && patient.id === initial.patientId);
    });
    grant = { ...renewed, patientId: initial.patientId };
  }
}

void main().catch(() => { process.exitCode = 1; });
