import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, request as apiRequest, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { mealNameViolation, mealNamesRepairResultSchema, parseMemberActionOutcomeV1, type MealNamesRepairResult } from "@murphai/contracts";
import { prepareFeedbackProfile } from "./ops-feedback";

class MealRepairRunnerError extends Error {}
type RepairRequest = Pick<APIRequestContext, "fetch">;
type OwnerContext = { cookies: BrowserContext["cookies"]; request: RepairRequest };
type CompletedRepair = MealNamesRepairResult & { completedAt: string };

const ORIGIN = "https://www.withmurph.ai";
const ENDPOINT = `${ORIGIN}/api/ops/meal-name-repair`;
async function api(request: RepairRequest, url: string, body?: unknown): Promise<unknown> {
  const response = await request.fetch(url, { method: body === undefined ? "GET" : "POST", data: body,
    headers: { Origin: ORIGIN, Accept: "application/json" }, maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
  try {
    if (!response.ok()) throw new MealRepairRunnerError(`Ops meal repair HTTP ${response.status()}`);
    const bytes = await response.body();
    if (bytes.length > 2 * 1024 * 1024) throw new MealRepairRunnerError("Response exceeded limit");
    return JSON.parse(bytes.toString("utf8"));
  } finally { await response.dispose(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MealRepairRunnerError("Invalid response");
  return value as Record<string, unknown>;
}
async function runMember(request: RepairRequest, target: string): Promise<CompletedRepair> {
  for (let batch = 0; batch < 100000; batch++) {
    const query = `${ENDPOINT}?target=${encodeURIComponent(target)}&batch=${batch}`;
    let status = record(await api(request, query));
    if (status.status === "pending") {
      await api(request, ENDPOINT, { target, batch });
      const deadline = Date.now() + 30 * 60_000;
      do {
        await delay(10_000);
        status = record(await api(request, query));
      } while (status.status === "pending" && Date.now() < deadline);
    }
    if (status.status !== "applied") throw new MealRepairRunnerError("Repair batch did not complete; rerun to resume");
    const outcome = parseMemberActionOutcomeV1(status);
    const result = mealNamesRepairResultSchema.parse(outcome.result);
    if (result.done) return { ...result, completedAt: outcome.completedAt };
  }
  throw new MealRepairRunnerError("Repair batch limit reached");
}

async function nativeOwnerApi(context: OwnerContext): Promise<APIRequestContext> {
  // Reuse the signed-in account's own session in memory. Never persist or print credentials.
  const cookie = (await context.cookies(ORIGIN)).find(cookie => cookie.name === "__Host-murph-auth-session");
  const token = cookie ? decodeURIComponent(cookie.value).split(".")[0] : null;
  if (!token || !/^[A-Za-z0-9]{32}$/u.test(token)) throw new MealRepairRunnerError("Owner native verification session unavailable");
  return apiRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer murph_auth_v1.${token}` } });
}
async function readOwnerMeals(request: APIRequestContext) {
  const result = record(await api(request, `${ORIGIN}/api/device-sync/companion/meals?limit=31`));
  if (!Array.isArray(result.days) || typeof result.savedAt !== "string") throw new MealRepairRunnerError("Invalid Meals response");
  const meals = result.days.flatMap(day => {
    const rows = record(day).meals;
    if (!Array.isArray(rows)) throw new MealRepairRunnerError("Invalid Meals day");
    return rows.map(record);
  });
  return { savedAt: result.savedAt, meals };
}
export async function runOwner(context: OwnerContext) {
  const native = await nativeOwnerApi(context);
  try {
    const before = await readOwnerMeals(native);
    const result = await runMember(context.request, "owner");
    const deadline = Date.now() + 20 * 60_000;
    let after = await readOwnerMeals(native);
    while (result.renamed > 0 && Date.parse(after.savedAt) < Date.parse(result.completedAt) && Date.now() < deadline) {
      await delay(10_000); after = await readOwnerMeals(native);
    }
    if (result.renamed > 0 && Date.parse(after.savedAt) < Date.parse(result.completedAt)) throw new MealRepairRunnerError("Owner Meals projection has not refreshed");
    let preserved = 0;
    const fields = ["eatenAt", "calories", "proteinGrams", "carbsGrams", "fatGrams", "uploadId"];
    for (const meal of before.meals) {
      const current = after.meals.find(row => row.id === meal.id);
      if (current && fields.every(field => current[field] === meal[field])) preserved++;
    }
    const invalidNames = after.meals.filter(meal => typeof meal.name === "string" && mealNameViolation(meal.name) !== null).length;
    // No member identifiers, meal wording or API bodies enter output.
    process.stdout.write(`${JSON.stringify({ scope: "owner", scanned: result.scanned, renamed: result.renamed,
      skipped: result.skipped, invalid: result.invalid, changed: result.changed,
      apiMeals: after.meals.length, apiPreserved: preserved, apiInvalidNames: invalidNames })}\n`);
    if (preserved !== before.meals.length) throw new MealRepairRunnerError("Owner API preservation check requires investigation");
  } finally { await native.dispose(); }
}

async function run() {
  const scope = process.argv[2];
  if (scope !== "owner" && scope !== "all") throw new MealRepairRunnerError("Use owner or all");
  const directory = join(homedir(), ".local", "state", "murph", "ops-feedback-browser");
  await prepareFeedbackProfile(directory);
  const context = await chromium.launchPersistentContext(directory, { headless: true, acceptDownloads: false });
  try {
    if (scope === "owner") return await runOwner(context);
    const totals = { members: 0, scanned: 0, renamed: 0, skipped: 0, invalid: 0, changed: 0 };
    let cursor: string | null = null;
    do {
      const page = record(await api(context.request, ENDPOINT + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")));
      if (!Array.isArray(page.targets) || page.targets.some(target => typeof target !== "string")) throw new MealRepairRunnerError("Invalid member page");
      for (const target of page.targets) {
        const result = await runMember(context.request, String(target));
        totals.members++;
        for (const key of ["scanned", "renamed", "skipped", "invalid", "changed"] as const) totals[key] += result[key];
        process.stdout.write(`${JSON.stringify({ scope: "all", ...totals })}\n`);
      }
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    } while (cursor !== null);
  } finally { await context.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { process.stderr.write(`${error instanceof MealRepairRunnerError ? error.message : "Meal name repair stopped; check Ops authentication and batch status."} Rerun the same scope to resume.\n`); process.exitCode = 1; });
}
