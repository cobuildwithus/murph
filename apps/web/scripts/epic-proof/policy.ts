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
export function withinBands(patient: string, counts: Record<string, number>) {
  const expected: Record<string, string[]> = {
    fhircamila: ["Patient", "Observation", "DiagnosticReport", "MedicationRequest", "Procedure", "Goal"],
    fhirderrick: ["Patient", "Condition", "CarePlan", "Goal", "MedicationRequest", "Observation"],
    fhirdesiree: ["Patient", "Immunization", "Observation"],
  };
  return families.every(key => Number.isInteger(counts[key]) && counts[key]! >= (expected[patient]!.includes(key) ? 1 : 0) && counts[key]! <= (key === "Patient" ? 1 : 500));
}
