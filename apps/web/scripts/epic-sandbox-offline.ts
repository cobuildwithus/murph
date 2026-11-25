// Interactive proof against the fixed Epic sandbox. All OAuth state lives in this process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import published from "../public/.well-known/epic/sandbox.jwks.json";
import { epicAssertionSigner } from "../src/lib/clinical-records/epic-client-auth";
import { EPIC_AUTOMATIC_RESOURCE_TYPES, EPIC_BETA_REQUESTED_BASE_SCOPES } from "../src/lib/clinical-records/epic-policy";
import { readClinicalResponseBytes } from "../src/lib/clinical-records/response-bytes";
import { clinicalReturnQuery } from "../src/lib/clinical-records/return-query";
import {
  buildSmartAuthorizationUrl, createSmartPkce, createSmartState, discoverSmartConfiguration,
  exchangeSmartAuthorizationCode, refreshSmartAccessToken,
} from "../src/lib/clinical-records/smart";

const fhirBaseUrl = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";

async function step<T>(label: string, run: () => Promise<T>) {
  try {
    const result = await run();
    console.log(label, "PASS");
    return result;
  } catch {
    console.log(label, "FAIL");
    throw new Error("Sandbox proof failed");
  }
}

async function readJson(url: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  assert(response.ok);
  const bytes = await readClinicalResponseBytes(response, 1024 * 1024);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function receiveCode(redirect: URL, tls: { cert: Buffer; key: Buffer }, authorizationUrl: string, state: string) {
  const server = createServer(tls);
  const launch = new URL(`/start/${randomUUID()}`, redirect.origin);
  let launched = false;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Consent timed out")), 600_000);
      server.once("close", () => clearTimeout(timer));
      server.once("error", reject);
      server.on("request", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        const url = URL.parse(req.url ?? "/", redirect.origin);
        if (req.method !== "GET" || req.headers.host !== redirect.host || url?.origin !== redirect.origin) {
          res.writeHead(404).end();
          return;
        }
        if (!launched && url.href === launch.href) {
          launched = true;
          res.writeHead(302, { Location: authorizationUrl }).end();
          return;
        }
        if (url.pathname !== redirect.pathname) {
          res.writeHead(404).end();
          return;
        }
        const query = clinicalReturnQuery(url.searchParams);
        if (!query || query.get("state") !== state) {
          res.writeHead(400).end();
          return;
        }
        res.end("Return to the terminal.");
        const code = query.get("code");
        if (code) resolve(code);
        else reject(new Error("Consent declined"));
      });
      server.listen(Number(redirect.port), redirect.hostname, () => {
        const browser = spawn(process.platform === "darwin" ? "open" : "xdg-open", [launch.href], { stdio: "ignore" });
        browser.once("error", reject);
        browser.once("exit", status => { if (status !== 0) reject(new Error("Browser launch failed")); });
      });
    });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

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
