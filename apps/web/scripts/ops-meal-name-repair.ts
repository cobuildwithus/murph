import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, request as apiRequest, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { mealNameViolation, mealNamesRepairResultSchema, parseMemberActionOutcomeV1, type MealNamesRepairResult } from "@murphai/contracts";
import { prepareFeedbackProfile } from "./ops-feedback";

class MealRepairRunnerError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
}
type RepairRequest = Pick<APIRequestContext, "fetch">;
type OwnerContext = { cookies: BrowserContext["cookies"]; request: RepairRequest };

const ORIGIN = "https://www.withmurph.ai";
const ENDPOINT = `${ORIGIN}/api/ops/meal-name-repair`;
async function api(request: RepairRequest, url: string, body?: unknown): Promise<unknown> {
  const response = await request.fetch(url, { method: body === undefined ? "GET" : "POST", data: body,
    headers: { Origin: ORIGIN, Accept: "application/json" }, maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
  try {
    const bytes = await response.body();
    if (bytes.length > 2 * 1024 * 1024) throw new MealRepairRunnerError("Response exceeded limit");
    const body: unknown = JSON.parse(bytes.toString("utf8"));
    if (!response.ok()) {
      const error = body && typeof body === "object" && "error" in body ? body.error : body;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
      throw new MealRepairRunnerError(`Ops meal repair HTTP ${response.status()}`, response.status(), code);
    }
    return body;
  } finally { await response.dispose(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MealRepairRunnerError("Invalid response");
  return value as Record<string, unknown>;
}
async function runMember(request: RepairRequest, target: string, onProgress?: () => void): Promise<MealNamesRepairResult> {
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
    onProgress?.();
    process.stdout.write(`${JSON.stringify({ scope: "batch", scanned: result.scanned, renamed: result.renamed,
      skipped: result.skipped, invalid: result.invalid, changed: result.changed })}\n`);
    if (result.done) return result;
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
    const unresolved = result.invalid + result.changed;
    const countInvalid = () => after.meals.filter(meal => typeof meal.name === "string" && mealNameViolation(meal.name) !== null).length;
    // A completion receipt follows the runtime projection gate. Its final batch
    // can be read-only, so the valid projection need not have a newer timestamp.
    // Check the actual names, allowing only the repair's explicit terminal skips.
    while (countInvalid() > unresolved && Date.now() < deadline) {
      await delay(10_000); after = await readOwnerMeals(native);
    }
    if (countInvalid() > unresolved) throw new MealRepairRunnerError("Owner Meals projection still has unexpected invalid names");
    let preserved = 0;
    const fields = ["eatenAt", "calories", "proteinGrams", "carbsGrams", "fatGrams", "uploadId"];
    for (const meal of before.meals) {
      const current = after.meals.find(row => row.id === meal.id);
      if (current && fields.every(field => current[field] === meal[field])) preserved++;
    }
    const invalidNames = countInvalid();
    // No member identifiers, meal wording or API bodies enter output.
    process.stdout.write(`${JSON.stringify({ scope: "owner", scanned: result.scanned, renamed: result.renamed,
      skipped: result.skipped, invalid: result.invalid, changed: result.changed,
      apiMeals: after.meals.length, apiPreserved: preserved, apiInvalidNames: invalidNames })}\n`);
    if (preserved !== before.meals.length) throw new MealRepairRunnerError("Owner API preservation check requires investigation");
  } finally { await native.dispose(); }
}

export async function runAll(request: RepairRequest) {
  const totals = { members: 0, skippedMembers: 0, consentDenied: 0, accessDenied: 0, scanned: 0, renamed: 0, skipped: 0, invalid: 0, changed: 0 };
  let cursor: string | null = null;
  do {
    const page = record(await api(request, ENDPOINT + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")));
    if (!Array.isArray(page.targets) || page.targets.some(target => typeof target !== "string")) throw new MealRepairRunnerError("Invalid member page");
    for (const target of page.targets) {
      let hasProgress = false;
      try {
        const result = await runMember(request, String(target), () => { hasProgress = true; });
        totals.members++;
        for (const key of ["scanned", "renamed", "skipped", "invalid", "changed"] as const) totals[key] += result[key];
      } catch (error) {
        if (hasProgress || !(error instanceof MealRepairRunnerError) || error.status !== 403
          || !["HOSTED_CONSENT_REQUIRED", "HOSTED_ACCESS_REQUIRED"].includes(error.code ?? "")) throw error;
        // A shared access code can also mean the operator lost access. Recheck
        // the authenticated Ops reader before attributing it to this member.
        await api(request, ENDPOINT + "?target=owner&batch=0");
        totals.skippedMembers++;
        if (error.code === "HOSTED_CONSENT_REQUIRED") totals.consentDenied++;
        else totals.accessDenied++;
      }
      process.stdout.write(`${JSON.stringify({ scope: "all", ...totals })}\n`);
    }
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor !== null);
}

async function run() {
  const scope = process.argv[2];
  if (scope !== "owner" && scope !== "all") throw new MealRepairRunnerError("Use owner or all");
  const directory = join(homedir(), ".local", "state", "murph", "ops-feedback-browser");
  await prepareFeedbackProfile(directory);
  const context = await chromium.launchPersistentContext(directory, { headless: true, acceptDownloads: false });
  try {
    if (scope === "owner") return await runOwner(context);
    return await runAll(context.request);
  } finally { await context.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { process.stderr.write(`${error instanceof MealRepairRunnerError ? error.message : "Meal name repair stopped; check Ops authentication and batch status."} Rerun the same scope to resume.\n`); process.exitCode = 1; });
}
