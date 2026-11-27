import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { cleanEnv, base, oauth, options, requireClient, requirePatient, withinBands, families } from "../scripts/epic-proof/policy";
import { fixtureResource } from "../scripts/epic-proof/evidence";
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

it("requires named families and retains only structural local fixture fields", () => {
  const counts = Object.fromEntries(families.map(k => [k, 1]));
  expect(withinBands("fhirderrick", counts)).toBe(true);
  expect(withinBands("fhirderrick", { ...counts, Condition: 0 })).toBe(false);
  const fixture = fixtureResource({ resourceType: "Observation", id: "synthetic-id", status: "final", text: "private-marker",
    extension: [{ token: "private-marker" }], link: [{ url: "private-marker" }] });
  expect(fixture).toEqual({ resourceType: "Observation", id: expect.stringMatching(/^[0-9a-f]{64}$/), status: "final" });
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
