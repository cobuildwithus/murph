// Only this supervisor writes to the terminal. Child stdout, stderr and exception diagnostics are private.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyHostedLocalProfile } from "@murphai/hosted-local-harness/profiles";
import { localCryptoEnv } from "../../test/support/local-crypto-env";
import { check, cleanEnv, options, requireClient, withinBands } from "./policy";
import { privatePhase, type Summary } from "./private-process";

const web = fileURLToPath(new URL("../../", import.meta.url));
const repo = resolve(web, "../..");
// NODE_ENV repeats the e2e:stub profile default.
const { env } = applyHostedLocalProfile({ profileName: "e2e:stub", env: { ...cleanEnv(), NODE_ENV: "test", MURPH_PRISMA_SKIP_ENV_FILES: "1" } });
let revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { cwd: repo, env, encoding: "utf8" }).trim()) revision += "+dirty";
const report: Summary & { vendor: string; revision: string; timestamp: string } = {
  vendor: "epic", revision, timestamp: new Date().toISOString(), stage: "preflight", outcome: "app-failure", counts: {},
};
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => controller.abort());
const deadline = Date.now() + 9 * 60_000;
const db = "murph_test_epic_" + randomUUID().replaceAll("-", "");
const pg = ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres"];
const working = resolve(repo, ".tmp/clinical-sandbox");
const lock = join(tmpdir(), "murph-epic-sandbox-qualification.lock");
const run = (cmd: string, args: string[], extra: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd: web, env: { ...env, PGPASSWORD: "postgres", ...extra }, stdio: "ignore", timeout: 90_000 });

async function main() {
  let ownsLock = false, ownsDatabase = false, dir: string | undefined;
  try {
    const args = options(process.argv.slice(2));
    const client = process.env.EPIC_SMART_NON_PRODUCTION_CLIENT_ID;
    requireClient(client);
    check(!Object.keys(process.env).some(k => /^EPIC_SMART_(?!NON_PRODUCTION_CLIENT_ID$)/u.test(k)));
    await mkdir(working, { recursive: true, mode: 0o700 });
    await mkdir(lock, { mode: 0o700 });
    ownsLock = true;
    dir = await mkdtemp(join(working, "run-"));
    const database = "postgresql://postgres:postgres@127.0.0.1:5432/" + db;
    report.stage = "database";
    run("createdb", [...pg, db]);
    ownsDatabase = true;
    run("node_modules/.bin/prisma", ["migrate", "deploy"], { DATABASE_URL: database });
    const common = { ...env, ...localCryptoEnv(), DATABASE_URL: database, EPIC_SMART_NON_PRODUCTION_CLIENT_ID: client,
      EPIC_PROOF_SANDBOX_PEM: process.env.EPIC_PROOF_SANDBOX_PEM, PROOF_NO_CAPTURE: process.env.GITHUB_ACTIONS === "true" ? "1" : "",
      PROOF_DIR: dir, PROOF_MEMBER: randomUUID(), PROOF_PATIENT: args.patient, PROOF_DEADLINE: String(deadline),
      PROOF_INTERACTIVE: args.interactive ? "1" : "0" };
    const entry = new URL("./web.ts", import.meta.url);
    await privatePhase(entry, web, common, "initial", deadline, report, controller.signal);
    report.stage = "restart";
    report.outcome = "app-failure";
    await privatePhase(entry, web, common, "renewed", deadline, report, controller.signal);
    if (!withinBands(args.patient!, report.counts)) report.outcome = "expectation-drift";
  } catch {
    if (report.outcome === "pass") report.outcome = "app-failure";
  } finally {
    if (ownsDatabase) {
      try { run("dropdb", [...pg, db]); } catch { report.outcome = "app-failure"; }
    }
    for (const owned of [dir, ownsLock ? lock : undefined]) {
      if (!owned) continue;
      try { await rm(owned, { recursive: true, force: true }); } catch { report.outcome = "app-failure"; }
    }
  }
  console.log(JSON.stringify(report));
  process.exitCode = Number(report.outcome !== "pass");
}

void main();
