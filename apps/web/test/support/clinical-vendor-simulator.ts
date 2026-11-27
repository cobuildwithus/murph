import { createHash, randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JWK } from "jose";

// Synthetic wire shapes from clinical-records-smart and the Epic sandbox offline proof.
export const epicWireProfile = {
  base: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
  authorize: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
  token: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
  patient: "fixture-chart",
  clientId: "fixture-signed-client",
  discovery: {
    capabilities: ["context-standalone-patient", "permission-v1", "permission-v2", "permission-offline"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "fhirUser", "profile"],
  },
  // Epic returns a new refresh token on every exchange. Patient and scope are optional on renewal.
  tokenResponse(grant: Exchange, patient: string, scope: string) {
    return { access_token: randomUUID(), refresh_token: randomUUID(), token_type: "Bearer", expires_in: 3600,
      ...(grant === "authorization_code" ? { patient, scope } : {}) };
  },
  grants: ["openid", "fhirUser", "launch/patient", "offline_access", "patient/Patient.r", "patient/Observation.s", "patient/Encounter.s"],
};

type Resource = { resourceType: string; id: string; [field: string]: unknown };
type Exchange = "authorization_code" | "refresh_token";
type Operation = Exchange | "discovery" | "authorize" | "read" | "search";
type Fault = (response: Response, url: URL) => Response | Promise<Response>;

/** A single offline portal. Faults are consumed at scenario-selected wire boundaries. */
export function createClinicalVendorSimulator(profile: typeof epicWireProfile, publicKey: JWK) {
  const codes = new Map<string, { challenge: string; redirect: string; scope: string }>();
  const keys = createLocalJWKSet({ keys: [publicKey] });
  const faults = new Map<Operation, Fault>();
  const requests: { operation: Operation; url: URL }[] = [];
  let access: string | undefined;
  let refresh: string | undefined;
  let scope = "";
  const reads = new Map<string, Resource>([[`Patient/${profile.patient}`, { resourceType: "Patient", id: profile.patient }]]);
  const searches = new Map<string, Resource[]>();
  const searchKey = (family: string, category: string | null) => JSON.stringify([family, category]);
  const denied = () => Response.json({ error: "invalid_grant" }, { status: 400 });

  function authorize(url: URL) {
    const query = url.searchParams;
    const redirect = query.get("redirect_uri");
    const challenge = query.get("code_challenge");
    if (query.get("client_id") !== profile.clientId || query.get("aud") !== profile.base ||
        query.get("code_challenge_method") !== "S256" || !challenge || !redirect || !query.get("state")) return denied();
    const code = randomUUID();
    const requested = query.get("scope")?.split(" ") ?? [];
    codes.set(code, { challenge, redirect, scope: profile.grants.filter(s => requested.includes(s)).join(" ") });
    const location = new URL(redirect);
    location.search = new URLSearchParams({ state: query.get("state")!, code }).toString();
    return new Response(null, { status: 302, headers: { location: location.href } });
  }

  async function exchange(form: URLSearchParams, grant: Exchange) {
    try {
      await jwtVerify(form.get("client_assertion") ?? "", keys, {
        issuer: profile.clientId, subject: profile.clientId, audience: profile.token, algorithms: ["RS384"],
      });
    } catch {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const issued = codes.get(code);
      codes.delete(code);
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!issued || issued.challenge !== challenge || issued.redirect !== form.get("redirect_uri")) return denied();
      scope = issued.scope;
    } else if (!refresh || form.get("refresh_token") !== refresh) return denied();
    const body = profile.tokenResponse(grant, profile.patient, scope);
    refresh = body.refresh_token;
    access = body.access_token;
    return Response.json(body);
  }

  function fhir(url: URL, request: Request) {
    if (!access || request.headers.get("authorization") !== `Bearer ${access}`) return new Response(null, { status: 401 });
    const path = (url.origin + url.pathname).slice(profile.base.length + 1);
    if (path.includes("/")) {
      const resource = reads.get(path);
      return resource ? Response.json(resource) : new Response(null, { status: 404 });
    }
    if (url.searchParams.get("patient") !== profile.patient) return denied();
    const page = Number(url.searchParams.get("fixture-page") ?? "0");
    const rows = searches.get(searchKey(path, url.searchParams.get("category"))) ?? [];
    const next = new URL(url);
    next.searchParams.set("fixture-page", String(page + 1));
    return Response.json({ resourceType: "Bundle", type: "searchset",
      entry: rows.slice(page, page + 1).map(resource => ({ resource })),
      link: page + 1 < rows.length ? [{ relation: "next", url: next.href }] : [] });
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    let operation: Operation;
    let response: Response;
    if (url.href === profile.base + "/.well-known/smart-configuration") {
      operation = "discovery";
      response = Response.json({ authorization_endpoint: profile.authorize, token_endpoint: profile.token,
        ...profile.discovery });
    } else if (url.origin + url.pathname === profile.authorize) {
      operation = "authorize";
      response = authorize(url);
    } else if (url.href === profile.token && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const grant = form.get("grant_type");
      if (grant !== "authorization_code" && grant !== "refresh_token") throw new Error("Unexpected synthetic grant type.");
      operation = grant;
      response = await exchange(form, grant);
    } else if (url.href.startsWith(profile.base + "/") && request.method === "GET") {
      operation = url.search ? "search" : "read";
      response = fhir(url, request);
    } else throw new Error("Request outside the synthetic portal.");
    // Keep request counts and FHIR query shapes only. OAuth URLs carry private parameters.
    requests.push({ operation, url: operation === "search" ? url : new URL(url.origin + url.pathname) });
    const fault = faults.get(operation);
    faults.delete(operation);
    return fault ? fault(response, url) : response;
  };
  return { fetchImpl, requests,
    setSearchResults(family: string, category: string | null, rows: Resource[]) {
      searches.set(searchKey(family, category), rows);
    },
    onNext(operation: Operation, fault: Fault) { faults.set(operation, fault); } };
}
