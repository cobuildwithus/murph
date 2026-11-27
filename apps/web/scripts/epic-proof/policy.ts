import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

export const origin = "https://127.0.0.1:8443";
export const callback = origin + "/callback";
export const vendor = "https://fhir.epic.com";
export const base = vendor + "/interconnect-fhir-oauth/api/FHIR/R4";
export const oauth = vendor + "/interconnect-fhir-oauth/oauth2/";
const registration = "d7eb521870732d1a706b52fb32bd008f5ba033a57854ef840499f20c735ec8dd";
export const patients = ["fhircamila", "fhirderrick", "fhirdesiree"];
export const stages = ["preflight", "database", "session", "start", "login", "callback", "import", "restart", "refresh", "repeat", "daily", "disconnect"];
export const outcomes = ["pass", "app-failure", "vendor-unavailable", "auth-blocked", "expectation-drift"];
export function check(value: unknown): asserts value {
  if (!value) throw new Error("Sandbox proof failed.");
}
export function requireClient(id: unknown) {
  check(typeof id === "string" && createHash("sha256").update(id).digest("hex") === registration);
}
export function options(args: string[]) {
  const { values } = parseArgs({ args, options: { vendor: { type: "string" }, patient: { type: "string", default: patients[0] }, interactive: { type: "boolean" } } });
  check(values.vendor === "epic" && values.patient && patients.includes(values.patient));
  return values;
}
export function cleanEnv() {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "DISPLAY", "XAUTHORITY", "SystemRoot"].flatMap(key =>
    process.env[key] ? [[key, process.env[key]]] : []));
}
export function allowWeb(url: string, method: string) {
  const u = new URL(url);
  check(!u.username && !u.password && !u.hash && u.origin === vendor &&
    ((method === "POST" && u.href === oauth + "token") || (method === "GET" && u.href.startsWith(base + "/"))));
}
export function requirePatient(patient: string, id: unknown) {
  const bindings: Record<string, string> = {
    fhircamila: "20c5269a14d38c604357ac59faf469a56b60af661f779340e52d07a443c7e816",
    fhirderrick: "eb1f8ac2fe818bfefa0db62c714089b5b3232994101beda28ae09dc9d156e37e",
    fhirdesiree: "59841bac03609133a5358e67e83ac924064a88fd43fea4cd265f78c3c97d762f",
  };
  check(typeof id === "string" && createHash("sha256").update(id).digest("hex") === bindings[patient]);
}
export function authorize(url: string) {
  const u = new URL(url);
  check(u.origin + u.pathname === oauth + "authorize" && !u.username && !u.password &&
    u.searchParams.get("redirect_uri") === callback && u.searchParams.get("aud") === base &&
    u.searchParams.get("scope")?.split(" ").includes("offline_access"));
  requireClient(u.searchParams.get("client_id"));
}
export const families = ["Patient", "AllergyIntolerance", "Condition", "Device", "FamilyMemberHistory", "MedicationDispense", "MedicationRequest", "MedicationStatement", "Observation", "DiagnosticReport", "DocumentReference", "Encounter", "Procedure", "Immunization", "CarePlan", "CareTeam", "Goal", "ServiceRequest"];
export function safeCounts(value: Record<string, number> | undefined) {
  return Object.fromEntries([...families, "upsert", "review", "retract", "downloaded", "parsed", "queued"].flatMap(key =>
    value && Number.isSafeInteger(value[key]) && value[key]! >= 0 ? [[key, value[key]]] : []));
}
type Band = readonly [min: number, max: number];
// Measured live on 2026-11-27. Each band is about 0.5x to 2x the measured count because the sandbox drifts weekly.
// A requested family measured at zero allows up to 5. Epic retrieval never requests FamilyMemberHistory or
// MedicationStatement, so they stay at zero. fhirdesiree is unmeasured and keeps its provisional published-chart bands.
const measuredBands: Record<string, Partial<Record<string, Band>>> = {
  fhircamila: { AllergyIntolerance: [1, 2], Condition: [4, 14], MedicationRequest: [1, 2], Observation: [132, 528],
    DiagnosticReport: [3, 12], DocumentReference: [2, 8], Encounter: [3, 10], Procedure: [1, 2], Immunization: [1, 2],
    CarePlan: [1, 2], CareTeam: [1, 2], Goal: [1, 4], ServiceRequest: [2, 8] },
  fhirderrick: { AllergyIntolerance: [1, 2], Condition: [1, 4], MedicationRequest: [1, 2], Observation: [808, 3230],
    CarePlan: [1, 2], Goal: [1, 4], ServiceRequest: [1, 2] },
};
const provisional: Record<string, string[]> = { fhirdesiree: ["Immunization", "Observation"] };
function band(patient: string, family: string): Band {
  if (family === "Patient") return [1, 1];
  if (family === "FamilyMemberHistory" || family === "MedicationStatement") return [0, 0];
  const measured = measuredBands[patient];
  return measured ? measured[family] ?? [0, 5] : [provisional[patient]!.includes(family) ? 1 : 0, 500];
}
export function withinBands(patient: string, counts: Record<string, number>) {
  return families.every(key => {
    const [min, max] = band(patient, key);
    return Number.isInteger(counts[key]) && counts[key]! >= min && counts[key]! <= max;
  });
}
