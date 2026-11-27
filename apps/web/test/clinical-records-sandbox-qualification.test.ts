import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { cleanEnv, base, oauth, options, requireClient, requirePatient, withinBands, families } from "../scripts/epic-proof/policy";
import { hashClinicalFhirBaseUrl, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { fixtureResource, observeSnapshot } from "../scripts/epic-proof/evidence";
import { privatePhase, type Summary } from "../scripts/epic-proof/private-process";
import { boundedEpicTransport } from "../scripts/epic-proof/transport";

it("rejects foreign destinations, signers, patients, and budget overflow before the transport runs", async () => {
  const send = vi.fn(async () => new Response("{}"));
  const fetch = boundedEpicTransport({ transport: send, deadline: Date.now() + 1_000, budget: 1, patient: "fhircamila", unavailable: vi.fn() });
  expect(() => options(["--vendor", "epic", "--patient", "foreign"])).toThrow();
  expect(() => requireClient("foreign-registration")).toThrow();
  expect(() => requirePatient("fhircamila", "foreign-chart")).toThrow();
  for (const url of ["https://example.invalid/FHIR/R4", oauth + "other", base + "-other/Patient"]) await expect(fetch(url)).rejects.toThrow();
  await expect(fetch(base + "/Patient", { method: "POST" })).rejects.toThrow();
  await expect(fetch(new Request(base + "/Patient", { method: "POST" }))).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  await fetch(base + "/Patient");
  await expect(fetch(base + "/Patient")).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});

it("holds the measured family bands and retains only structural local fixture fields", () => {
  // The 2026-11-27 live counts for each account.
  const none = Object.fromEntries(families.map(k => [k, 0]));
  const camila = { ...none, Patient: 1, AllergyIntolerance: 1, Condition: 7, MedicationRequest: 1, Observation: 264, DiagnosticReport: 6,
    DocumentReference: 4, Encounter: 5, Procedure: 1, Immunization: 1, CarePlan: 1, CareTeam: 1, Goal: 2, ServiceRequest: 4 };
  const counts = { ...none, Patient: 1, AllergyIntolerance: 1, Condition: 2, MedicationRequest: 1, Observation: 1615, CarePlan: 1, Goal: 2, ServiceRequest: 1 };
  expect(withinBands("fhircamila", camila)).toBe(true);
  expect(withinBands("fhirderrick", counts)).toBe(true);
  for (const drift of [{ Condition: 0 }, { Observation: 4000 }, { Encounter: 6 }, { MedicationStatement: 1 }, { Patient: 2 }] as Record<string, number>[])
    expect(withinBands("fhirderrick", { ...counts, ...drift })).toBe(false);
  const fixture = fixtureResource({ resourceType: "Observation", id: "synthetic-id", status: "final", text: "private-marker",
    extension: [{ token: "private-marker" }], link: [{ url: "private-marker" }] });
  expect(fixture).toEqual({ resourceType: "Observation", id: expect.stringMatching(/^[0-9a-f]{64}$/), status: "final" });
});

it("counts a family's records without the vendor's marked search-outcome notices", () => {
  const content = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [
    { resource: { resourceType: "Observation", id: "synthetic-observation", status: "final", subject: { reference: "Patient/synthetic-patient" } }, search: { mode: "match" } },
    { resource: { resourceType: "OperationOutcome", issue: [{ severity: "warning", code: "processing" }] }, search: { mode: "outcome" } },
  ] });
  const relativePath = "Observation/page.json";
  const manifest = {
    schemaVersion: "murph.clinical-raw-manifest.v2", kind: "clinical_fhir_retrieval", connectionId: "connection-1", retrievalJobId: "retrieval-1",
    sourceSystem: "epic-fhir", fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), fetchedAt: "2026-07-01T12:00:00Z",
    requestedScopes: ["patient/Observation.read"], grantedScopes: ["patient/Observation.read"],
    resourceFiles: [{ resourceType: "Observation", relativePath, count: 2, sha256: createHash("sha256").update(content).digest("hex") }],
    retrievalScopes: [{ coverage: "whole-family", queryFingerprint: "a".repeat(64), resourceType: "Observation" }],
    completedResourceTypes: ["Observation"], documentAttachments: [],
  };
  const counts = { Observation: 0, downloaded: 0, parsed: 0 };
  const snapshot = { manifestPath: "raw/clinical/fhir/connection-1/retrieval-1/manifest.json", manifest, pages: [{ content, relativePath }] };
  expect(observeSnapshot(snapshot, counts, new Map())).toBe(1);
  expect(counts.Observation).toBe(1);
});

it("drops thrown assertions, raw browser diagnostics and forged summary fields at the process boundary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clinical-redaction-"));
  try {
    const entry = join(dir, "failing.cjs");
    await writeFile(entry, `
      process.once("message", async () => {
        const marker = "private-marker";
        if (process.env.PROBE_BROWSER) {
          const { join } = require("node:path");
          const web = require("node:module").createRequire(join(process.cwd(), "apps/web/package.json"));
          const { chromium } = web("@playwright/test");
          const { boundBrowserNetwork, privateContext } = web("./scripts/epic-proof/browser-network.ts");
          const browser = await chromium.launch({ headless: true, artifactsDir: __dirname, tracesDir: __dirname });
          try {
            const page = await (await browser.newContext(privateContext)).newPage();
            await boundBrowserNetwork(page);
            try { await page.goto("https://denied.invalid/?code=" + marker); process.exit(3); }
            catch (error) { console.error(error); }
          } finally { await browser.close(); }
        }
        console.error({ url: "?code=" + marker, trace: marker, storageState: marker, har: marker });
        process.send({ outcome: "app-failure", stage: marker, counts: { token: marker, Observation: marker, Patient: 1 } }, () =>
          require("node:assert/strict").deepEqual({ cookie: marker }, { assertion: marker }));
      });`);
    const summary: Summary = { stage: "login", outcome: "app-failure", counts: {} };
    await expect(privatePhase(pathToFileURL(entry), process.cwd(), { ...cleanEnv(), PROBE_BROWSER: process.env.MURPH_TEST_EPIC_CHROMIUM }, "initial", Date.now() + 30_000, summary)).rejects.toThrow("Sandbox proof failed");
    expect(summary).toEqual({ stage: "login", outcome: "app-failure", counts: { Patient: 1 } });
    expect(await readdir(dir)).toEqual(["failing.cjs"]);
    expect(cleanEnv()).not.toHaveProperty("DEBUG");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
