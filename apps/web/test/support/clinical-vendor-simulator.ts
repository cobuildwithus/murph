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
  // Report patient on renewal and omit scope to exercise inherited permissions.
  tokenResponse(grant: Exchange, patient: string, scope: string) {
    return { access_token: randomUUID(), refresh_token: randomUUID(), token_type: "Bearer", expires_in: 3600, patient,
      ...(grant === "authorization_code" ? { scope } : {}) };
  },
  grants: ["openid", "fhirUser", "launch/patient", "offline_access", "patient/Patient.r", "patient/Observation.s", "patient/Encounter.s"],
};

export const oracleWireProfile = {
  ...epicWireProfile,
  base: "https://fhir-myrecord.cerner.com/r4/0aB1cD2e-synthetic",
  authorize: "https://authorization.cerner.com/tenants/0aB1cD2e-synthetic/protocols/oauth2/profiles/smart-v1/personas/patient/authorize",
  token: "https://authorization.cerner.com/tenants/0aB1cD2e-synthetic/hosts/fhir-myrecord.cerner.com/protocols/oauth2/profiles/smart-v1/token",
  patient: "patient-1",
  searchPageSize: 1000,
};

type Resource = { resourceType: string; id: string; [field: string]: unknown };
type Exchange = "authorization_code" | "refresh_token";
type Operation = Exchange | "discovery" | "authorize" | "read" | "search";
type Fault = (response: Response, url: URL, signal: AbortSignal) => Response | Promise<Response>;

type Period = { start?: string; end?: string };
type DatedResource = Resource & {
  period?: Period; context?: { period?: Period }; effectivePeriod?: Period; performedPeriod?: Period;
  effectiveDateTime?: string; performedDateTime?: string; occurrenceDateTime?: string; issued?: string;
};

function matchesWindow(row: DatedResource, query: URLSearchParams) {
  const clinicalDate = row.period ?? row.effectivePeriod ?? row.performedPeriod
    ?? row.effectiveDateTime ?? row.performedDateTime ?? row.occurrenceDateTime;
  const fields = { date: clinicalDate, period: row.context?.period, issued: row.issued };
  for (const parameter of ["date", "period", "issued"] as const) {
    const value = fields[parameter];
    for (const bound of query.getAll(parameter)) {
      if (!value || !matchesDateBound(value, bound)) return false;
    }
  }
  return true;
}

function matchesDateBound(value: string | Period, bound: string) {
  const limit = Date.parse(bound.slice(2));
  const period = typeof value === "string" ? { start: value, end: value } : value;
  if (bound.startsWith("ge")) return period.end === undefined || Date.parse(period.end) >= limit;
  if (bound.startsWith("lt")) return period.start === undefined || Date.parse(period.start) < limit;
  throw new Error("Unexpected synthetic search bound.");
}

/** A single offline portal. Faults are consumed at scenario-selected wire boundaries. */
export function createClinicalVendorSimulator(profile: typeof epicWireProfile & { searchPageSize?: number }, publicKey: JWK, accessToken?: string) {
  const codes = new Map<string, { challenge: string; redirect: string; scope: string }>();
  const keys = createLocalJWKSet({ keys: [publicKey] });
  const faults = new Map<Operation, Fault>();
  const requests: { operation: Operation; url: URL }[] = [];
  let access = accessToken;
  let refresh: string | undefined;
  let scope = "";
  const reads = new Map<string, Resource>([[`Patient/${profile.patient}`, { resourceType: "Patient", id: profile.patient }]]);
  const searches = new Map<string, DatedResource[]>();
  const returnedIds: string[] = [];
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
    const rows = (searches.get(searchKey(path, url.searchParams.get("category"))) ?? [])
      .filter(row => matchesWindow(row, url.searchParams));
    const nextOffset = page + (profile.searchPageSize ?? 1);
    const entries = rows.slice(page, nextOffset);
    returnedIds.push(...entries.map(row => row.id));
    const next = new URL(url);
    next.searchParams.set("fixture-page", String(nextOffset));
    return Response.json({ resourceType: "Bundle", type: "searchset",
      entry: entries.map(resource => ({ resource })),
      link: nextOffset < rows.length ? [{ relation: "next", url: next.href }] : [] });
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
    return fault ? fault(response, url, request.signal) : response;
  };
  return { fetchImpl, requests, returnedIds,
    setRead(resource: Resource) { reads.set(resource.resourceType + "/" + resource.id, resource); },
    setSearchResults(family: string, category: string | null, rows: DatedResource[]) {
      searches.set(searchKey(family, category), rows);
    },
    onNext(operation: Operation, fault: Fault) { faults.set(operation, fault); } };
}
