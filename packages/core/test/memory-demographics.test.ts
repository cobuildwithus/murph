import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forgetMemory, readMemoryDemographics, readMemoryDocument, setMemoryDemographics, updateMemory, upsertMemory } from "../src/memory.ts";
const roots: string[] = [];
async function vault() { const root = await mkdtemp(path.join(tmpdir(), "demographics-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const memberAction = { actionId: "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830", requestedAt: "2025-12-31T23:30:00Z" };

it("writes both fields atomically, preserves omissions through concurrent writers, and exact retry does no write", async () => {
  const root = await vault();
  expect((await setMemoryDemographics(root, { birthYear: 1986, biologicalSex: "female" })).status).toBe("applied");
  const before = await readFile(path.join(root, "bank/memory.md"), "utf8");
  expect((await setMemoryDemographics(root, { birthYear: 1986, biologicalSex: "female" })).status).toBe("unchanged");
  expect(await readFile(path.join(root, "bank/memory.md"), "utf8")).toBe(before);
  await Promise.all([setMemoryDemographics(root, { birthYear: 1985 }), setMemoryDemographics(root, { biologicalSex: "male" })]);
  expect(await readMemoryDemographics(root)).toMatchObject({ birthYear: 1985, biologicalSex: "male" });
});

it("replays the original outcome after write-before-outcome and a later chat correction", async () => {
  const root = await vault();
  expect((await setMemoryDemographics(root, { age: 39, memberAction })).status).toBe("applied");
  expect(await readMemoryDemographics(root)).toMatchObject({ birthYear: 1986, birthYearPrecision: "approximate" });
  await setMemoryDemographics(root, { birthYear: 1980 });
  expect((await setMemoryDemographics(root, { age: 39, memberAction })).status).toBe("applied");
  expect((await readMemoryDemographics(root)).birthYear).toBe(1980);
  await expect(setMemoryDemographics(root, { age: 40, memberAction })).rejects.toMatchObject({ code: "MEMORY_RECORD_CONFLICT" });
  await expect(setMemoryDemographics(root, { age: 39, memberAction: { ...memberAction, requestedAt: "2026-01-01T00:00:00Z" } })).rejects.toMatchObject({ code: "MEMORY_RECORD_CONFLICT" });
});

it("canonical write order, including a delayed onboarding save, determines the value", async () => {
  const root = await vault();
  await setMemoryDemographics(root, { birthYear: 1980, memberAction });
  await setMemoryDemographics(root, { birthYear: 1986, now: new Date("2025-12-01T00:00:00Z") });
  expect((await readMemoryDemographics(root)).birthYear).toBe(1986);
  // A replay is not a fresh statement, even if the current value differs.
  await setMemoryDemographics(root, { birthYear: 1980, memberAction });
  expect((await readMemoryDemographics(root)).birthYear).toBe(1986);
});

it("retains unchanged and rejected outcomes without rewriting a saved DOB", async () => {
  const root = await vault();
  await upsertMemory(root, { section: "Identity", text: "Date of birth: 1986-07-12" });
  expect((await setMemoryDemographics(root, { birthYear: 1986, memberAction })).status).toBe("unchanged");
  const conflictAction = { ...memberAction, actionId: "1c13cd3b-7e72-460d-a380-785025939fd6" };
  // A conflicting year changes nothing: memory keeps its consistent DOB.
  expect(await setMemoryDemographics(root, { birthYear: 1980, memberAction: conflictAction })).toMatchObject({ status: "rejected", reason: "demographics_unresolved", demographics: { status: "resolved", birthYear: 1986 } });
  expect((await readMemoryDocument(root)).records.map(r => r.text)).toEqual(["Date of birth: 1986-07-12"]);
  await setMemoryDemographics(root, { birthYear: 1986 });
  expect((await setMemoryDemographics(root, { birthYear: 1980, memberAction: conflictAction })).status).toBe("rejected");
  expect((await readMemoryDemographics(root)).birthYear).toBe(1986);
});

it("generic writers share validation and forgetting clears while unrelated memory survives", async () => {
  const root = await vault();
  await upsertMemory(root, { section: "Preferences", text: "Likes walking" });
  const saved = await upsertMemory(root, { section: "Identity", text: "Biological sex: female" });
  await expect(updateMemory(root, { recordId: saved.record.id, text: "Biological sex: other" })).rejects.toThrow();
  await expect(updateMemory(root, { recordId: saved.record.id, text: "Biological sex: male", section: "Context" })).rejects.toThrow();
  await updateMemory(root, { recordId: saved.record.id, text: "Biological sex: male" });
  expect((await readMemoryDemographics(root)).biologicalSex).toBe("male");
  await forgetMemory(root, { recordId: saved.record.id });
  expect((await readMemoryDemographics(root)).biologicalSex).toBeNull();
  expect((await readMemoryDocument(root)).records.map(r => r.text)).toEqual(["Likes walking"]);
});

it("missing memory is known empty, but malformed or unreadable memory fails instead of publishing empty", async () => {
  const root = await vault();
  expect(await readMemoryDemographics(root)).toMatchObject({ birthYear: null, biologicalSex: null, status: "resolved" });
  await mkdir(path.join(root, "bank"));
  await writeFile(path.join(root, "bank/memory.md"), "broken memory");
  await expect(readMemoryDemographics(root)).rejects.toThrow();
  await rm(path.join(root, "bank/memory.md"));
  await mkdir(path.join(root, "bank/memory.md"));
  await expect(readMemoryDemographics(root)).rejects.toThrow();
});
